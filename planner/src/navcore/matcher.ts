// Map matching — algorithms.md §2: windowed, forward-biased snap with heading penalty.

import { angleDiff, DEG2RAD, LocalFrame, type LatLon } from '../geo/geo';
import { NAV } from './config';
import { segAt, type Route } from './route';

export interface Fix extends LatLon {
  /** Seconds, monotonic. */
  t: number;
  /** Ground speed, m/s. */
  speed: number;
  /** Course over ground, degrees. */
  heading: number;
  hdop: number;
}

export interface Match {
  seg: number;
  t: number;
  perpDist: number;
  along: number;
  snapped: LatLon;
}

export class Matcher {
  lastSeg = 0;
  lastAlong = 0;
  /** Full-route search until re-acquired (set while off-route). */
  lost = false;
  private lastT: number | null = null;

  constructor(private readonly r: Route) {}

  reset(seg: number): void {
    this.lastSeg = seg;
    this.lastAlong = this.r.C[seg];
    this.lastT = null;
  }

  /**
   * Snap a fix. `heading` must already be the held heading (§6).
   * `alongRange` restricts the search to a window of route distance (used after dropouts, §7).
   */
  match(fix: Fix, heading: number, alongRange?: [number, number]): Match {
    const r = this.r;
    const nSeg = r.points.length - 1;
    let from: number;
    let to: number;
    if (alongRange) {
      from = segAt(r, Math.max(0, alongRange[0]));
      to = segAt(r, Math.min(r.total, alongRange[1]));
    } else if (this.lost) {
      from = 0;
      to = nSeg - 1;
    } else {
      from = Math.max(0, this.lastSeg - NAV.MATCH_BACK_SEGS);
      to = Math.min(nSeg - 1, this.lastSeg + NAV.MATCH_AHEAD_SEGS);
    }

    const dt = this.lastT === null ? null : Math.max(0, fix.t - this.lastT);
    const maxAlong =
      dt === null || this.lost || alongRange
        ? Infinity
        : this.lastAlong + fix.speed * dt * NAV.MAX_JUMP_FACTOR + NAV.MAX_JUMP_SLACK_M;
    const useHeading = fix.speed > NAV.HEADING_MIN_SPEED_MS;

    // Re-center the frame on the fix so errors never accumulate (§1).
    const f = new LocalFrame(fix.lat, fix.lon);
    let best: (Match & { cost: number }) | null = null;
    let bestAny: (Match & { cost: number }) | null = null;
    for (let s = from; s <= to; s++) {
      const a = f.toXY(r.points[s]);
      const b = f.toXY(r.points[s + 1]);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      let t = len2 > 0 ? -(a.x * vx + a.y * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const perpDist = Math.hypot(px, py);
      let cost = perpDist;
      if (useHeading) {
        const dh = angleDiff(heading, r.segBearing[s]) * DEG2RAD;
        cost += NAV.HEADING_PENALTY_M * ((1 - Math.cos(dh)) / 2);
      }
      cost += NAV.BACKWARD_PENALTY_M * Math.max(0, this.lastSeg - s);
      const along = r.C[s] + t * (r.C[s + 1] - r.C[s]);
      const cand = { seg: s, t, perpDist, along, cost, snapped: f.toLatLon({ x: px, y: py }) };
      if (!bestAny || cost < bestAny.cost) bestAny = cand;
      if (along <= maxAlong && (!best || cost < best.cost)) best = cand;
    }
    const m = best ?? bestAny!;
    this.lastSeg = m.seg;
    this.lastAlong = m.along;
    this.lastT = fix.t;
    return { seg: m.seg, t: m.t, perpDist: m.perpDist, along: m.along, snapped: m.snapped };
  }

  /** Nearest point on the route at or ahead of lastSeg — target for the off-route arrow (§5). */
  nearestAhead(p: LatLon): { snapped: LatLon; dist: number; along: number } {
    const r = this.r;
    const f = new LocalFrame(p.lat, p.lon);
    let best = { snapped: r.points[0], dist: Infinity, along: 0 };
    for (let s = Math.max(0, this.lastSeg); s < r.points.length - 1; s++) {
      const a = f.toXY(r.points[s]);
      const b = f.toXY(r.points[s + 1]);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * vx + a.y * vy) / len2)) : 0;
      const x = a.x + vx * t;
      const y = a.y + vy * t;
      const d = Math.hypot(x, y);
      if (d < best.dist) best = { snapped: f.toLatLon({ x, y }), dist: d, along: r.C[s] + t * (r.C[s + 1] - r.C[s]) };
    }
    return best;
  }
}
