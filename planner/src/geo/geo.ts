// Geo math — TypeScript mirror of navcore `geo` (docs/design/algorithms.md §1).
// lat/lon stay in double precision (JS numbers); local metres are fine too.

export const R_EARTH = 6371008.8; // mean Earth radius, metres
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Equirectangular frame around (lat0, lon0): x east, y north, metres. */
export class LocalFrame {
  readonly cosLat0: number;
  constructor(
    readonly lat0: number,
    readonly lon0: number,
  ) {
    this.cosLat0 = Math.cos(lat0 * DEG2RAD);
  }

  toXY(p: LatLon): Vec2 {
    return {
      x: (p.lon - this.lon0) * DEG2RAD * R_EARTH * this.cosLat0,
      y: (p.lat - this.lat0) * DEG2RAD * R_EARTH,
    };
  }

  toLatLon(v: Vec2): LatLon {
    return {
      lat: this.lat0 + (v.y / R_EARTH) * RAD2DEG,
      lon: this.lon0 + (v.x / (R_EARTH * this.cosLat0)) * RAD2DEG,
    };
  }
}

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = (b.lon - a.lon) * DEG2RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG2RAD) * Math.cos(b.lat * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial great-circle bearing a→b, degrees clockwise from north, [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const f1 = a.lat * DEG2RAD;
  const f2 = b.lat * DEG2RAD;
  const dl = (b.lon - a.lon) * DEG2RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return normalizeDeg(Math.atan2(y, x) * RAD2DEG);
}

/** Point reached from `p` after `dist` metres on `brg` (degrees). Small-distance approximation. */
export function destination(p: LatLon, brg: number, dist: number): LatLon {
  const f = new LocalFrame(p.lat, p.lon);
  const b = brg * DEG2RAD;
  return f.toLatLon({ x: Math.sin(b) * dist, y: Math.cos(b) * dist });
}

export function normalizeDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed smallest difference b − a in degrees, (−180, 180]. Positive = clockwise (right). */
export function angleDiff(a: number, b: number): number {
  let d = normalizeDeg(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Cumulative distance along a polyline, metres. C[0] = 0. */
export function cumulative(points: LatLon[]): Float64Array {
  const c = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) c[i] = c[i - 1] + haversine(points[i - 1], points[i]);
  return c;
}

/** Position at distance `along` (metres) on a polyline with cumulative distances `c`. */
export function pointAlong(points: LatLon[], c: ArrayLike<number>, along: number): { p: LatLon; seg: number } {
  const n = points.length;
  if (along <= 0) return { p: points[0], seg: 0 };
  if (along >= c[n - 1]) return { p: points[n - 1], seg: Math.max(0, n - 2) };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid] <= along) lo = mid;
    else hi = mid;
  }
  const len = c[lo + 1] - c[lo];
  const t = len > 0 ? (along - c[lo]) / len : 0;
  const a = points[lo];
  const b = points[lo + 1];
  return { p: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }, seg: lo };
}
