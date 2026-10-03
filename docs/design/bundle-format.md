# Route bundle format (`.trb`)

A single file containing everything the pod needs for one route. It is designed for the device side: the ESP32 can `seek()` straight to any snapshot without parsing JSON or unzipping anything.

## Layout

All integers are **little-endian**.

```
offset  size  field
0       4     magic            "TRB1"
4       2     version          1
6       2     flags            bit0: has_snapshots
8       4     header_len       bytes of the JSON manifest
12      4     points_count     N route points
16      4     maneuvers_count  M
20      4     images_count     K
24      4     crc32            CRC-32 (IEEE) of everything after this 28-byte header
28      ...   manifest         UTF-8 JSON, header_len bytes
...     8*N   points           int32 lat_e6, int32 lon_e6 (degrees × 1e6)
...     32*M  maneuvers        fixed-size records (below)
...     16*K  image index      uint32 offset, uint32 length, float32 zoom, float32 bearing
...     ...   image data       baseline JPEGs, 240×240
```

Image offsets are measured from the start of the file.

!!! tip "Why int32 × 1e6"
    1e-6° is about 11 cm, which is far more precise than GNSS. It halves the size compared with doubles, and it lets the device keep everything as fixed-point until it needs local metric math.

### Maneuver record (32 bytes)

| Field | Type | Notes |
|---|---|---|
| `point_index` | uint32 | Index into `points` where the maneuver happens |
| `type` | uint8 | See the enum below |
| `modifier` | int8 | Turn angle bucket, in −180..180 / 2 (so it fits in an int8) |
| `exit_number` | uint8 | Roundabout exit, 0 if not applicable |
| `image_index` | uint8 | 255 = no snapshot (so at most 255 snapshots per bundle) |
| `name_offset` | uint32 | Byte offset into `manifest.strings` |
| `name_len` | uint16 | |
| `reserved` | 18 bytes | Zeroed. Room for lane hints later |

### Maneuver `type` enum

```
0 DEPART       1 ARRIVE       2 STRAIGHT     3 SLIGHT_LEFT   4 LEFT
5 SHARP_LEFT   6 UTURN_LEFT   7 SLIGHT_RIGHT 8 RIGHT         9 SHARP_RIGHT
10 UTURN_RIGHT 11 KEEP_LEFT   12 KEEP_RIGHT  13 ROUNDABOUT   14 MERGE
15 FORK_LEFT   16 FORK_RIGHT  17 RAMP_LEFT   18 RAMP_RIGHT   19 WAYPOINT
```

These map directly from OSRM/Mapbox `maneuver.type` + `maneuver.modifier`. The mapping table lives in the planner (`planner/src/maneuvers.ts`) and is covered by tests.

## Manifest (JSON)

```json
{
  "id": "2026-10-04-ancol-to-puncak",
  "name": "Ancol → Puncak",
  "created": "2026-10-04T05:30:00Z",
  "total_m": 78240,
  "source": "osrm",
  "map": { "tile_size": 512, "img_px": 240 },
  "strings": "Jl. Gunung Sahari\u0000Jl. Raya Bogor\u0000..."
}
```

Keep the manifest small. Everything bulky goes in the binary sections.

## Snapshot images

- 240×240 **baseline** JPEG (TJpgDec doesn't support progressive), quality about 70. Each image is roughly 10–18 KB.
- **Centered on the maneuver point**, rotated **heading-up**, using the bearing of the route about 30 m *before* the maneuver.
- Zoom picked by maneuver spacing. Typically z16.5–17.5 in the city and z15–16 on highways.
- The route line is drawn into the image (thick, high-contrast). The live position dot is drawn **on the device**.
- `zoom` and `bearing` are stored per image so the device can project live GNSS positions onto it. See [algorithms § projection](algorithms.md#4-projecting-the-live-dot-onto-a-snapshot).

## Size budget

| Route | Points | Maneuvers | Images | Size |
|---|---|---|---|---|
| City, 15 km | ~800 | ~40 | 40 | ~0.6 MB |
| Day trip, 150 km | ~6,000 | ~120 | 120 | ~2 MB |
| Big tour, 600 km | ~25,000 | ~250 | 250 | ~4.5 MB |

Simplify the polyline on the planner (Douglas–Peucker, about 3 m tolerance) before writing it.

## Validation (device side)

Reject the bundle and keep the previous route if any of these fail:

1. Magic or version mismatch.
2. CRC mismatch.
3. Any section extends past the end of the file.
4. `point_index` ≥ N, `image_index` ≥ K (except 255), or the string range is out of bounds.
5. Maneuver `point_index` values aren't non-decreasing.
