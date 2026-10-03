# Hardware & wiring

## Path A — Waveshare ESP32-S3-LCD-1.28

The display is already wired on the board. You only add the **GNSS** and **buttons** through the GPIO header.

!!! warning "Check the pinout first"
    Confirm the exact free GPIOs against the Waveshare wiki pinout for your board revision before you solder. Record the final pin map in `firmware/include/board_waveshare_128.h`. The firmware must take every pin from that header, with nothing hard-coded anywhere else.

| Function | Connect to | Notes |
|---|---|---|
| GNSS VCC | 3V3 | Most M10 breakouts take 3.3 V. Check yours |
| GNSS GND | GND | |
| GNSS TX → MCU RX | free GPIO (UART1 RX) | |
| GNSS RX ← MCU TX | free GPIO (UART1 TX) | Needed to configure 10 Hz and the dynamic model |
| GNSS PPS | optional | Not needed |
| Button A | free GPIO → GND | Internal pull-up, debounce in firmware |
| Button B | free GPIO → GND | Optional |
| BH1750 SDA/SCL | free GPIOs (I²C) | Optional. Can share the IMU's I²C bus if the address doesn't clash |

## Path B — ESP32-S3 DevKit + GC9A01 module

| GC9A01 pin | ESP32-S3 GPIO (suggested) | Notes |
|---|---|---|
| VCC | 3V3 | Run the logic at 3.3 V |
| GND | GND | |
| SCL (SCK) | GPIO 12 | FSPI clock, up to 80 MHz. Start at 40 MHz |
| SDA (MOSI) | GPIO 11 | |
| CS | GPIO 10 | |
| DC | GPIO 9 | |
| RST | GPIO 8 | Or tie it to EN |
| BLK | GPIO 7 | LEDC PWM for brightness |

| GNSS | ESP32-S3 GPIO |
|---|---|
| TX → RX | GPIO 18 (UART1 RX) |
| RX ← TX | GPIO 17 (UART1 TX) |
| VCC / GND | 3V3 / GND |

| Other | GPIO |
|---|---|
| Button A | GPIO 4 |
| Button B | GPIO 5 |
| I²C SDA/SCL (BH1750) | GPIO 1 / 2 |

!!! danger "Avoid these ESP32-S3 pins"
    - **GPIO 0, 3, 45, 46** are strapping pins.
    - **GPIO 19/20** are USB D−/D+.
    - On **N16R8 (octal PSRAM)** modules, **GPIO 33–37** are taken by the PSRAM.

## GNSS configuration

Configure this once at boot over UART, using UBX-CFG-VALSET for M10:

- Measurement rate **5 Hz** (200 ms). Go to 10 Hz only if CPU and UART allow, at 115200 baud or more.
- **Dynamic model: automotive** (4), or portable. Not "stationary".
- Constellations: GPS + Galileo + BeiDou (+ GLONASS if supported at your rate).
- Output only the sentences you need: RMC, GGA, GSA (or UBX-NAV-PVT, which is cleaner and recommended). Turn the rest off to cut UART load.
- Save to BBR/flash so a cold module wakes up in the right mode.

## Antenna placement

- The patch antenna faces **up** and sits on top of the enclosure, with nothing metal above it.
- Keep it at least 2 cm from the display's ground plane and the ESP32 antenna, or put it on a short cable on top of the case.
- Test by comparing satellite count and HDOP with the case open and closed. Closed should lose less than 2 satellites.

## Bench bring-up order

1. Flash a "hello" sketch over USB-C and get serial logs working.
2. Display: fill red → green → blue, draw a circle at the 120 px radius to check alignment, then show an FPS counter. You should get ≥ 30 fps for a full-screen push at 40 MHz SPI.
3. Backlight PWM sweep 0→100%.
4. GNSS: dump raw NMEA, then parse and show lat/lon/speed/sats on screen. Do this one by a window or outdoors.
5. Buttons: print the press/long-press events.
6. JPEG: decode a 240×240 test JPEG from LittleFS. Target is under 60 ms.

Every step has a matching milestone in the [project plan](../project-plan.md).
