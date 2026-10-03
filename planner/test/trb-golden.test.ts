// Byte-level contract test. GOLDEN_HEX was produced by an independent Python implementation
// (struct.pack '<' + zlib.crc32) straight from docs/design/bundle-format.md — not by writeTrb.
// A symmetric bug in the TS writer and reader (endianness, offsets, CRC range) fails here.

import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/bundle/crc32';
import { HEADER_LEN, ManeuverType, readTrb, TrbError, writeTrb, type Bundle } from '../src/bundle/trb';
import { fakeJpeg, sampleBundle } from './helpers';

const GOLDEN_HEX =
  '5452423101000100780000000200000001000000010000004bb69f0a7b226964223a2267222c226e616d65223a2267222c2263726561746564223a2263222c22746f74616c5f6d223a302c22736f75726365223a2274222c226d6170223a7b2274696c655f73697a65223a3531322c22696d675f7078223a3234307d2c22737472696e6773223a22415c7530303030227d20202040420f0080841e0041420f0080841e000100000001fd0000000000000100000000000000000000000000000000000000d400000010000000000088410000b442ffd8ffe000040000ffc000040800ffd9';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

const goldenBundle = (): Bundle => ({
  manifest: { id: 'g', name: 'g', created: 'c', total_m: 0, source: 't', map: { tile_size: 512, img_px: 240 } },
  points: [
    { lat: 1, lon: 2 },
    { lat: 1.000001, lon: 2 },
  ],
  maneuvers: [{ pointIndex: 1, type: ManeuverType.ARRIVE, modifier: -3, exitNumber: 0, imageIndex: 0, name: 'A' }],
  images: [{ zoom: 17, bearing: 90, jpeg: fakeJpeg(0) }],
});

describe('golden .trb bytes', () => {
  it('writer output matches the independent encoding byte for byte', () => {
    expect(hex(writeTrb(goldenBundle()))).toBe(GOLDEN_HEX);
  });

  it('reader decodes the independent encoding', () => {
    const b = readTrb(fromHex(GOLDEN_HEX));
    const want = goldenBundle();
    expect(b.manifest).toEqual(want.manifest);
    expect(b.maneuvers).toEqual(want.maneuvers);
    expect(b.points).toEqual(want.points);
    expect(b.images[0].zoom).toBe(17);
    expect(b.images[0].bearing).toBe(90);
    expect([...b.images[0].jpeg]).toEqual([...fakeJpeg(0)]);
  });
});

describe('each validation rule', () => {
  const rule = (b: Uint8Array) => {
    try {
      readTrb(b);
      return 'ok';
    } catch (e) {
      if (e instanceof TrbError) return e.rule;
      throw e;
    }
  };
  const reseal = (b: Uint8Array) => {
    new DataView(b.buffer).setUint32(24, crc32(b.subarray(HEADER_LEN)), true);
    return b;
  };
  /** Golden layout: manifest 120 B → points @148, maneuver @164, image index @196, jpeg @212. */
  const g = () => fromHex(GOLDEN_HEX);
  const dv = (b: Uint8Array) => new DataView(b.buffer);

  it('flags disagree with images_count', () => {
    const b = g();
    dv(b).setUint16(6, 0, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it('fewer than 2 points', () => {
    const b = g();
    dv(b).setUint32(12, 1, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it('more than 255 images', () => {
    const b = g();
    dv(b).setUint32(20, 256, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it('image range outside the image data', () => {
    const b = g();
    dv(b).setUint32(196, 100, true); // offset inside the header region
    expect(rule(reseal(b))).toBe('bounds');
    const c = g();
    dv(c).setUint32(200, 999, true); // length past EOF
    expect(rule(reseal(c))).toBe('bounds');
  });
  it('zero-length image', () => {
    const b = g();
    dv(b).setUint32(200, 0, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it.each([NaN, Infinity, -1, 30])('bad zoom %s', (z) => {
    const b = g();
    dv(b).setFloat32(204, z, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it('non-finite bearing', () => {
    const b = g();
    dv(b).setFloat32(208, NaN, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it('unknown maneuver type', () => {
    const b = g();
    b[164 + 4] = 99;
    expect(rule(reseal(b))).toBe('index');
  });
  it('latitude out of range', () => {
    const b = g();
    dv(b).setInt32(148, 91_000_000, true);
    expect(rule(reseal(b))).toBe('bounds');
  });
  it('name that is not UTF-8', () => {
    const bundle = sampleBundle();
    const bytes = writeTrb(bundle);
    // Point the RIGHT maneuver's name at the middle of "Ñ" (a 2-byte sequence) in the string table.
    const d = dv(bytes);
    const manOff = HEADER_LEN + d.getUint32(8, true) + 8 * d.getUint32(12, true);
    const table = new TextEncoder().encode(bundle.maneuvers.map((m) => m.name).filter((n, i, a) => a.indexOf(n) === i).join('\0') + '\0');
    const enye = table.indexOf(0xc3);
    d.setUint32(manOff + 32 + 8, enye + 1, true);
    d.setUint16(manOff + 32 + 12, 1, true);
    expect(rule(reseal(bytes))).toBe('index');
  });
  it('manifest that is not JSON', () => {
    const b = g();
    b[28] = 0x5b; // '{' → '['
    expect(rule(reseal(b))).toBe('manifest');
  });
});
