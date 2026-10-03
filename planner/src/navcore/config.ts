// Tuning constants — mirror of firmware/lib/navcore/src/navcore/config.h (docs/design/algorithms.md).
// Keep the two in sync. Every value here is a field-tuning knob (M9).

export const NAV = {
  // §2 Map matching
  /** Segments searched behind lastSeg. */
  MATCH_BACK_SEGS: 5,
  /** Segments searched ahead of lastSeg. */
  MATCH_AHEAD_SEGS: 60,
  /** Cost added for a fully opposite heading (metres-equivalent). */
  HEADING_PENALTY_M: 25,
  /** Heading penalty and GNSS course are only trusted above this speed (8 km/h). */
  HEADING_MIN_SPEED_MS: 8 / 3.6,
  /** Cost per segment index matched behind lastSeg. */
  BACKWARD_PENALTY_M: 5,
  /** `along` may not jump forward more than speed·dt·factor + slack per fix. */
  MAX_JUMP_FACTOR: 1.5,
  MAX_JUMP_SLACK_M: 30,

  // §3 Trigger state machine
  /** Speed floor for timeToNext, m/s. */
  MIN_SPEED_MS: 2.0,
  PREPARE_T_S: 20,
  PREPARE_D_M: 400,
  NEAR_T_S: 8,
  NEAR_D_M: 120,
  NOW_T_S: 3,
  NOW_D_M: 30,
  /** PASSED once along > maneuverAlong + this. */
  PASSED_D_M: 15,
  /** ARRIVE can't be overshot (route ends), so it completes within this distance. Not in the docs yet. */
  ARRIVE_D_M: 15,
  /** Show the "then ↰" chip when the following maneuver is closer than this. */
  THEN_CHIP_D_M: 150,

  // §5 Off-route
  OFF_ROUTE_D_M: 40,
  OFF_ROUTE_D_BAD_HDOP_M: 60,
  OFF_ROUTE_BAD_HDOP: 2,
  OFF_ROUTE_CONFIRM_S: 4,
  OFF_ROUTE_CLEAR_D_M: 25,
  OFF_ROUTE_CLEAR_S: 3,

  // §7 GNSS dropouts
  DR_MAX_S: 10,
  /** Fixes with HDOP above this count as dropouts. */
  DR_BAD_HDOP: 5,
  /** Re-match window around the dead-reckoned position when fixes return. */
  REMATCH_RADIUS_M: 300,

  // Resilience (architecture.md)
  PERSIST_INTERVAL_S: 10,
} as const;
