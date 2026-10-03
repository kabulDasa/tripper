// Route geometry precomputed once at bundle load.

import { bearing, cumulative, type LatLon } from '../geo/geo';
import type { Bundle, Maneuver } from '../bundle/trb';

export interface Route {
  points: LatLon[];
  /** Cumulative distance C[i], metres. */
  C: Float64Array;
  /** Bearing of segment i (points[i] → points[i+1]), degrees. */
  segBearing: Float64Array;
  maneuvers: Maneuver[];
  /** Along-route distance of each maneuver. */
  manAlong: Float64Array;
  total: number;
}

export function buildRoute(b: Pick<Bundle, 'points' | 'maneuvers'>): Route {
  const C = cumulative(b.points);
  const segBearing = new Float64Array(Math.max(0, b.points.length - 1));
  for (let i = 0; i < segBearing.length; i++) segBearing[i] = bearing(b.points[i], b.points[i + 1]);
  const manAlong = new Float64Array(b.maneuvers.length);
  b.maneuvers.forEach((m, i) => (manAlong[i] = C[m.pointIndex]));
  return { points: b.points, C, segBearing, maneuvers: b.maneuvers, manAlong, total: C[C.length - 1] };
}

/** Segment index containing along-distance `a`. */
export function segAt(r: Route, a: number): number {
  let lo = 0;
  let hi = r.points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.C[mid] <= a) lo = mid;
    else hi = mid;
  }
  return lo;
}
