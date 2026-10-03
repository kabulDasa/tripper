# Shopping list

!!! warning "Prices are rough"
    Prices are rough Indonesian marketplace estimates (Tokopedia/Shopee) as of October 2026, plus official list prices where noted. Check before buying, and buy from sellers with clear photos of the actual board. Clones vary a lot.

## Choose your core: Path A or Path B

=== "Path A — integrated board (recommended)"

    **Waveshare ESP32-S3-LCD-1.28**: ESP32-S3 with the GC9A01 1.28" round IPS display already on the board.

    - 16 MB flash, 2 MB PSRAM, Wi-Fi + BLE 5, USB-C, onboard **QMI8658 6-axis IMU**, LiPo charger header, GPIO header.
    - List price is US$15.99 at Waveshare. The touch version (`ESP32-S3-Touch-LCD-1.28`) adds a CST816S, but you don't need touch on a bike.
    - Why: no flying display wires to vibrate loose, and it has a known pinout with vendor demo code.

=== "Path B — the module you already have + a devkit"

    The bare **GC9A01 1.28" SPI module** (the one in the listing photo) plus an **ESP32-S3 DevKitC N16R8** (16 MB flash / 8 MB PSRAM).

    - It's cheaper, has more PSRAM and more free GPIO, and it's easier to add microSD.
    - Downside: 7–8 jumper wires that you'll have to solder and strain-relieve for vibration. Use this path for the bench prototype even if the final build uses Path A.

## Bill of materials

| # | Part | Qty | Est. price (IDR) | Notes |
|---|---|---|---|---|
| 1 | Waveshare ESP32-S3-LCD-1.28 **or** ESP32-S3 N16R8 devkit | 1 | 280–400k / 90–150k | See Path A/B above |
| 2 | GC9A01 1.28" round SPI module (Path B only) | 1 | 45–80k | Already have one |
| 3 | GNSS module: **u-blox M10-based** (e.g. MAX-M10S breakout, or BE-880/BN-880-style M10 clones) | 1 | 150–350k | 10 Hz capable, GPS+Galileo+BeiDou+GLONASS. Must have a backup battery/supercap for hot start |
| 3b | *Budget alternative:* ATGM336H GNSS module | 1 | 40–80k | Works for prototyping. Weaker in urban canyons and usually 1 Hz by default (configurable) |
| 4 | Active or ceramic patch GNSS antenna (if not on the module) | 1 | 30–80k | Needs a clear view of the sky, on top of the enclosure |
| 5 | **Motorcycle 12 V → 5 V USB-C converter**, waterproof, ≥2 A | 1 | 60–150k | Must be load-dump/spike tolerant. Avoid bare LM2596 boards |
| 6 | Inline blade fuse holder + 2 A fuse | 1 | 10–25k | Close to the power tap |
| 7 | USB-C cable, right-angle, short (30–50 cm) | 1 | 25–60k | Right angle keeps the case compact |
| 8 | Momentary buttons, IP67, 12–16 mm, metal | 1–2 | 15–40k each | Glove-friendly |
| 9 | 3D-printed enclosure (ASA/PETG, **light colour**) | 1 | 50–150k (print service) | See [power & mounting](power-and-mounting.md) |
| 10 | Clear front window: 2 mm acrylic or polycarbonate disc + **anti-glare film** | 1 | 20–60k | AG film is the biggest sunlight-readability win per rupiah |
| 11 | Mount: 1" RAM-style ball + short arm + handlebar/mirror-stem clamp | 1 | 100–350k | Or a Tripper-style bracket on the handlebar clamp |
| 12 | Conformal coating spray (acrylic) | 1 | 80–150k | Coat the board, mask the connectors |
| 13 | Silicone wire 24–26 AWG, heat-shrink, JST-SH/GH pigtails | — | 50–100k | |
| 14 | Optional: BH1750 ambient light sensor | 1 | 15–30k | Auto-brightness |
| 15 | Optional: microSD breakout + card (Path B) | 1 | 20k + card | Multi-route library |
| 16 | Optional: 400–600 mAh LiPo | 1 | 40–80k | Lets the pod survive cranking brownouts and short power cuts |

**Typical total:** about **Rp 700k–1.3 M** depending on path, GNSS choice and mount.

## Tools

- Temperature-controlled soldering iron, flux, solder wick
- Multimeter
- USB-to-serial adapter (CH340/CP2102). Optional, useful for talking to the GNSS directly with u-center
- Hot glue or E6000, and kapton tape
- Laptop with VS Code + PlatformIO

## Don't buy

- **Large non-IPS TFTs**: poor viewing angles once mounted.
- **Cheap "car charger" buck converters** with no spike protection.
- **NEO-6M modules** as the main GNSS: very old, slow to get a fix, and weak in the city. Fine for a bench test.
- **Black enclosures**: the LCD will overheat in Jakarta sun.
