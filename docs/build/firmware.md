# Firmware

## Toolchain

- **PlatformIO** (VS Code extension or `pip install platformio`), Arduino framework on ESP32-S3.
- You can move to pure ESP-IDF later if needed. `navcore` stays portable either way.

## `platformio.ini`

The real file is `firmware/platformio.ini`. Its shape:

```ini
[platformio]
default_envs = waveshare128

; ESP32-S3 boards only. The native env must NOT inherit this, or it picks up
; framework = arduino and fails.
[esp32s3]
platform = platformio/espressif32@7.1.3
framework = arduino
board = esp32-s3-devkitc-1
board_upload.flash_size = 16MB          ; the devkitc-1 default is 8 MB
board_build.partitions = partitions_16mb.csv
board_build.filesystem = littlefs
build_unflags = -std=gnu++11
build_flags = -std=gnu++17 -DCORE_DEBUG_LEVEL=3

[env:waveshare128]
extends = esp32s3
board_build.arduino.memory_type = qio_qspi   ; 2 MB quad PSRAM
build_flags = ${esp32s3.build_flags} -DBOARD_WAVESHARE_128 -DBOARD_HAS_PSRAM

[env:devkit_n16r8]
extends = esp32s3
board_build.arduino.memory_type = qio_opi    ; 8 MB octal PSRAM
build_flags = ${esp32s3.build_flags} -DBOARD_DEVKIT_N16R8 -DBOARD_HAS_PSRAM

[env:native]
platform = native
test_framework = unity
build_flags = -std=c++17 -Wall -Wextra -Werror -DNATIVE
lib_ignore = hal
```

Libraries (LovyanGFX, TJpg_Decoder, SparkFun u-blox GNSS v3, QRCode) are added to `[esp32s3] lib_deps` in M1, when they are first used, **with pinned versions**. Record those versions in [libraries](../reference/libraries.md).

Pins come only from `include/board_*.h`, selected by `include/board.h`. Both maps start with `BOARD_PINS_CONFIRMED 0`. The Waveshare map is all `-1` until its pinout has been checked against the wiki in M1.

## Partition table (`partitions_16mb.csv`)

Two OTA app slots plus a big LittleFS partition for bundles:

```
# Name,   Type, SubType, Offset,   Size
nvs,      data, nvs,     0x9000,   0x5000
otadata,  data, ota,     0xe000,   0x2000
app0,     app,  ota_0,   0x10000,  0x300000
app1,     app,  ota_1,   0x310000, 0x300000
littlefs, data, spiffs,  0x610000, 0x9F0000
```

That gives about 9.9 MB of LittleFS. Keep **two bundle slots** (`/routes/active.trb`, `/routes/incoming.trb`). Uploads go to `incoming` and only get renamed after validation passes.

## Display

- **LovyanGFX** with a `Panel_GC9A01` config: 240×240, SPI at 40 MHz to start, then try 80 MHz.
- Render into a **240×240 RGB565 sprite** (115 KB, in PSRAM) and push it with DMA. Only redraw what changed: for example, on the junction screen, decode the JPEG once into a background sprite, then each frame copy the background and draw the dot.
- **TJpg_Decoder** decodes the snapshot JPEGs straight from LittleFS into the sprite.
- Fonts: use smooth (VLW) or LVGL-converted fonts for distance and road names. The built-in bitmap fonts are too thin at a glance.
- LVGL is optional. With only about 8 screens, hand-drawn LovyanGFX keeps things simpler. Add LVGL only if the UI grows.

## Upload mode (Wi-Fi AP + HTTP)

- SoftAP SSID `TRIPPER-xxxx` with a WPA2 password printed on the screen, plus a QR code (`WIFI:T:WPA;S:...;P:...;;`).
- Endpoints:

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/status` | — | fw version, free space, active route id/name |
| `PUT` | `/api/bundle` | raw `.trb` bytes | Streamed to `incoming.trb`, validated, swapped in |
| `GET` | `/api/routes` | — | Optional, multi-route library |
| `POST` | `/api/ota` | firmware `.bin` | Later milestone |

- Send CORS headers (`Access-Control-Allow-Origin: *`) so the PWA can upload with `fetch()`.

!!! warning "Mixed content"
    A PWA served over **HTTPS** can't `fetch()` an `http://192.168.4.1` device. That's a browser mixed-content rule. Workarounds, in order of preference:

    1. The **device serves the uploader page itself** (a tiny HTML+JS page in LittleFS). The phone opens `http://192.168.4.1`, picks the `.trb` it saved from the planner, and uploads it. Same origin, no problem.
    2. A native or Capacitor wrapper app.
    3. BLE transfer (later).

    Start with option 1.

## Module map

```
firmware/
  include/board_*.h          pin maps per board
  lib/navcore/src/navcore/  geo.h, bundle.h, matcher.h, triggers.h, offroute.h, config.h  (#include "navcore/...")
  lib/hal/                   gnss.*, display.*, storage.*, buttons.*, backlight.*
  src/main.cpp               task setup
  src/tasks/                 gnss_task, nav_task, ui_task, net_task
  src/screens/               boot, idle, upload, arrow, junction, offroute, arrived, cruise
  data/                      uploader index.html, test JPEGs, demo bundle
  test/test_navcore/         native Unity tests
```
