// Douglas–Peucker in local metres, with vertices that must survive (maneuver points).
// simplify-js can't force-keep vertices, and dropping a maneuver vertex corrupts point_index.

import { LocalFrame, type LatLon, type Vec2 } from '../geo/geo';

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/**
 * Returns the indices of `points` to keep, ascending. Always keeps first, last and `keep`.
 * Uses one local frame for the whole route — fine for the ~3 m tolerance over a few hundred km.
 */
export function simplifyKeep(points: LatLon[], toleranceM: number, keep: Iterable<number>): number[] {
  const n = points.length;
  if (n <= 2) return [...Array(n).keys()];
  const f = new LocalFrame(points[0].lat, points[0].lon);
  const xy = points.map((p) => f.toXY(p));
  const marked = new Uint8Array(n);
  marked[0] = marked[n - 1] = 1;
  for (const k of keep) if (k >= 0 && k < n) marked[k] = 1;

  const anchors = [...marked.keys()].filter((i) => marked[i]);
  const stack: [number, number][] = [];
  for (let i = 0; i + 1 < anchors.length; i++) stack.push([anchors[i], anchors[i + 1]]);
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(xy[i], xy[a], xy[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > toleranceM) {
      marked[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return [...marked.keys()].filter((i) => marked[i]);
}
