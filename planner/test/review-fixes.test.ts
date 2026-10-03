// Regression tests for issues found in code review.

import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/bundle/crc32';
import { HEADER_LEN, jpegSize, ManeuverType as T, readTrb, TrbError, writeTrb } from '../src/bundle/trb';
import { Navigator } from '../src/navcore/navigator';
import { buildRoute } from '../src/navcore/route';
import { Phase, Triggers } from '../src/navcore/triggers';
import { buildBundle } from '../src/plan/buildBundle';
import { mapStep } from '../src/plan/maneuvers';
import { parseOsrm } from '../src/plan/routing';
import { fakeJpeg, ll, man, path, sampleBundle } from './helpers';

const ruleOf = (f: () => unknown) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return e instanceof TrbError ? e.rule : `other: ${(e as Error).message}`;
  }
};

/** Replace the manifest bytes with `json` (same length, padded) and re-seal the CRC. */
function withManifest(json: string): Uint8Array {
  const b = writeTrb(sampleBundle());
  const dv = new DataView(b.buffer);
  const len = dv.getUint32(8, true);
  const bytes = new TextEncoder().encode(json.padEnd(len, ' '));
  b.set(bytes.subarray(0, len), HEADER_LEN);
  dv.setUint32(24, crc32(b.subarray(HEADER_LEN)), true);
  return b;
}

describe('reader: manifest shape', () => {
  it.each(['null', '[]', '42', '"x"', '{"id":1,"name":"a"}'])('rejects manifest %s with a TrbError', (json) => {
    expect(ruleOf(() => readTrb(withManifest(json)))).toBe('manifest');
  });
});

describe('writer self-check', () => {
  it('throws instead of wrapping out-of-range fields', () => {
    const b = sampleBundle();
    b.maneuvers[2].pointIndex = 999;
    expect(ruleOf(() => writeTrb(b))).toBe('index');
    const c = sampleBundle();
    c.maneuvers[1].exitNumber = 300;
    expect(ruleOf(() => writeTrb(c))).toBe('write');
  });
});

describe('jpegSize', () => {
  it('reads SOF dimensions', () => {
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xf0, 0x01, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
    expect(jpegSize(j)).toEqual({ w: 320, h: 240 });
    expect(jpegSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('multi-leg routes', () => {
  it('maps only the first leg’s depart', () => {
    const base = { drivingSide: 'left' as const, isFinal: false };
    expect(mapStep({ ...base, type: 'depart', legIndex: 0 })?.type).toBe(T.DEPART);
    expect(mapStep({ ...base, type: 'depart', legIndex: 1 })).toBeNull();
    expect(mapStep({ ...base, type: 'arrive', legIndex: 0 })?.type).toBe(T.WAYPOINT);
  });

  it('roundabout turn maps by modifier, not as a roundabout', () => {
    expect(mapStep({ type: 'roundabout turn', modifier: 'left', drivingSide: 'left', isFinal: true })?.type).toBe(T.LEFT);
  });

  it('a mid-route DEPART is never prompted', () => {
    const pts = path([[0, 0], [0, 1000], [0, 2000]]);
    const route = buildRoute({ points: pts, maneuvers: [man(0, T.DEPART), man(100, T.WAYPOINT), man(100, T.DEPART), man(200, T.ARRIVE)] });
    const tr = new Triggers(route);
    const prompted = new Set<number>();
    for (let a = 0; a <= 2000; a += 5) for (const e of tr.update(a, 10)) prompted.add(e.maneuver);
    expect([...prompted].sort()).toEqual([1, 3]);
    expect(tr.arrived).toBe(true);
  });

  it('buildBundle drops the second leg’s depart', async () => {
    const geometry = path([[0, 0], [0, 500], [0, 1000]], 10);
    const step = (geomIndex: number, type: string, legIndex: number, isFinal: boolean) => ({
      geomIndex, type, name: '', drivingSide: 'left' as const, bearingBefore: 0, bearingAfter: 0, distance: 500, duration: 50, isFinal, legIndex,
    });
    const { bundle } = await buildBundle(
      {
        geometry,
        steps: [step(0, 'depart', 0, false), step(50, 'arrive', 0, false), step(50, 'depart', 1, true), step(100, 'arrive', 1, true)],
        distance: 1000, duration: 100, source: 't', warnings: [],
      },
      { name: 'x' },
    );
    expect(bundle.maneuvers.map((m) => m.type)).toEqual([T.DEPART, T.WAYPOINT, T.ARRIVE]);
  });
});

describe('routing response validation', () => {
  const step = (coords: unknown) => ({ distance: 1, duration: 1, geometry: { coordinates: coords }, maneuver: { type: 'depart' } });
  it('rejects malformed shapes and bad coordinates with a clear error', () => {
    expect(() => parseOsrm({ code: 'Ok', routes: [{ distance: 1, duration: 1, legs: undefined as never }] }, 'x')).toThrow(/malformed/);
    expect(() => parseOsrm({ code: 'Ok', routes: [{ distance: 1, duration: 1, legs: [{ steps: [step([[NaN, 0], [1, 1]])] }] }] } as never, 'x')).toThrow(/coordinate/);
    expect(() => parseOsrm({ code: 'Ok', routes: [{ distance: 1, duration: 1, legs: [{ steps: [step([[1, 1]])] }] }] } as never, 'x')).toThrow(/fewer than 2/);
  });
  it('uses Valhalla error fields in messages', () => {
    expect(() => parseOsrm({ error: 'No path could be found' } as never, 'valhalla')).toThrow('valhalla: No path could be found');
  });
});

describe('navigator: dropout while off-route', () => {
  it('re-acquires with a full-route search, not the stale ±300 m window', () => {
    const pts = path([[0, 0], [0, 3000]]);
    const route = buildRoute({ points: pts, maneuvers: [man(0, T.DEPART), man(pts.length - 1, T.ARRIVE)] });
    const nav = new Navigator(route);
    const fix = (x: number, y: number, t: number, h: number) => ({ ...ll(x, y), t, speed: 10, heading: h, hdop: 1 });
    let t = 0;
    for (let y = 0; y < 200; y += 2, t += 0.2) nav.update(fix(0, y, t, 0), t);
    for (let x = 0; x > -200; x -= 2, t += 0.2) nav.update(fix(x, 200, t, 270), t);
    expect(nav.offRoute.confirmed).toBe(true);
    for (let k = 0; k < 20; k++, t += 0.2) nav.update(null, t); // GNSS gap
    // Rider reappears on the route 1.5 km further on, heading north.
    let s = nav.update(fix(0, 1700, t, 0), t);
    expect(s.perpDist).toBeLessThan(5); // matched on the route immediately
    // Progress resumes once off-route clears (3 s back on the route).
    for (let y = 1700; y < 1760; y += 2) s = nav.update(fix(0, y, (t += 0.2), 0), t);
    expect(s.offRoute).toBe(false);
    expect(s.along).toBeGreaterThan(1740);
  });
});

it('triggers still prompt in order after the DEPART guard', () => {
  const pts = path([[0, 0], [0, 1000]]);
  const tr = new Triggers(buildRoute({ points: pts, maneuvers: [man(0, T.DEPART), man(50, T.LEFT), man(100, T.ARRIVE)] }));
  const seq: Phase[] = [];
  for (let a = 0; a <= 1000; a += 2) for (const e of tr.update(a, 10)) if (e.maneuver === 1) seq.push(e.to);
  expect(seq).toEqual([Phase.PREPARE, Phase.NEAR, Phase.NOW, Phase.PASSED]);
  void fakeJpeg;
});
