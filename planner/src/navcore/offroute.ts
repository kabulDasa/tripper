// Off-route detection with confirm/clear hysteresis — algorithms.md §5.

import { NAV } from './config';

export class OffRoute {
  confirmed = false;
  private candidateSince: number | null = null;
  private clearSince: number | null = null;

  /** Returns 'confirmed' / 'cleared' on transitions, else null. */
  update(perpDist: number, hdop: number, t: number): 'confirmed' | 'cleared' | null {
    if (!this.confirmed) {
      const limit = hdop > NAV.OFF_ROUTE_BAD_HDOP ? NAV.OFF_ROUTE_D_BAD_HDOP_M : NAV.OFF_ROUTE_D_M;
      if (perpDist > limit) {
        this.candidateSince ??= t;
        if (t - this.candidateSince >= NAV.OFF_ROUTE_CONFIRM_S) {
          this.confirmed = true;
          this.candidateSince = null;
          this.clearSince = null;
          return 'confirmed';
        }
      } else {
        this.candidateSince = null;
      }
    } else {
      if (perpDist < NAV.OFF_ROUTE_CLEAR_D_M) {
        this.clearSince ??= t;
        if (t - this.clearSince >= NAV.OFF_ROUTE_CLEAR_S) {
          this.confirmed = false;
          this.clearSince = null;
          return 'cleared';
        }
      } else {
        this.clearSince = null;
      }
    }
    return null;
  }

  get candidate(): boolean {
    return this.candidateSince !== null;
  }
}
