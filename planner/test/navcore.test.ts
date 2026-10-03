// M2 acceptance cases (project-plan.md), run against the TypeScript navcore port.

import { describe, expect, it } from 'vitest';
import { bearing, pointAlong, type LatLon } from '../src/geo/geo';
import { ManeuverType as T } from '../src/bundle/trb';
import { NAV } from '../src/navcore/config';
import { Matcher, type Fix } from '../src/navcore/matcher';
import { Navigator } from '../src/navcore/navigator';
import { OffRoute } from '../src/navcore/offroute';
import { buildRoute } from '../src/navcore/route';
import { Phase, Triggers } from '../src/navcore/triggers';
import { JKT, ll, man, path } from './helpers';

const fix = (p: LatLon, t: number, speed: number, heading: number, hdop = 1): Fix => ({ ...p, t, speed, heading, hdop });
const offset = (p: LatLon, dx: number, dy: number) => {
  const v = JKT.toXY(p);
  return JKT.toLatLon({ x: v.x + dx, y: v.y + dy });
};

describe('matcher', () => {
  it('snaps on a straight line', () => {
    const pts = path([[0, 0], [0, 1000]]);
    const m = new Matcher(buildRoute({ points: pts, maneuvers: [] }));
    const r = m.match(fix(ll(8, 400), 0, 10, 0), 0);
    expect(r.perpDist).toBeCloseTo(8, 0);
    expect(r.along).toBeCloseTo(400, -1);
  });

  it('follows an L-turn through the corner', () => {
    const pts = path([[0, 0], [0, 500], [500, 500]]);
    const route = buildRoute({ points: pts, maneuvers: [] });
    const m = new Matcher(route);
    let t = 0;
    for (let a = 0; a <= 1000; a += 10, t += 1) {
      const p = pointAlong(route.points, route.C, a).p;
      const h = a < 500 ? 0 : 90;
      const r = m.match(fix(p, t, 10, h), h);
      expect(Math.abs(r.along - a)).toBeLessThan(2);
    }
  });

  it('does not jump to a later pass on a U-shaped route that passes itself', () => {
    // Up the west side, across, back down 12 m to the east. Opposite headings.
    const pts = path([[0, 0], [0, 1000], [12, 1000], [12, 0]]);
    const route = buildRoute({ points: pts, maneuvers: [] });
    const m = new Matcher(route);
    for (let a = 0, t = 0; a < 1000; a += 10, t++) {
      // Rider drifts 7 m east — closer to the return leg than its own.
      const p = offset(pointAlong(route.points, route.C, a).p, 7, 0);
      const r = m.match(fix(p, t, 10, 0), 0);
      expect(r.along).toBeLessThan(1001);
    }
  });

  it('separates parallel roads 15 m apart with opposite headings', () => {
    // Route goes north on x=0, U-turns, comes back south on x=15.
    const pts = path([[0, 0], [0, 600], [15, 600], [15, 0]]);
    const route = buildRoute({ points: pts, maneuvers: [] });
    // Lost (full-route search) is the hardest case: no window to help.
    // Fixes sit nearer the *other* road; only the heading penalty picks the right one.
    const fresh = () => Object.assign(new Matcher(route), { lost: true });
    expect(fresh().match(fix(ll(6, 300), 0, 12, 180), 180).along).toBeGreaterThan(615);
    expect(fresh().match(fix(ll(9, 300), 0, 12, 0), 0).along).toBeLessThan(600);
  });
});

describe('trigger phases', () => {
  // DEPART, one RIGHT at 2 km, ARRIVE at 2.5 km.
  const pts = path([[0, 0], [0, 2000], [500, 2000]]);
  const turnIdx = pts.findIndex((p) => Math.abs(JKT.toXY(p).y - 2000) < 0.5);
  const route = buildRoute({
    points: pts,
    maneuvers: [man(0, T.DEPART), man(turnIdx, T.RIGHT), man(pts.length - 1, T.ARRIVE)],
  });
  const ORDER = [Phase.FAR, Phase.PREPARE, Phase.NEAR, Phase.NOW, Phase.PASSED];

  it.each([20, 60, 100])('goes FAR→PREPARE→NEAR→NOW→PASSED with no regressions at %i km/h', (kmh) => {
    const v = kmh / 3.6;
    const tr = new Triggers(route);
    expect(tr.next).toBe(1); // DEPART skipped
    const seen: Phase[] = [Phase.FAR];
    for (let t = 0, a = 0; a <= 2100; t += 0.2, a += v * 0.2) {
      for (const e of tr.update(a, v)) {
        if (e.maneuver !== 1) continue;
        expect(ORDER.indexOf(e.to)).toBe(ORDER.indexOf(e.from) + 1);
        seen.push(e.to);
      }
    }
    expect(seen).toEqual(ORDER);
  });

  it('enters NEAR about 8 s out at 60 km/h', () => {
    const v = 60 / 3.6;
    const tr = new Triggers(route);
    for (let a = 0; a <= 2000; a += v * 0.2) {
      const e = tr.update(a, v).find((x) => x.to === Phase.NEAR);
      if (e) {
        expect(e.t).toBeLessThanOrEqual(NAV.NEAR_T_S);
        expect(e.t).toBeGreaterThan(NAV.NEAR_T_S - 0.5);
        return;
      }
    }
    throw new Error('never reached NEAR');
  });

  it('crosses several phases in one update after a gap', () => {
    const tr = new Triggers(route);
    const evs = tr.update(route.manAlong[1] - 20, 10);
    expect(evs.map((e) => e.to)).toEqual([Phase.PREPARE, Phase.NEAR, Phase.NOW]);
  });

  it('arrives at the end of the route', () => {
    const tr = new Triggers(route);
    tr.update(route.manAlong[1] + 20, 10);
    tr.update(route.total, 5);
    expect(tr.arrived).toBe(true);
  });
});

