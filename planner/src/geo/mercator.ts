// Web Mercator snapshot projection — mirror of algorithms.md §4.
// 512-px tiles (MapLibre convention), y grows south, map rotated so `bearing` points up.

import { DEG2RAD, type Vec2 } from './geo';

export const IMG_PX = 240;
export const TILE_SIZE = 512;

export interface SnapCamera {
  lat: number;
  lon: number;
  zoom: number;
  bearing: number; // degrees
}

export function worldPx(lat: number, lon: number, zoom: number): Vec2 {
  const ws = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * ws;
  const phi = lat * DEG2RAD;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * ws;
  return { x, y };
}

/** Screen coords (0..240) of a lat/lon on a snapshot rendered with camera `s`. */
export function toScreen(lat: number, lon: number, s: SnapCamera): Vec2 {
  const c = worldPx(s.lat, s.lon, s.zoom);
  const p = worldPx(lat, lon, s.zoom);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const b = s.bearing * DEG2RAD;
  const sx = dx * Math.cos(b) + dy * Math.sin(b);
  const sy = -dx * Math.sin(b) + dy * Math.cos(b);
  return { x: IMG_PX / 2 + sx, y: IMG_PX / 2 + sy };
}

/** Ground metres per screen pixel at a latitude and zoom (512-px tiles). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos(lat * DEG2RAD)) / (TILE_SIZE * Math.pow(2, zoom));
}
