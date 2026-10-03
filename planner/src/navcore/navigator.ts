// Ties matcher, triggers, off-route, heading hold (§6) and dead reckoning (§7) together.
// One `update` per GNSS epoch; pass `null` when the receiver produced no usable fix.

import { bearing, pointAlong, type LatLon } from '../geo/geo';
import type { ManeuverType } from '../bundle/trb';
import { NAV } from './config';
import { Matcher, type Fix } from './matcher';
import { OffRoute } from './offroute';
import type { Route } from './route';
import { Phase, Triggers, type PhaseEvent } from './triggers';

export type GpsStatus = 'ok' | 'dr' | 'lost';

export interface NavState {
  phase: Phase;
  /** Index of the upcoming maneuver (=== maneuvers.length when arrived). */
  next: number;
  arrived: boolean;
  d: number;
  t: number;
  speed: number;
  perpDist: number;
  along: number;
  /** Snapped (or dead-reckoned) position — use this for the dot, not the raw fix. */
  pos: LatLon;
  heading: number;
  gps: GpsStatus;
  offRoute: boolean;
  offCandidate: boolean;
  /** Off-route: bearing/distance from the rider to the nearest route point ahead. */
  rejoin: { bearing: number; dist: number } | null;
  /** Type of the maneuver after next, if it follows within THEN_CHIP_D_M. */
  thenType: ManeuverType | null;
}

export type NavEvent =
  | ({ kind: 'phase'; time: number } & PhaseEvent)
  | { kind: 'offroute'; time: number; perpDist: number }
  | { kind: 'rejoined'; time: number; along: number }
  | { kind: 'gps'; time: number; status: GpsStatus };

/** What the firmware writes to NVS every PERSIST_INTERVAL_S. */
export interface Persisted {
  seg: number;
}

export class Navigator {
  readonly matcher: Matcher;
  readonly triggers: Triggers;
  readonly offRoute = new OffRoute();
  events: NavEvent[] = [];
  persisted: Persisted | null = null;

  private along = 0;
  private heading = 0;
  private lastSpeed = 0;
  private lastGoodT: number | null = null;
  private lastTick: number | null = null;
  private lastPersist = -Infinity;
  private needRematch = false;
  private gps: GpsStatus = 'lost';
  private perpDist = 0;
  private lastFix: LatLon | null = null;

  constructor(
    readonly route: Route,
    resume?: Persisted,
  ) {
    this.matcher = new Matcher(route);
    this.triggers = new Triggers(route);
    if (resume) {
      this.matcher.reset(resume.seg);
      this.along = route.C[resume.seg];
      this.triggers.restart(this.along);
      this.needRematch = true;
    }
    this.heading = route.segBearing[this.matcher.lastSeg] ?? 0;
  }

  update(fix: Fix | null, now: number): NavState {
    const dt = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const good = fix !== null && fix.hdop <= NAV.DR_BAD_HDOP;

    if (good) {
      if (fix.speed > NAV.HEADING_MIN_SPEED_MS) this.heading = fix.heading;
      // While off-route the matcher already searches the whole route; don't narrow it.
      const m = this.needRematch && !this.offRoute.confirmed
        ? this.matcher.match(fix, this.heading, [this.along - NAV.REMATCH_RADIUS_M, this.along + NAV.REMATCH_RADIUS_M])
        : this.matcher.match(fix, this.heading);
      this.needRematch = false;
      this.perpDist = m.perpDist;
      this.lastFix = fix;
      this.setGps('ok', now);

      const tr = this.offRoute.update(m.perpDist, fix.hdop, now);
      if (tr === 'confirmed') {
        this.matcher.lost = true;
        this.events.push({ kind: 'offroute', time: now, perpDist: m.perpDist });
      } else if (tr === 'cleared') {
        this.matcher.lost = false;
        this.along = m.along;
        this.triggers.restart(this.along);
        this.events.push({ kind: 'rejoined', time: now, along: m.along });
      }
      if (!this.offRoute.confirmed) {
        this.along = m.along;
        this.pushPhases(this.triggers.update(this.along, fix.speed), now);
      }
      this.lastSpeed = fix.speed;
      this.lastGoodT = now;
    } else if (this.lastGoodT !== null && now - this.lastGoodT <= NAV.DR_MAX_S && !this.offRoute.confirmed) {
      // Dead-reckon along the route at the last speed.
      this.along = Math.min(this.route.total, this.along + this.lastSpeed * dt);
      this.needRematch = true;
      this.setGps('dr', now);
      this.pushPhases(this.triggers.update(this.along, this.lastSpeed), now);
    } else {
      this.needRematch = this.lastGoodT !== null;
      this.setGps('lost', now);
    }

    if (now - this.lastPersist >= NAV.PERSIST_INTERVAL_S) {
      this.persisted = { seg: this.matcher.lastSeg };
      this.lastPersist = now;
    }
    return this.state(fix);
  }

  private pushPhases(evs: PhaseEvent[], now: number): void {
    for (const e of evs) this.events.push({ kind: 'phase', time: now, ...e });
  }

  private setGps(s: GpsStatus, now: number): void {
    if (s !== this.gps) this.events.push({ kind: 'gps', time: now, status: s });
    this.gps = s;
  }

  private state(fix: Fix | null): NavState {
    const r = this.route;
    const tr = this.triggers;
    const speed = this.gps === 'ok' && fix ? fix.speed : this.gps === 'dr' ? this.lastSpeed : 0;
    const d = tr.distTo(this.along);
    let rejoin: NavState['rejoin'] = null;
    if (this.offRoute.confirmed && this.lastFix) {
      const n = this.matcher.nearestAhead(this.lastFix);
      rejoin = { bearing: bearing(this.lastFix, n.snapped), dist: n.dist };
    }
    let thenType: ManeuverType | null = null;
    const nx = tr.next;
    if (nx + 1 < r.maneuvers.length && r.manAlong[nx + 1] - r.manAlong[nx] < NAV.THEN_CHIP_D_M) {
      thenType = r.maneuvers[nx + 1].type;
    }
    const pos =
      this.offRoute.confirmed && this.lastFix ? this.lastFix : pointAlong(r.points, r.C, this.along).p;
    return {
      phase: tr.phase,
      next: nx,
      arrived: tr.arrived,
      d,
      t: d / Math.max(speed, NAV.MIN_SPEED_MS),
      speed,
      perpDist: this.perpDist,
      along: this.along,
      pos,
      heading: this.heading,
      gps: this.gps,
      offRoute: this.offRoute.confirmed,
      offCandidate: this.offRoute.candidate,
      rejoin,
      thenType,
    };
  }
}
