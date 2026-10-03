import { LocalFrame, type LatLon } from '../src/geo/geo';
import { ManeuverType, type Bundle, type Maneuver } from '../src/bundle/trb';

/** Local frame at Monas, Jakarta. */
export const JKT = new LocalFrame(-6.1754, 106.8272);

export const ll = (x: number, y: number): LatLon => JKT.toLatLon({ x, y });

/** Densify a polyline given in local metres so segments are ≤ `step` m. */
export function path(xy: [number, number][], step = 10): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i + 1 < xy.length; i++) {
    const [ax, ay] = xy[i];
    const [bx, by] = xy[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push(ll(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  out.push(ll(...xy[xy.length - 1]));
  return out;
}

export function man(pointIndex: number, type: ManeuverType, name = ''): Maneuver {
  return { pointIndex, type, modifier: 0, exitNumber: 0, imageIndex: 255, name };
}

/** Smallest valid baseline JPEG header-ish byte stream: SOI, APP0 stub, SOF0, EOI. */
export function fakeJpeg(fill = 0): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, fill, fill, 0xff, 0xc0, 0x00, 0x04, 0x08, 0x00, 0xff, 0xd9]);
}

export function sampleBundle(): Bundle {
  const points = path([[0, 0], [0, 500], [400, 500]], 50);
  return {
    manifest: {
      id: 'test',
      name: 'Test → Rute',
      created: '2026-10-03T00:00:00Z',
      total_m: 900,
      source: 'test',
      map: { tile_size: 512, img_px: 240 },
    },
    points,
    maneuvers: [
      man(0, ManeuverType.DEPART, 'Jl. Medan Merdeka'),
      { ...man(10, ManeuverType.RIGHT, 'Jl. Kebon Sirih'), modifier: 45, imageIndex: 0 },
      { ...man(points.length - 1, ManeuverType.ARRIVE, 'Gg. Ñoño 3 — ujung'), imageIndex: 1 },
    ],
    images: [
      { zoom: 17, bearing: 0, jpeg: fakeJpeg(1) },
      { zoom: 16.5, bearing: 90, jpeg: fakeJpeg(2) },
    ],
  };
}
