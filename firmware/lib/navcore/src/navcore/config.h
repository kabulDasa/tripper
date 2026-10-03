// Tuning constants for navcore (docs/design/algorithms.md).
// Pure C++17: no Arduino, ESP-IDF or FreeRTOS includes anywhere under lib/navcore (CI enforces).
//
// MIRRORED in planner/src/navcore/config.ts (the browser emulator). Same names, same values:
// tools/check_config_sync.py fails CI if they drift. Every value is a field-tuning knob (M9).
#pragma once

namespace nav::cfg {

// §2 Map matching
constexpr int MATCH_BACK_SEGS = 5;               // segments searched behind lastSeg
constexpr int MATCH_AHEAD_SEGS = 60;             // segments searched ahead of lastSeg
constexpr float HEADING_PENALTY_M = 25;          // cost for a fully opposite heading
constexpr float HEADING_MIN_SPEED_MS = 8 / 3.6;  // trust course over ground above 8 km/h
constexpr float BACKWARD_PENALTY_M = 5;          // cost per segment matched behind lastSeg
constexpr float MAX_JUMP_FACTOR = 1.5;           // along may jump at most speed*dt*factor + slack
constexpr float MAX_JUMP_SLACK_M = 30;

// §3 Trigger state machine
constexpr float MIN_SPEED_MS = 2.0;   // speed floor for timeToNext
constexpr float PREPARE_T_S = 20;
constexpr float PREPARE_D_M = 400;
constexpr float NEAR_T_S = 8;
constexpr float NEAR_D_M = 120;
constexpr float NOW_T_S = 3;
constexpr float NOW_D_M = 30;
constexpr float PASSED_D_M = 15;      // PASSED once along > maneuverAlong + this
constexpr float ARRIVE_D_M = 15;      // ARRIVE can't be overshot; completes within this
constexpr float THEN_CHIP_D_M = 150;  // show "then" chip when the next maneuver is closer

// §5 Off-route
constexpr float OFF_ROUTE_D_M = 40;
constexpr float OFF_ROUTE_D_BAD_HDOP_M = 60;
constexpr float OFF_ROUTE_BAD_HDOP = 2;
constexpr float OFF_ROUTE_CONFIRM_S = 4;
constexpr float OFF_ROUTE_CLEAR_D_M = 25;
constexpr float OFF_ROUTE_CLEAR_S = 3;

// §7 GNSS dropouts
constexpr float DR_MAX_S = 10;          // dead-reckon at most this long, then freeze
constexpr float DR_BAD_HDOP = 5;        // fixes above this HDOP count as dropouts
constexpr float REMATCH_RADIUS_M = 300; // re-match window around the dead-reckoned position

// Resilience (architecture.md)
constexpr float PERSIST_INTERVAL_S = 10;

}  // namespace nav::cfg
