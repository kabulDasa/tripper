// Trigger state machine — algorithms.md §3.
// FAR → PREPARE → NEAR → NOW → PASSED, forward only. Several phases may be
// crossed in one update (tight junctions, or a fix after a gap).

import { ManeuverType } from '../bundle/trb';
import { NAV } from './config';
import type { Route } from './route';

export enum Phase {
  FAR = 'FAR',
  PREPARE = 'PREPARE',
  NEAR = 'NEAR',
  NOW = 'NOW',
  PASSED = 'PASSED',
}

export interface PhaseEvent {
  maneuver: number;
  from: Phase;
  to: Phase;
  d: number;
  t: number;
  speed: number;
}

export class Triggers {
  /** Index of the maneuver being approached; === maneuvers.length once arrived. */
  next = 0;
  phase = Phase.FAR;

  constructor(private readonly r: Route) {
    this.restart(0);
  }

  get arrived(): boolean {
    return this.next >= this.r.maneuvers.length;
  }

  /** Point at the first maneuver ahead of `along`, phase FAR. Used at start, after off-route, after reset. */
  restart(along: number): void {
    const ms = this.r.maneuvers;
    let i = 0;
    // DEPART at the start point is not a prompt.
    while (i < ms.length && (ms[i].type === ManeuverType.DEPART || this.r.manAlong[i] + NAV.PASSED_D_M < along)) i++;
    this.next = i;
    this.phase = Phase.FAR;
  }

  distTo(along: number): number {
    return this.arrived ? 0 : this.r.manAlong[this.next] - along;
  }

  update(along: number, speed: number): PhaseEvent[] {
    const events: PhaseEvent[] = [];
    for (let guard = 0; guard < 4 * this.r.maneuvers.length + 4 && !this.arrived; guard++) {
      if (this.r.maneuvers[this.next].type === ManeuverType.DEPART) {
        this.next++; // never a prompt, wherever it appears
        continue;
      }
      const d = this.r.manAlong[this.next] - along;
      const t = d / Math.max(speed, NAV.MIN_SPEED_MS);
      const isArrive = this.r.maneuvers[this.next].type === ManeuverType.ARRIVE;
      let to: Phase | null = null;
      switch (this.phase) {
        case Phase.FAR:
          if (t <= NAV.PREPARE_T_S || d <= NAV.PREPARE_D_M) to = Phase.PREPARE;
          break;
        case Phase.PREPARE:
          if (t <= NAV.NEAR_T_S || d <= NAV.NEAR_D_M) to = Phase.NEAR;
          break;
        case Phase.NEAR:
          if (t <= NAV.NOW_T_S || d <= NAV.NOW_D_M) to = Phase.NOW;
          break;
        case Phase.NOW:
          if (isArrive ? d <= NAV.ARRIVE_D_M : -d > NAV.PASSED_D_M) to = Phase.PASSED;
          break;
      }
      if (!to) break;
      events.push({ maneuver: this.next, from: this.phase, to, d, t, speed });
      if (to === Phase.PASSED) {
        this.next++;
        this.phase = Phase.FAR;
      } else {
        this.phase = to;
      }
    }
    return events;
  }
}
