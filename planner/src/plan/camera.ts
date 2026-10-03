// Snapshot camera + overlay geometry (bundle-format.md § Snapshot images). Pure, unit-tested.

import { bearing, destination, pointAlong, type LatLon } from '../geo/geo';
import { IMG_PX, metersPerPixel } from '../geo/mercator';

export const SNAP = {
  /** Heading-up bearing is taken from the route this far before the maneuver. */
  APPROACH_M: 30,
  /** Average incoming speed above which a maneuver counts as "highway". */
  HIGHWAY_KMH: 55,
  /** Zoom by spacing to the nearest neighbouring maneuver (city), metres → zoom. */
  CITY_ZOOMS: [
    [80, 17.5],
    [200, 17],
    [Infinity, 16.5],
  ] as [number, number][],
  HIGHWAY_ZOOMS: [
    [300, 16],
    [Infinity, 15.5],
  ] as [number, number][],
  /** Outgoing leg drawn to this fraction of the image radius. */
  LEG_FRACTION: 0.75,
  /** Arrowhead size in screen pixels. */
  HEAD_LEN_PX: 22,
  HEAD_WIDTH_PX: 26,
} as const;

export function chooseZoom(spacingM: number, avgSpeedKmh: number): number {
  const table = avgSpeedKmh > SNAP.HIGHWAY_KMH ? SNAP.HIGHWAY_ZOOMS : SNAP.CITY_ZOOMS;
  for (const [max, z] of table) if (spacingM < max) return z;
  return table[table.length - 1][1];
}

/** Bearing from the point APPROACH_M before `along` to the maneuver point. */
export function approachBearing(geom: LatLon[], C: ArrayLike<number>, along: number): number {
  const at = pointAlong(geom, C, along).p;
  if (along < 1) {
    const ahead = pointAlong(geom, C, along + SNAP.APPROACH_M).p;
    return bearing(at, ahead);
  }
  const before = pointAlong(geom, C, Math.max(0, along - SNAP.APPROACH_M)).p;
  return bearing(before, at);
}

/** Route slice [from, to] metres along, including interior vertices. */
export function slice(geom: LatLon[], C: ArrayLike<number>, from: number, to: number): LatLon[] {
  const out: LatLon[] = [pointAlong(geom, C, from).p];
  for (let i = 0; i < geom.length; i++) if (C[i] > from && C[i] < to) out.push(geom[i]);
  out.push(pointAlong(geom, C, to).p);
  return out;
}

export interface Overlay {
  /** Outgoing leg from the maneuver point, ending at the arrowhead base. */
  leg: LatLon[];
  /** Arrowhead triangle (closed ring). */
  head: LatLon[];
}

export function overlayFor(geom: LatLon[], C: ArrayLike<number>, along: number, zoom: number): Overlay {
  const total = C[C.length - 1];
  const lat = pointAlong(geom, C, along).p.lat;
  const mpp = metersPerPixel(lat, zoom);
  const headLen = SNAP.HEAD_LEN_PX * mpp;
  const fullLeg = (IMG_PX / 2) * SNAP.LEG_FRACTION * mpp;
  const legLen = Math.min(total - along, fullLeg);
  // Nothing (or almost nothing) ahead, e.g. ARRIVE: highlight the final approach instead.
  if (legLen < headLen * 1.5) return { leg: slice(geom, C, Math.max(0, along - fullLeg), along), head: [] };
  const tip = pointAlong(geom, C, along + legLen).p;
  const baseCenter = pointAlong(geom, C, along + legLen - headLen).p;
  const b = bearing(baseCenter, tip);
  const half = (SNAP.HEAD_WIDTH_PX / 2) * mpp;
  const l = destination(baseCenter, b - 90, half);
  const r = destination(baseCenter, b + 90, half);
  return { leg: slice(geom, C, along, along + legLen - headLen * 0.6), head: [l, tip, r, l] };
}
