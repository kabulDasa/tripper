// `.trb` route bundle — writer + validating reader. Spec: docs/design/bundle-format.md.
// This is a contract with the firmware (C++) and tools/trb.py: change the spec first.

import type { LatLon } from '../geo/geo';
import { crc32 } from './crc32';

export const MAGIC = 'TRB1';
export const VERSION = 1;
export const HEADER_LEN = 28;
export const POINT_LEN = 8;
export const MANEUVER_LEN = 32;
export const IMAGE_ENTRY_LEN = 16;
export const NO_IMAGE = 255;
export const MAX_IMAGES = 255;
export const FLAG_HAS_SNAPSHOTS = 1;

export enum ManeuverType {
  DEPART = 0,
  ARRIVE = 1,
  STRAIGHT = 2,
  SLIGHT_LEFT = 3,
  LEFT = 4,
  SHARP_LEFT = 5,
  UTURN_LEFT = 6,
  SLIGHT_RIGHT = 7,
  RIGHT = 8,
  SHARP_RIGHT = 9,
  UTURN_RIGHT = 10,
  KEEP_LEFT = 11,
  KEEP_RIGHT = 12,
  ROUNDABOUT = 13,
  MERGE = 14,
  FORK_LEFT = 15,
  FORK_RIGHT = 16,
  RAMP_LEFT = 17,
  RAMP_RIGHT = 18,
  WAYPOINT = 19,
}
const MAX_TYPE = ManeuverType.WAYPOINT;

export interface Maneuver {
  pointIndex: number;
  type: ManeuverType;
  /** Turn angle / 2, int8. Positive = right (clockwise). */
  modifier: number;
  exitNumber: number;
  imageIndex: number; // NO_IMAGE = none
  name: string;
}

export interface SnapImage {
  zoom: number;
  bearing: number;
  jpeg: Uint8Array;
}

export interface Manifest {
  id: string;
  name: string;
  created: string;
  total_m: number;
  source: string;
  map: { tile_size: number; img_px: number };
  [extra: string]: unknown;
}

export interface Bundle {
  manifest: Manifest;
  points: LatLon[];
  maneuvers: Maneuver[];
  images: SnapImage[];
}

export class TrbError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`${rule}: ${message}`);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * Serialise a bundle.
 * - `name_offset`/`name_len` are UTF-8 **byte** offsets into the decoded `manifest.strings`.
 * - The manifest is padded with trailing spaces (still valid JSON) so every binary
 *   section starts 4-byte aligned.
 */
