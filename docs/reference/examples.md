# Example projects

Prior art worth reading before writing code. They are sorted by how closely they match this design.

## Closest matches

### moto2000 — Royal Enfield Tripper replacement
<https://github.com/dev-ale/moto2000>

A waterproof round AMOLED that **replaces the stock Tripper pod on a Scram 411**. It uses a Waveshare ESP32-S3 1.75" AMOLED (466×466) connected over BLE to an iOS companion app.

- **Borrow:** the enclosure/mount approach for a Tripper-style pod, BLE protocol structure (control/status channels), OTA over BLE, CI for firmware + app, and a PRD-style spec document.
- **Different from us:** the ESP32 is a deliberately "dumb display" and the iPhone does everything, including location. There's no standalone GPS, so it still depends on the phone link.

### IceNav v3 — standalone ESP32 GPS navigator
<https://github.com/jgauchia/icenav-v3>

An ESP32/ESP32-S3 GPS navigator with **offline vector maps** on SD, using LVGL + LovyanGFX and its own GNSS module.

- **Borrow:** GNSS handling, LovyanGFX + LVGL setup on S3, map tile rendering ideas, IMU/compass handling. It's the best reference for "the device navigates by itself".
- **Different from us:** a bigger 320×480 screen, renders full maps on device. We pre-render junction snapshots on the phone instead.

### BLE-bike-navigation — route polyline to an ESP32
<https://github.com/alexanderlavrushko/BLE-bike-navigation>

An iOS app tracks location, takes the nearby part of a planned route, converts it into lines and sends them to an ESP32 (TTGO T-Display or 128×128 OLED) over BLE.

- **Borrow:** ideas for drawing the route geometry on a tiny screen, and iOS background-BLE handling if you later add a live link.

## Google Maps / app-forwarding pods (live link)

### ChronosESP32 + Chronos app
<https://github.com/fbiego/chronos-esp32>

An Arduino library that turns an ESP32 into a "smartwatch" for the **Chronos** Android app, including forwarding of Google Maps navigation. The author also lists a "Chronos Navio" navigation firmware.

- **Use as:** a **fallback/live mode** (milestone M8). If no bundle is loaded, show Google Maps turn-by-turn from Chronos. It's also the fastest way to see something working on day one.

### esp32-c3-mini (VanTC-Navi fork)
<https://github.com/vantechcorner/esp32-c3-mini>

Firmware for ESP32-S3/C3 boards focused on Google Maps navigation through the Chronos protocol. It uses LVGL fonts generated with `lv_font_conv`, including extended Latin ranges.

- **Borrow:** the navigation screen layouts and the font-generation workflow (useful for Indonesian street names).

### esp32_komoot_ble
<https://github.com/juppees/esp32_komoot_ble>

A turn-by-turn device using Komoot's official **BLE Connect API**, and it includes a **3D-printable case**.

- **Borrow:** the case design, and Komoot BLE as another optional live source.

### mini-oled-navigation
<https://github.com/hyutrn/mini-oled-navigation>

A minimal ESP32 + SSD1306 motorcycle nav display using ChronosESP32. A useful "smallest possible" reference.

### Engotta (IndiaFOSS 2025 talk)
<https://fossunited.org/c/indiafoss/2025/cfp/b3hd06oqbv>

An open-hardware scooter/bike nav display with an ESP32, a 0.96" OLED and an RTC. It has a good problem statement and has been road-tested on two-wheelers in South Asian traffic.

## Hardware references

- **Waveshare ESP32-S3-LCD-1.28** product page and wiki (pinout, demos): <https://www.waveshare.com/esp32-s3-lcd-1.28.htm>
- **SparkFun MAX-M10S** breakout and hookup guide (u-blox M10, 10 Hz, UART/I²C): <https://www.sparkfun.com/products/18037>

## What nobody seems to have combined yet

As far as this research found, none of the projects above combine all three of these:

1. A **pre-planned bundle** with **phone-rendered junction snapshots**
2. **On-device GNSS** progress tracking and time-based prompts
3. A **Tripper-style round pod**

That combination is this project's niche.
