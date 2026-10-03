// Pluggable routing (docs/build/planner.md). Both providers return OSRM-format steps.
//
// Default is Valhalla `motorcycle` costing with tolls avoided: motorcycles are generally
// banned from Indonesian toll roads, and the public OSRM demo only has a car profile and
// rejects every `exclude=` value.

import type { LatLon } from '../geo/geo';

export interface RouteStep {
  /** Index into RouteResult.geometry where this step's maneuver happens. */
  geomIndex: number;
  type: string;
  modifier?: string;
  exit?: number;
  name: string;
  ref?: string;
  drivingSide: 'left' | 'right';
  bearingBefore: number;
  bearingAfter: number;
  distance: number;
  duration: number;
  /** True for the final `arrive` of the whole route (vs. arriving at a via point). */
  isFinal: boolean;
  /** Leg number (0-based); every leg starts with a `depart` step. */
  legIndex: number;
}

export interface RouteResult {
  geometry: LatLon[];
  steps: RouteStep[];
  distance: number;
  duration: number;
  source: string;
  warnings: string[];
}

export interface RoutingProvider {
  readonly id: string;
  readonly label: string;
  route(waypoints: LatLon[], signal?: AbortSignal): Promise<RouteResult>;
}

interface OsrmStep {
  name?: string;
  ref?: string;
  driving_side?: 'left' | 'right';
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  maneuver: { type: string; modifier?: string; exit?: number; bearing_before?: number; bearing_after?: number };
}
interface OsrmResponse {
  code?: string;
  message?: string;
  error?: string;
  status_message?: string;
  routes?: { distance: number; duration: number; legs: { steps: OsrmStep[] }[] }[];
}

/** Flatten OSRM legs/steps into one polyline with each step's maneuver index. */
export function parseOsrm(res: OsrmResponse, source: string): RouteResult {
  if (res.code !== 'Ok' || !res.routes?.length) {
    throw new Error(`${source}: ${res.message ?? res.error ?? res.status_message ?? res.code ?? 'no route'}`);
  }
  const r = res.routes[0];
  const bad = (what: string) => new Error(`${source}: malformed response (${what})`);
  if (!Array.isArray(r.legs)) throw bad('legs');
  const geometry: LatLon[] = [];
  const steps: RouteStep[] = [];
  r.legs.forEach((leg, li) => {
    if (!Array.isArray(leg.steps)) throw bad('steps');
    leg.steps.forEach((s) => {
      const coords = s?.geometry?.coordinates;
      if (!Array.isArray(coords) || !s.maneuver || typeof s.maneuver.type !== 'string') throw bad('step');
      let start = geometry.length;
      coords.forEach(([lon, lat], ci) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw bad('coordinate');
        const prev = geometry[geometry.length - 1];
        if (prev && prev.lat === lat && prev.lon === lon) {
          if (ci === 0) start = geometry.length - 1; // shared joint with the previous step
          return; // drop zero-length segments
        }
        geometry.push({ lat, lon });
      });
      steps.push({
        geomIndex: Math.min(start, geometry.length - 1),
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        exit: s.maneuver.exit,
        name: s.name ?? '',
        ref: s.ref,
        drivingSide: s.driving_side ?? 'right',
        bearingBefore: s.maneuver.bearing_before ?? 0,
        bearingAfter: s.maneuver.bearing_after ?? 0,
        distance: s.distance,
        duration: s.duration,
        isFinal: li === r.legs.length - 1,
        legIndex: li,
      });
    });
  });
  if (geometry.length < 2) throw bad('route has fewer than 2 points');
  return { geometry, steps, distance: r.distance, duration: r.duration, source, warnings: [] };
}

async function fetchJson(url: string, init: RequestInit): Promise<OsrmResponse> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return body as OsrmResponse;
}

export class ValhallaProvider implements RoutingProvider {
  readonly id = 'valhalla';
  readonly label = 'Valhalla · motorcycle, no tolls (FOSSGIS)';
  constructor(private readonly base = 'https://valhalla1.openstreetmap.de') {}

  async route(waypoints: LatLon[], signal?: AbortSignal): Promise<RouteResult> {
    const body = {
      locations: waypoints.map((p) => ({ lat: p.lat, lon: p.lon })),
      costing: 'motorcycle',
      costing_options: { motorcycle: { use_tolls: 0, use_highways: 0.3 } },
      format: 'osrm',
      shape_format: 'geojson',
    };
    const res = await fetchJson(`${this.base}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return parseOsrm(res, 'valhalla');
  }
}

export class OsrmProvider implements RoutingProvider {
  readonly id = 'osrm';
  readonly label = 'OSRM demo · car profile, may use tolls';
  constructor(private readonly base = 'https://router.project-osrm.org') {}

  async route(waypoints: LatLon[], signal?: AbortSignal): Promise<RouteResult> {
    const coords = waypoints.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const url = `${this.base}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`;
    const r = parseOsrm(await fetchJson(url, { signal }), 'osrm');
    r.warnings.push('OSRM demo uses a car profile: the route may include toll roads that motorcycles may not use.');
    return r;
  }
}

export const PROVIDERS: RoutingProvider[] = [new ValhallaProvider(), new OsrmProvider()];