export function writeTrb(b: Bundle): Uint8Array {
  if (b.points.length < 2) throw new TrbError('write', 'need at least 2 points');
  if (b.images.length > MAX_IMAGES) throw new TrbError('write', `at most ${MAX_IMAGES} images`);

  // String table, deduplicated.
  const offsets = new Map<string, { off: number; len: number }>();
  const parts: string[] = [];
  let cursor = 0;
  for (const m of b.maneuvers) {
    if (offsets.has(m.name)) continue;
    const len = enc.encode(m.name).length;
    if (len > 0xffff) throw new TrbError('write', 'name too long');
    offsets.set(m.name, { off: cursor, len });
    parts.push(m.name);
    cursor += len + 1; // NUL separator
  }
  const manifest = { ...b.manifest, strings: parts.map((p) => p + '\u0000').join('') };
  let manifestBytes = enc.encode(JSON.stringify(manifest));
  const pad = (4 - (manifestBytes.length % 4)) % 4;
  if (pad) manifestBytes = enc.encode(JSON.stringify(manifest) + ' '.repeat(pad));

  const N = b.points.length;
  const M = b.maneuvers.length;
  const K = b.images.length;
  const pointsOff = HEADER_LEN + manifestBytes.length;
  const manOff = pointsOff + POINT_LEN * N;
  const idxOff = manOff + MANEUVER_LEN * M;
  let imgOff = idxOff + IMAGE_ENTRY_LEN * K;
  const total = imgOff + b.images.reduce((s, i) => s + i.jpeg.length, 0);

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(enc.encode(MAGIC), 0);
  dv.setUint16(4, VERSION, true);
  dv.setUint16(6, K > 0 ? FLAG_HAS_SNAPSHOTS : 0, true);
  dv.setUint32(8, manifestBytes.length, true);
  dv.setUint32(12, N, true);
  dv.setUint32(16, M, true);
  dv.setUint32(20, K, true);
  out.set(manifestBytes, HEADER_LEN);

  b.points.forEach((p, i) => {
    dv.setInt32(pointsOff + i * 8, Math.round(p.lat * 1e6), true);
    dv.setInt32(pointsOff + i * 8 + 4, Math.round(p.lon * 1e6), true);
  });

  b.maneuvers.forEach((m, i) => {
    const o = manOff + i * MANEUVER_LEN;
    const s = offsets.get(m.name)!;
    dv.setUint32(o, m.pointIndex, true);
    dv.setUint8(o + 4, m.type);
    dv.setInt8(o + 5, Math.max(-90, Math.min(90, Math.round(m.modifier))));
    dv.setUint8(o + 6, m.exitNumber);
    dv.setUint8(o + 7, m.imageIndex);
    dv.setUint32(o + 8, s.off, true);
    dv.setUint16(o + 12, s.len, true);
    // 18 reserved bytes stay zero
  });

  b.images.forEach((img, i) => {
    const o = idxOff + i * IMAGE_ENTRY_LEN;
    dv.setUint32(o, imgOff, true);
    dv.setUint32(o + 4, img.jpeg.length, true);
    dv.setFloat32(o + 8, img.zoom, true);
    dv.setFloat32(o + 12, img.bearing, true);
    out.set(img.jpeg, imgOff);
    imgOff += img.jpeg.length;
  });

  dv.setUint32(24, crc32(out.subarray(HEADER_LEN)), true);
  // Self-check: DataView setters wrap silently, so a caller bug (point_index ≥ N, exit > 255…)
  // would otherwise produce a file the device rejects or misreads.
  const back = readTrb(out);
  b.maneuvers.forEach((m, i) => {
    const r = back.maneuvers[i];
    if (r.pointIndex !== m.pointIndex || r.exitNumber !== m.exitNumber || r.imageIndex !== m.imageIndex || r.type !== m.type) {
      throw new TrbError('write', `maneuver ${i} has out-of-range fields`);
    }
  });
  return out;
}

