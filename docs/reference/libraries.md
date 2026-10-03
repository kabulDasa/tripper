# Libraries & APIs

## Firmware

| Library | Use | Link |
|---|---|---|
| LovyanGFX | GC9A01 driver, sprites, DMA, fonts | <https://github.com/lovyan03/LovyanGFX> |
| TFT_eSPI | Alternative display driver | <https://github.com/Bodmer/TFT_eSPI> |
| TJpg_Decoder | Baseline JPEG → RGB565 | <https://github.com/Bodmer/TJpg_Decoder> |
| SparkFun u-blox GNSS v3 | UBX config + NAV-PVT | <https://github.com/sparkfun/SparkFun_u-blox_GNSS_v3> |
| TinyGPSPlus | NMEA parsing (for non-u-blox modules) | <https://github.com/mikalhart/TinyGPSPlus> |
| LVGL | Optional richer UI | <https://lvgl.io> |
| ChronosESP32 | Optional Google Maps live mode | <https://github.com/fbiego/chronos-esp32> |
| QRCode | Wi-Fi QR on the upload screen | <https://github.com/ricmoo/QRCode> |
| Unity | Native unit tests (bundled with PlatformIO) | <https://docs.platformio.org/en/latest/advanced/unit-testing/> |

## Planner

| Library / API | Use | Link |
|---|---|---|
| MapLibre GL JS | Map UI + snapshot rendering | <https://maplibre.org> |
| OpenFreeMap | Free vector tiles | <https://openfreemap.org> |
| OSRM | Routing (demo server for testing) | <https://project-osrm.org> |
| GraphHopper / Valhalla | Routing alternatives | <https://www.graphhopper.com> · <https://valhalla.github.io/valhalla/> |
| Mapbox Static Images API | Quick-start snapshots (`lon,lat,zoom,bearing`, Web Mercator) | <https://docs.mapbox.com/api/maps/static-images/> |
| @mapbox/polyline | Polyline encode/decode | <https://github.com/mapbox/polyline> |
| simplify-js | Douglas–Peucker simplification | <https://github.com/mourner/simplify-js> |
| vite-plugin-pwa | Installable/offline PWA | <https://vite-pwa-org.netlify.app> |

## Tools

- **u-center 2** (u-blox): inspect and configure the M10 module over USB-serial.
- **GPSBabel**: convert GPX/KML/NMEA for fixtures.
- **gpx.studio**: hand-edit test routes in the browser.