describe('off-route hysteresis', () => {
  it('confirms after 4 s and clears after 3 s', () => {
    const o = new OffRoute();
    expect(o.update(50, 1, 0)).toBeNull();
    expect(o.update(50, 1, 3.9)).toBeNull();
    expect(o.update(50, 1, 4.0)).toBe('confirmed');
    expect(o.update(20, 1, 5)).toBeNull();
    expect(o.update(30, 1, 6)).toBeNull(); // bounced above 25 m: clear timer restarts
    expect(o.update(20, 1, 7)).toBeNull();
    expect(o.update(20, 1, 9.9)).toBeNull();
    expect(o.update(20, 1, 10)).toBe('cleared');
  });

  it('a short excursion does not confirm', () => {
    const o = new OffRoute();
    o.update(50, 1, 0);
    o.update(50, 1, 3);
    o.update(10, 1, 3.2);
    expect(o.update(50, 1, 6)).toBeNull();
    expect(o.confirmed).toBe(false);
  });

  it('uses the wider threshold when HDOP is bad', () => {
    const o = new OffRoute();
    o.update(50, 3, 0);
    expect(o.update(50, 3, 5)).toBeNull();
  });
});

describe('dead reckoning', () => {
  it('advances for 10 s, then freezes', () => {
    const pts = path([[0, 0], [0, 3000]]);
    const route = buildRoute({ points: pts, maneuvers: [man(0, T.DEPART), man(pts.length - 1, T.ARRIVE)] });
    const nav = new Navigator(route);
    const v = 15;
    let t = 0;
    for (; t < 10; t += 0.2) nav.update(fix(pointAlong(route.points, route.C, v * t).p, t, v, 0), t);
    const lastGood = t - 0.2;
    const alongAtLoss = nav.update(null, t).along;
    let s = nav.update(null, t);
    for (; t < lastGood + NAV.DR_MAX_S - 0.1; t += 0.2) s = nav.update(null, t);
    expect(s.gps).toBe('dr');
    expect(s.along).toBeGreaterThan(alongAtLoss + v * 9);
    const frozen = nav.update(null, lastGood + NAV.DR_MAX_S + 0.5);
    expect(frozen.gps).toBe('lost');
    expect(nav.update(null, lastGood + NAV.DR_MAX_S + 5).along).toBeCloseTo(frozen.along, 6);
  });
});

describe('navigator end to end', () => {
  it('detects a wrong turn, then rejoins and continues', () => {
    const pts = path([[0, 0], [0, 1000], [600, 1000]]);
    const turnIdx = pts.findIndex((p) => Math.abs(JKT.toXY(p).y - 1000) < 0.5);
    const route = buildRoute({ points: pts, maneuvers: [man(0, T.DEPART), man(turnIdx, T.RIGHT), man(pts.length - 1, T.ARRIVE)] });
    const nav = new Navigator(route);
    let t = 0;
    const v = 10;
    // Ride 500 m north on route.
    for (let a = 0; a < 500; a += v * 0.2, t += 0.2) nav.update(fix(ll(0, a), t, v, 0), t);
    // Wrong turn: 150 m west.
    for (let x = 0; x > -150; x -= v * 0.2, t += 0.2) nav.update(fix(ll(x, 500), t, v, 270), t);
    let s = nav.update(fix(ll(-150, 500), t, v, 270), t);
    expect(s.offRoute).toBe(true);
    expect(s.rejoin).not.toBeNull();
    expect(Math.abs(s.rejoin!.bearing - bearing(ll(-150, 500), ll(0, 500)))).toBeLessThan(20);
    // Come back and continue north.
    for (let x = -150; x < 0; x += v * 0.2, t += 0.2) nav.update(fix(ll(x, 500), t, v, 90), t);
    for (let a = 500; a < 700; a += v * 0.2, t += 0.2) s = nav.update(fix(ll(0, a), t, v, 0), t);
    expect(s.offRoute).toBe(false);
    expect(s.next).toBe(1);
    expect(nav.events.some((e) => e.kind === 'offroute')).toBe(true);
    expect(nav.events.some((e) => e.kind === 'rejoined')).toBe(true);
  });

  it('resumes from persisted progress after a reset', () => {
    const pts = path([[0, 0], [0, 3000]]);
    const route = buildRoute({ points: pts, maneuvers: [man(0, T.DEPART), man(200, T.LEFT), man(pts.length - 1, T.ARRIVE)] });
    const nav = new Navigator(route);
    let t = 0;
    for (let a = 0; a < 1500; a += 3, t += 0.2) nav.update(fix(ll(0, a), t, 15, 0), t);
    const saved = nav.persisted!;
    const resumed = new Navigator(route, saved);
    const s = resumed.update(fix(ll(0, 1520), 0, 15, 0), 0);
    expect(s.along).toBeCloseTo(1520, -1);
    expect(s.next).toBe(1);
  });
});
