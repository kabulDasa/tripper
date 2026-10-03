# Testing & field trials

Navigation bugs only show up on real roads. The strategy is to **record once, replay forever**.

## Test layers

| Layer | Tool | Runs where | Proves |
|---|---|---|---|
| Unit | Unity (`pio test -e native`) | Laptop/CI | Geo math, projection, matcher, triggers, bundle parser |
| Contract | Golden `.trb` fixture | Laptop/CI | Planner and device agree on the format |
| Replay | `tools/sim` | Laptop/CI | Real rides produce the right prompt timeline |
| Bench | Device + recorded NMEA fed over USB serial | Desk | Rendering, timing, memory |
| Field | Device on the bike | Road | Readability, GNSS in Jakarta conditions, mount and heat |

## Replay simulator

`tools/sim` builds `navcore` natively:

```bash
tools/sim/build/tripper-sim --bundle rides/ancol-puncak.trb \
                            --nmea rides/2026-10-12-ancol-puncak.nmea
```

It prints a timeline:

```
00:03:12.4  M#7 RIGHT "Jl. Gunung Sahari"  FAR→PREPARE  d=402m t=19.8s v=73km/h
00:03:24.6  M#7                            PREPARE→NEAR d=118m t=5.8s
00:03:28.0  M#7                            NEAR→NOW     d=29m  t=2.9s
00:03:30.2  M#7                            PASSED
00:07:51.0  OFF-ROUTE confirmed  perp=63m
```

Assertions are written as small YAML expectations per recorded ride, for example "M#7 enters NEAR between 4–10 s before PASSED" or "no off-route between 00:10 and 00:25". They run in CI.

## Recording rides

- Firmware has a **logger mode** that writes raw NMEA/UBX to LittleFS (or microSD), so you can ride without a route and collect data.
- Collect these specifically:
    - [ ] Inner Jakarta high-rise corridor (urban canyon)
    - [ ] A flyover with a road underneath (stacked roads)
    - [ ] A tunnel or underpass (dropout)
    - [ ] Toll road at speed (early prompts at 80–100 km/h)
    - [ ] Dense *gang* streets with junctions under 50 m apart
    - [ ] A roundabout
    - [ ] A deliberate wrong turn (off-route and recovery)

## Field checklist (each firmware release)

- [ ] Midday sun: arrow screen readable at a glance (under 1 s) with sunglasses
- [ ] Night: no glare at minimum brightness
- [ ] Engine cranking: pod resumes navigation in under 5 s
- [ ] 2-hour ride in the sun: no dimming/blackout, case not too hot to touch
- [ ] Rain test (hose, not jet): no fogging inside the window after 24 h
- [ ] Mount: screen readable with the engine idling, no visible buzz blur