/** Parse and validate. Throws TrbError naming the failed rule (bundle-format.md § Validation). */
export function readTrb(buf: Uint8Array): Bundle {
  const len = buf.length;
  if (len < HEADER_LEN) throw new TrbError('bounds', 'file shorter than header');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Rule 1: magic + version
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== MAGIC) throw new TrbError('magic', `bad magic ${JSON.stringify(magic)}`);
  const version = dv.getUint16(4, true);
  if (version !== VERSION) throw new TrbError('version', `unsupported version ${version}`);
  const flags = dv.getUint16(6, true);
  const headerLen = dv.getUint32(8, true);
  const N = dv.getUint32(12, true);
  const M = dv.getUint32(16, true);
  const K = dv.getUint32(20, true);

  // Rule 2: CRC
  const crc = dv.getUint32(24, true);
  if (crc32(buf.subarray(HEADER_LEN)) !== crc) throw new TrbError('crc', 'CRC mismatch');

  // Rule 3: sections inside the file. Plain JS numbers can't overflow here;
  // the C++ parser must do these sums in uint64.
  if (K > MAX_IMAGES) throw new TrbError('bounds', `images_count ${K} > ${MAX_IMAGES}`);
  if (N < 2) throw new TrbError('bounds', 'need at least 2 points');
  if (((flags & FLAG_HAS_SNAPSHOTS) !== 0) !== K > 0) throw new TrbError('bounds', 'has_snapshots flag disagrees with images_count');
  const pointsOff = HEADER_LEN + headerLen;
  const manOff = pointsOff + POINT_LEN * N;
  const idxOff = manOff + MANEUVER_LEN * M;
  const dataOff = idxOff + IMAGE_ENTRY_LEN * K;
  if (dataOff > len) throw new TrbError('bounds', 'sections extend past end of file');

  let manifest: Manifest & { strings?: unknown };
  try {
    manifest = JSON.parse(dec.decode(buf.subarray(HEADER_LEN, pointsOff)));
  } catch {
    throw new TrbError('manifest', 'manifest is not valid UTF-8 JSON');
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) throw new TrbError('manifest', 'manifest is not a JSON object');
  if (typeof manifest.name !== 'string' || typeof manifest.id !== 'string') throw new TrbError('manifest', 'manifest id/name must be strings');
  if (manifest.strings !== undefined && typeof manifest.strings !== 'string') throw new TrbError('manifest', 'manifest strings must be a string');
  const stringBytes = enc.encode(typeof manifest.strings === 'string' ? manifest.strings : '');

  const points: LatLon[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const lat = dv.getInt32(pointsOff + i * 8, true) / 1e6;
    const lon = dv.getInt32(pointsOff + i * 8 + 4, true) / 1e6;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new TrbError('bounds', `point ${i} out of range`);
    points[i] = { lat, lon };
  }

  const images: SnapImage[] = new Array(K);
  for (let i = 0; i < K; i++) {
    const o = idxOff + i * IMAGE_ENTRY_LEN;
    const off = dv.getUint32(o, true);
    const ilen = dv.getUint32(o + 4, true);
    const zoom = dv.getFloat32(o + 8, true);
    const brg = dv.getFloat32(o + 12, true);
    if (off < dataOff || off + ilen > len || ilen === 0) throw new TrbError('bounds', `image ${i} outside image data`);
    if (!Number.isFinite(zoom) || zoom < 0 || zoom > 24 || !Number.isFinite(brg)) throw new TrbError('bounds', `image ${i} bad camera`);
    images[i] = { zoom, bearing: brg, jpeg: buf.subarray(off, off + ilen) };
  }

  const maneuvers: Maneuver[] = new Array(M);
  let prevIdx = 0;
  for (let i = 0; i < M; i++) {
    const o = manOff + i * MANEUVER_LEN;
    const pointIndex = dv.getUint32(o, true);
    const type = dv.getUint8(o + 4);
    const imageIndex = dv.getUint8(o + 7);
    const nameOff = dv.getUint32(o + 8, true);
    const nameLen = dv.getUint16(o + 12, true);
    // Rule 4: indices and string range
    if (pointIndex >= N) throw new TrbError('index', `maneuver ${i} point_index ${pointIndex} >= ${N}`);
    if (imageIndex !== NO_IMAGE && imageIndex >= K) throw new TrbError('index', `maneuver ${i} image_index ${imageIndex} >= ${K}`);
    if (nameOff + nameLen > stringBytes.length) throw new TrbError('index', `maneuver ${i} name out of range`);
    if (type > MAX_TYPE) throw new TrbError('index', `maneuver ${i} unknown type ${type}`);
    // Rule 5: non-decreasing point_index
    if (pointIndex < prevIdx) throw new TrbError('order', `maneuver ${i} point_index decreases`);
    prevIdx = pointIndex;
    let name: string;
    try {
      name = dec.decode(stringBytes.subarray(nameOff, nameOff + nameLen));
    } catch {
      throw new TrbError('index', `maneuver ${i} name is not UTF-8`);
    }
    maneuvers[i] = {
      pointIndex,
      type,
      modifier: dv.getInt8(o + 5),
      exitNumber: dv.getUint8(o + 6),
      imageIndex,
      name,
    };
  }

  const { strings: _strings, ...rest } = manifest;
  void _strings;
  return { manifest: rest as Manifest, points, maneuvers, images };
}

/** Width/height from the first SOF marker, or null. Used to refuse oversized images before decoding. */
export function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

/** True if the bytes are a baseline (SOF0) JPEG. TJpgDec can't decode progressive (SOF2). */
export function isBaselineJpeg(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return false;
    const marker = b[i + 1];
    if (marker === 0xc0) return true; // SOF0 baseline
    if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return false;
    if (marker === 0xd9 || marker === 0xda) return false; // EOI / SOS before any SOF
    const segLen = (b[i + 2] << 8) | b[i + 3];
    i += 2 + segLen;
  }
  return false;
}
