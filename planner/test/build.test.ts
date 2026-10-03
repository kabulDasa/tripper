import { describe, expect, it } from 'vitest';
import { ManeuverType as T, NO_IMAGE, readTrb } from '../src/bundle/trb';
import { cumulative } from '../src/geo/geo';
import { NAV } from '../src/navcore/config';
import { Navigator } from '../src/navcore/navigator';
import { buildRoute } from '../src/navcore/route';
import { Phase } from '../src/navcore/triggers';
import { buildBundle, type SnapshotJob } from '../src/plan/buildBundle';
import { overlayFor } from '../src/plan/camera';
import type { RouteResult, RouteStep } from '../src/plan/routing';
import { Rider } from '../src/pod/rider';
import { fakeJpeg, JKT, path } from './helpers';

/** North 800 m, right turn, east 600 m, left turn, north 400 m. Dense 5 m geometry like a router returns. */
function syntheticRoute(): RouteResult {
  const geometry = path([[0, 0], [0, 800], [600, 800], [600, 1200]], 5);
  const idxAt = (x: number, y: number) => geometry.findIndex((p) => {
    const v = JKT.toXY(p);
    return Math.abs(v.x - x) < 0.5 && Math.abs(v.y - y) < 0.5;
  });
  const step = (geomIndex: number, type: string, modifier: string | undefined, name: string, before: number, after: number, dist: number): RouteStep => ({
    geomIndex, type, modifier, name, drivingSide: 'left', bearingBefore: before, bearingAfter: after, distance: dist, duration: dist / 11, isFinal: true, legIndex: 0,
  });
  return {
    geometry,
    steps: [
      step(0, 'depart', undefined, 'Jalan Satu', 0, 0, 800),
      step(idxAt(0, 800), 'turn', 'right', 'Jalan Dua', 0, 90, 600),
      step(idxAt(300, 800), 'new name', 'straight', 'Jalan Dua Lama', 90, 90, 300), // silent
      step(idxAt(600, 800), 'end of road', 'left', 'Gang Tiga', 90, 0, 400),
      step(geometry.length - 1, 'arrive', undefined, 'Gang Tiga', 0, 0, 0),
    ],
    distance: 1800,
    duration: 160,
    source: 'test',
    warnings: [],
  };
}

describe('buildBundle', () => {
  it('maps, simplifies and round-trips through the reader', async () => {
    const r = syntheticRoute();
    const { bundle, bytes } = await buildBundle(r, { name: 'Test Route', now: new Date('2026-10-03T01:02:03Z') });
    expect(bundle.points.length).toBe(4); // three straight legs collapse to their corners
    expect(bundle.maneuvers.map((m) => m.type)).toEqual([T.DEPART, T.RIGHT, T.LEFT, T.ARRIVE]);
    expect(bundle.maneuvers.map((m) => m.pointIndex)).toEqual([0, 1, 2, 3]);
    expect(bundle.maneuvers.map((m) => m.name)).toEqual(['Jl. Satu', 'Jl. Dua', 'Gg. Tiga', 'Gg. Tiga']);
    expect(bundle.maneuvers[1].modifier).toBe(45);
    expect(bundle.maneuvers.every((m) => m.imageIndex === NO_IMAGE)).toBe(true);
    expect(bundle.manifest.id).toBe('2026-10-03-test-route');
    const back = readTrb(bytes);
    expect(back.maneuvers).toEqual(bundle.maneuvers);
  });

  it('keeps image order deterministic under parallel rendering', async () => {
    const r = syntheticRoute();
    const jobs: SnapshotJob[] = [];
    const { bundle } = await buildBundle(r, {
      name: 'x',
      concurrency: 3,
      renderer: async (job) => {
        jobs.push(job);
        await new Promise((res) => setTimeout(res, (3 - job.index) * 5)); // later jobs finish first
        return fakeJpeg(job.index);
      },
    });
    expect(bundle.maneuvers.map((m) => m.imageIndex)).toEqual([NO_IMAGE, 0, 1, 2]);
    // image k must belong to the maneuver that points at it
    bundle.maneuvers.forEach((m, i) => {
      if (m.imageIndex !== NO_IMAGE) expect(bundle.images[m.imageIndex].jpeg[6]).toBe(i);
    });
    expect(bundle.images[0].bearing).toBeCloseTo(0, 0); // approaching the right turn heading north
    expect(bundle.images[1].bearing).toBeCloseTo(90, 0); // approaching the left turn heading east
  });

  it('highlights the final approach for ARRIVE', () => {
    const r = syntheticRoute();
    const C = cumulative(r.geometry);
    const end = C[C.length - 1];
    const o = overlayFor(r.geometry, C, end, 17);
    expect(o.head).toEqual([]);
    expect(o.leg.length).toBeGreaterThan(1);
  });
});

describe('simulated ride (rider + GNSS noise + navcore)', () => {
  function seeded(seed: number) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it.each([20, 50, 90])('rides the route at %i km/h with 5 m noise: every prompt in order, no false off-route', async (kmh) => {
    const { bundle } = await buildBundle(syntheticRoute(), { name: 'sim' });
    const route = buildRoute(bundle);
    const rider = new Rider(route, seeded(kmh));
    const nav = new Navigator(route);
    const opts = { speedKmh: kmh, noiseM: 5, slowForTurns: true };
    let s = nav.update(rider.gnss(opts), 0);
    for (let i = 0; i < 20000 && !s.arrived; i++) {
      rider.step(0.2, opts);
      s = nav.update(rider.gnss(opts), rider.t);
    }
    expect(s.arrived).toBe(true);
    expect(nav.events.some((e) => e.kind === 'offroute')).toBe(false);
    for (const m of [1, 2]) {
      const seq = nav.events.filter((e) => e.kind === 'phase' && e.maneuver === m).map((e) => (e.kind === 'phase' ? e.to : null));
      expect(seq).toEqual([Phase.PREPARE, Phase.NEAR, Phase.NOW, Phase.PASSED]);
    }
  });

  it('a wrong turn is confirmed off-route and recovers', async () => {
    const { bundle } = await buildBundle(syntheticRoute(), { name: 'sim' });
    const route = buildRoute(bundle);
    const rider = new Rider(route, seeded(7));
    const nav = new Navigator(route);
    const opts = { speedKmh: 30, noiseM: 3, slowForTurns: false };
    const run = (secs: number) => {
      for (let t = 0; t < secs; t += 0.2) {
        rider.step(0.2, opts);
        nav.update(rider.gnss(opts), rider.t);
      }
    };
    run(30);
    rider.startDetour();
    run(NAV.OFF_ROUTE_CONFIRM_S + 12);
    expect(nav.offRoute.confirmed).toBe(true);
    rider.endDetour();
    run(60);
    expect(nav.offRoute.confirmed).toBe(false);
    expect(nav.events.filter((e) => e.kind === 'rejoined').length).toBe(1);
  });
});
