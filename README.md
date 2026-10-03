# Tripper DIY

[![CI](https://github.com/kabulDasa/tripper/actions/workflows/ci.yml/badge.svg)](https://github.com/kabulDasa/tripper/actions/workflows/ci.yml)

An offline-first, Tripper-style motorcycle navigation pod (ESP32-S3 + 1.28" round GC9A01 + u-blox M10 GNSS).

- Docs: `pip install mkdocs-material && mkdocs serve`
- Plan: `docs/project-plan.md`
- **Try it without hardware:** `cd planner && npm ci && npm run dev`, then open <http://localhost:5173>. Plan a route on the map, build a `.trb` bundle, and ride it on the emulated round display in the **Pod** tab (simulated GPS, wrong turns, tunnels, brownouts). Run the tests with `npm test`.
- Planning and routing send your waypoints to public services (Valhalla at `valhalla1.openstreetmap.de` or the OSRM demo) and load tiles from OpenFreeMap. Use them lightly, and don't rely on them for a ride.
- `npm run dev:lan` exposes the dev server to your local network, for testing on a phone.
- Firmware: `cd firmware && pio test -e native && pio run` (PlatformIO; versions pinned in `firmware/requirements.txt`). The M0 skeleton only boots and prints board info.
- Status: design stage. Only the planner and pod preview exist; firmware and tools follow the milestones in `docs/project-plan.md`.
