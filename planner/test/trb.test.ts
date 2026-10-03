import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/bundle/crc32';
import { HEADER_LEN, isBaselineJpeg, readTrb, TrbError, writeTrb } from '../src/bundle/trb';
import { fakeJpeg, sampleBundle } from './helpers';

/** Re-seal the CRC after tampering so later validation rules are reached. */
function reseal(b: Uint8Array): Uint8Array {
  new DataView(b.buffer).setUint32(24, crc32(b.subarray(HEADER_LEN)), true);
  return b;
}

describe('crc32', () => {
  it('matches the IEEE check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('trb round trip', () => {
  it('writes and reads back identically', () => {
    const b = sampleBundle();
    const back = readTrb(writeTrb(b));
    expect(back.manifest).toEqual(b.manifest);
    expect(back.maneuvers).toEqual(b.maneuvers);
    expect(back.images.map((i) => [i.zoom, i.bearing, [...i.jpeg]])).toEqual(b.images.map((i) => [i.zoom, i.bearing, [...i.jpeg]]));
    back.points.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(b.points[i].lat, 6);
      expect(p.lon).toBeCloseTo(b.points[i].lon, 6);
    });
  });

  it('keeps binary sections 4-byte aligned', () => {
    const bytes = writeTrb(sampleBundle());
    const headerLen = new DataView(bytes.buffer).getUint32(8, true);
    expect((HEADER_LEN + headerLen) % 4).toBe(0);
  });

  it('uses UTF-8 byte offsets for names', () => {
    const b = sampleBundle();
    const bytes = writeTrb(b);
    const dv = new DataView(bytes.buffer);
    const headerLen = dv.getUint32(8, true);
    const n = dv.getUint32(12, true);
    const manOff = HEADER_LEN + headerLen + 8 * n;
    const last = manOff + 32 * 2;
    // "Gg. Ñoño 3 — ujung": Ñ, ñ are 2 bytes, — is 3 bytes.
    expect(dv.getUint16(last + 12, true)).toBe(new TextEncoder().encode('Gg. Ñoño 3 — ujung').length);
  });

  it('deduplicates repeated names', () => {
    const b = sampleBundle();
    b.maneuvers[2].name = b.maneuvers[1].name;
    expect(readTrb(writeTrb(b)).maneuvers[2].name).toBe('Jl. Kebon Sirih');
  });
});

describe('trb validation', () => {
  const good = () => writeTrb(sampleBundle());
  const layout = (b: Uint8Array) => {
    const dv = new DataView(b.buffer);
    const headerLen = dv.getUint32(8, true);
    const n = dv.getUint32(12, true);
    return { dv, manOff: HEADER_LEN + headerLen + 8 * n };
  };
  const rule = (b: Uint8Array) => {
    try {
      readTrb(b);
      return 'ok';
    } catch (e) {
      if (e instanceof TrbError) return e.rule;
      throw e;
    }
  };

  it('accepts the good bundle', () => expect(rule(good())).toBe('ok'));

  it('rejects bad magic', () => {
    const b = good();
    b[0] = 0x58;
    expect(rule(b)).toBe('magic');
  });

  it('rejects bad version', () => {
    const b = good();
    b[4] = 2;
    expect(rule(b)).toBe('version');
  });

  it('rejects CRC mismatch', () => {
    const b = good();
    b[b.length - 1] ^= 0xff;
    expect(rule(b)).toBe('crc');
  });

  it('rejects truncated files', () => {
    const b = good();
    expect(rule(b.slice(0, 20))).toBe('bounds');
    expect(rule(reseal(b.slice(0, b.length - 40)))).toBe('bounds');
  });

  it('rejects huge counts without allocating', () => {
    const b = good();
    new DataView(b.buffer).setUint32(12, 0xffffffff, true);
    expect(rule(reseal(b))).toBe('bounds');
  });

  it('rejects point_index >= N', () => {
    const b = good();
    const { dv, manOff } = layout(b);
    dv.setUint32(manOff + 32, 100000, true);
    expect(rule(reseal(b))).toBe('index');
  });

  it('rejects image_index >= K (but allows 255)', () => {
    const b = good();
    const { dv, manOff } = layout(b);
    dv.setUint8(manOff + 32 + 7, 2);
    expect(rule(reseal(b))).toBe('index');
    dv.setUint8(manOff + 32 + 7, 255);
    expect(rule(reseal(b))).toBe('ok');
  });

  it('rejects name ranges past the string table', () => {
    const b = good();
    const { dv, manOff } = layout(b);
    dv.setUint32(manOff + 32 + 8, 5000, true);
    expect(rule(reseal(b))).toBe('index');
  });

  it('rejects decreasing point_index', () => {
    const b = good();
    const { dv, manOff } = layout(b);
    dv.setUint32(manOff + 64, 5, true); // ARRIVE before the RIGHT at 10
    expect(rule(reseal(b))).toBe('order');
  });

  it('survives random corruption (fuzz) with only TrbErrors', () => {
    let seed = 1234;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 3000; i++) {
      const b = good();
      const flips = 1 + Math.floor(rnd() * 8);
      for (let k = 0; k < flips; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      const sealed = rnd() < 0.7 ? reseal(b) : b;
      expect(() => rule(sealed)).not.toThrow();
    }
  });
});

describe('isBaselineJpeg', () => {
  it('accepts SOF0', () => expect(isBaselineJpeg(fakeJpeg())).toBe(true));
  it('rejects progressive SOF2', () => {
    const j = fakeJpeg();
    j[9] = 0xc2;
    expect(isBaselineJpeg(j)).toBe(false);
  });
  it('rejects non-JPEG', () => expect(isBaselineJpeg(new Uint8Array([1, 2, 3, 4]))).toBe(false));
});
