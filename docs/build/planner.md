# Route planner (PWA)

A static web app that works the same on iPhone and Android. It plans a route, renders the junction snapshots and writes a `.trb` file. Host it on GitHub Pages or Cloudflare Pages.

## Stack

- **Vite + TypeScript**, no framework needed (or Svelte if you prefer).
- **MapLibre GL JS** for the interactive planning map and for rendering snapshots.
- Tiles: **OpenFreeMap** (free vector tiles, no API key) or a Mapbox/MapTiler key.
- Routing (pluggable via a `RoutingProvider` interface). All providers return OSRM-format steps:
    - **Valhalla** `motorcycle` costing with `use_tolls: 0` (default, public FOSSGIS server `valhalla1.openstreetmap.de`, light use only). Motorcycles are generally banned from Indonesian toll roads, so the router must avoid them
    - **OSRM** (`router.project-osrm.org` is a demo server with a **car profile only**; it rejects every `exclude=` value, so it can't avoid tolls. Fine for personal testing, but don't hammer it)
    - **GraphHopper** or **Valhalla** (free tiers, motorcycle-ish profiles)
    - **GPX import** (from OsmAnd, Organic Maps or Komoot), with maneuvers derived from the geometry
- `vite-plugin-pwa` so it installs and works offline for the *bundle-writing* parts.

## Flow

1. Pick a start (current location) and a destination, plus optional via points.
2. Route → steps → maneuvers. Map them to the [type enum](../design/bundle-format.md#maneuver-type-enum).
3. **Render snapshots.** For each maneuver:
    1. Move a hidden 240×240 MapLibre map (with `pixelRatio: 1` and `preserveDrawingBuffer: true`) to `center = maneuver point`, `bearing = approach bearing`, `zoom = f(spacing, road class)`.
    2. Draw the route as a thick line layer, with the next leg in a highlight colour.
    3. Wait for `idle`, then `canvas.toBlob('image/jpeg', 0.7)`.
    4. Re-encode as **baseline** JPEG if the browser emits progressive. Chrome and Safari emit baseline for canvas, but add a check.
4. Simplify the polyline, write the `.trb` and compute the CRC.
5. Save the file (download / share sheet) **and** offer "Upload to pod" instructions: join the pod's Wi-Fi → open `192.168.4.1` → pick the file.

!!! tip "Quick-start alternative"
    The **Mapbox Static Images API** can return a 240×240 image for a `lon,lat,zoom,bearing` camera with a path overlay in one URL. It's handy for a first prototype. Watch the URL length limit (8,192 characters) and the Mapbox terms on storing images offline. Rendering with MapLibre in the browser avoids both issues.

## Snapshot style

- A custom minimal style: roads in light grey with no labels except the target street, buildings off, water muted.
- The route line is 8–10 px, high-contrast (amber on dark), with a clear arrowhead at the turn.
- Test on the real screen. A style that looks good on a laptop is often unreadable on a 32 mm disc in sunlight.

## Bundle writer tests (Vitest)

- Round-trip: write a bundle → parse with a TS reader → identical.
- **Golden file:** `tools/fixtures/demo.trb` must parse identically in the TS reader, the Python inspector and C++ `navcore` (native test). This is the contract between the phone and the device.
- Maneuver mapping table: one test per OSRM `type`/`modifier` combination.

## Pod preview (no hardware)

The planner has a second tab, **Pod**, that emulates the device so the whole flow can be tested before buying parts:

- Loads a `.trb` through the same validating reader the device uses. A corrupt file is rejected and the previous route stays loaded.
- Runs a TypeScript port of `navcore` (`planner/src/navcore/`: matcher, trigger phases, off-route, heading hold, dead reckoning, persisted resume). It follows [algorithms](../design/algorithms.md) exactly, and its constants mirror `navcore/config.h`. Once the C++ `navcore` exists, compile it to WASM and drop the port, so the two can't drift.
- Draws the [screens](../design/screens.md) on a 240×240 canvas: arrow, junction snapshot with the live dot, cruise, off-route, arrived, upload, boot, plus day/night themes and the A/B buttons (short and long press).
- A simulated rider drives the route with adjustable speed, correlated GNSS noise, slowing for sharp turns, a **wrong turn**, a **tunnel** (no fixes) and a **brownout reset**. A timeline in the `tools/sim` format logs every phase change.
- "Save screen PNG" exports the current screen for `docs/img/screens/`.

```bash
cd planner
npm ci
npm run dev        # http://localhost:5173
npm run dev:lan    # also on your LAN, for a phone on the same Wi-Fi (plain http: no service worker or geolocation there)
npm test
npm run build && npm run preview   # production build with the service worker
```

## Live demo and recordings

- **GitHub Pages:** <https://kabuldasa.github.io/tripper/> is deployed from `main` by `.github/workflows/pages.yml`.
- **Deep links:**
    - `#demo` opens the Pod tab with the bundled sample route (`planner/public/demo.trb`).
    - `#pod` opens the Pod tab.
    - `?from=lat,lon&to=lat,lon` (plus optional repeated `via=lat,lon`) pre-fills the Plan tab's waypoints.
- **Re-recording the demo:** `npm run demo:record` builds the app, then drives your installed Google Chrome headlessly with `playwright-core`. It plans, builds and rides the sample route, then rewrites `public/demo.trb`, `docs/img/demo-app.gif` and `docs/img/demo-pod.gif` (the GIFs are encoded with `gifenc`). It needs network access for routing and tiles.
