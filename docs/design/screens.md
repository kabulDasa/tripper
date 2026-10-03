# Screens & UX

The display is a 32 mm circle viewed at arm's length while moving. **Readable in under a second** beats everything else.

## Rules for a round 240×240 face

- Safe content area: the inscribed square is only about 170×170 px. Put text in the middle band and use the rim for rings and progress arcs.
- Minimum text height: **28 px** for distance, **18 px** for street names (truncate them, never wrap past two lines).
- High contrast. Default to a dark background with white and amber. Add a "day" theme (black on white) and test both in direct midday sun.
- No animation except the NOW-phase ring flash.
- **Nothing needs touch.** Inputs are 1–2 physical buttons that work with gloves (see [hardware](../build/hardware.md)).

## Screen list

| Screen | When | Content |
|---|---|---|
| Boot | Power-on | Logo, firmware version, GNSS status |
| No route | No active bundle | Clock, speed, satellites, "Hold button for upload mode" |
| Upload mode | Long-press, or no route | Wi-Fi SSID/password as text **and a QR code**, upload progress |
| Arrow (FAR/PREPARE) | Navigating | Maneuver icon (~110 px), distance, road name, progress arc on the rim |
| Junction (NEAR/NOW) | Within ~8 s or 120 m | Snapshot JPEG, live dot/arrow, distance pill at the bottom, "then ↰" chip |
| Off-route | Confirmed off-route | Bearing arrow to the route, distance, "Off route" |
| Arrived | ARRIVE passed | Checkered flag, trip distance/time |
| Cruise | Long straight (>3 km to next) | Big speed, next-turn distance small, clock |

## Buttons

| Button | Short press | Long press |
|---|---|---|
| A | Cycle Arrow ↔ Cruise ↔ Snapshot preview | Upload mode (at boot or when stopped) |
| B (optional) | Brightness step | Day/Night theme |

## Brightness

- Drive the BLK pin with PWM (LEDC, about 5 kHz to avoid visible flicker on camera).
- Optional ambient light sensor (BH1750 or similar on I²C) for automatic brightness. Without one, switch day/night by time of day using GNSS time and an approximate sunrise/sunset for Jakarta.
