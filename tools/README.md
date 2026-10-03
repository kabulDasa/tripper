# tools

| Path | Status | What |
|---|---|---|
| `check_config_sync.py` | ✅ M0 | CI check: `navcore/config.h` and `planner/src/navcore/config.ts` define the same constants |
| `check_navcore_purity.py` | ✅ M0 | CI check: `firmware/lib/navcore` includes only `<std>` and `"navcore/…"` headers (allowlist) |
| `trb.py` | planned (M3) | `.trb` writer + inspector |
| `sim/` | planned (M3) | Replay CLI: bundle + NMEA log → prompt timeline |
| `fixtures/` | planned (M3) | Golden `demo.trb` shared by the C++, Python and TS readers |
