// Simulated rider + GNSS receiver for the pod preview.
// Rides the bundle's route, slows for turns, and can take a wrong turn or enter a tunnel.

import { bearing, destination, haversine, LocalFrame, pointAlong, type LatLon } from '../geo/geo';
import { ManeuverType } from '../bundle/trb';
import type { Fix } from '../navcore/matcher';
import type { Route } from '../navcore/route';

export interface RiderOptions {
  speedKmh: number;
  /** 1-σ horizontal GNSS error, metres. */
  noiseM: number;
  slowForTurns: boolean;
}

const ACCEL = 2.0; // m/s²
const DECEL = 3.0; // m/s²
const TURN_SPEED = 20 / 3.6;
const UTURN_SPEED = 10 / 3.6;
/** GNSS error correlation per epoch (AR(1)); real receiver error wanders, it isn't white. */
const NOISE_CORR = 0.9;

function gaussian(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export class Rider {
  t = 0;
  along = 0;
  speed = 0;
  pos: LatLon;
  heading: number;
  mode: 'route' | 'detour' | 'return' = 'route';
  tunnel = false;
  private detourHeading = 0;
  private returnFromSeg = 0;
  private err = { x: 0, y: 0 };

  constructor(
    private readonly r: Route,
    private readonly rand: () => number = Math.random,
  ) {
    this.pos = r.points[0];
    this.heading = r.segBearing[0] ?? 0;
  }

  get finished(): boolean {
    return this.mode === 'route' && this.along >= this.r.total - 0.01;
  }

  /** Wrong turn: leave the route to the left (the easy turn in left-hand traffic). */
  startDetour(): void {
    if (this.mode !== 'route') return;
    this.mode = 'detour';
    this.detourHeading = (this.heading + 270) % 360;
    this.returnFromSeg = pointAlong(this.r.points, this.r.C, this.along).seg;
  }

  endDetour(): void {
    if (this.mode === 'detour') this.mode = 'return';
  }

  step(dt: number, o: RiderOptions): void {
    this.t += dt;
    let target = o.speedKmh / 3.6;
    if (this.mode === 'route' && o.slowForTurns) target = Math.min(target, this.turnLimit());
    if (this.finished) target = 0;
    this.speed = this.speed < target ? Math.min(target, this.speed + ACCEL * dt) : Math.max(target, this.speed - DECEL * dt);
    const ds = this.speed * dt;

    if (this.mode === 'route') {
      this.along = Math.min(this.r.total, this.along + ds);
      const { p, seg } = pointAlong(this.r.points, this.r.C, this.along);
      this.pos = p;
      this.heading = this.r.segBearing[seg] ?? this.heading;
    } else if (this.mode === 'detour') {
      this.heading = this.detourHeading;
      this.pos = destination(this.pos, this.heading, ds);
    } else {
      const target = this.nearestAhead();
      const d = haversine(this.pos, target.p);
      if (d <= ds + 1) {
        this.mode = 'route';
        this.along = target.along;
        this.pos = target.p;
      } else {
        this.heading = bearing(this.pos, target.p);
        this.pos = destination(this.pos, this.heading, ds);
      }
    }
  }

  /** One GNSS epoch. null = no fix (tunnel). */
  gnss(o: RiderOptions): Fix | null {
    const sd = o.noiseM * Math.sqrt(1 - NOISE_CORR * NOISE_CORR);
    this.err.x = this.err.x * NOISE_CORR + gaussian(this.rand) * sd;
    this.err.y = this.err.y * NOISE_CORR + gaussian(this.rand) * sd;
    if (this.tunnel) return null;
    const f = new LocalFrame(this.pos.lat, this.pos.lon);
    const p = f.toLatLon(this.err);
    const moving = this.speed > 0.5;
    return {
      ...p,
      t: this.t,
      speed: Math.max(0, this.speed + gaussian(this.rand) * 0.15),
      heading: moving ? (this.heading + gaussian(this.rand) * 3 + 360) % 360 : this.rand() * 360,
      hdop: 0.7 + o.noiseM / 8,
    };
  }

  /** Max speed allowed now so we can brake down to turn speed at the next sharp maneuver. */
  private turnLimit(): number {
    const { maneuvers, manAlong } = this.r;
    let limit = Infinity;
    for (let i = 0; i < maneuvers.length; i++) {
      const d = manAlong[i] - this.along;
      if (d < -15 || d > 400) continue;
      const m = maneuvers[i];
      const uturn = m.type === ManeuverType.UTURN_LEFT || m.type === ManeuverType.UTURN_RIGHT;
      const sharp = uturn || m.type === ManeuverType.ROUNDABOUT || Math.abs(m.modifier * 2) >= 40;
      if (!sharp) continue;
      const vTurn = uturn ? UTURN_SPEED : TURN_SPEED;
      limit = Math.min(limit, Math.sqrt(vTurn * vTurn + 2 * DECEL * Math.max(0, d - 10)));
    }
    return limit;
  }

  private nearestAhead(): { p: LatLon; along: number } {
    const r = this.r;
    const f = new LocalFrame(this.pos.lat, this.pos.lon);
    let best = { p: r.points[r.points.length - 1], along: r.total, d: Infinity };
    for (let s = this.returnFromSeg; s < r.points.length - 1; s++) {
      const a = f.toXY(r.points[s]);
      const b = f.toXY(r.points[s + 1]);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * vx + a.y * vy) / len2)) : 0;
      const d = Math.hypot(a.x + vx * t, a.y + vy * t);
      if (d < best.d) best = { p: f.toLatLon({ x: a.x + vx * t, y: a.y + vy * t }), along: r.C[s] + t * (r.C[s + 1] - r.C[s]), d };
    }
    return best;
  }
}
