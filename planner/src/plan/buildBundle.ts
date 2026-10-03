// Route → .trb bundle (planner.md § Flow, steps 2–4).

import { cumulative, type LatLon } from '../geo/geo';
import { ManeuverType, MAX_IMAGES, NO_IMAGE, writeTrb, type Bundle, type Maneuver, type SnapImage } from '../bundle/trb';
import { approachBearing, chooseZoom, overlayFor, type Overlay } from './camera';
import { mapStep, shortName, turnModifier } from './maneuvers';
import type { RouteResult } from './routing';
import { simplifyKeep } from './simplify';

export const SIMPLIFY_TOLERANCE_M = 3;

export interface SnapshotJob {
  index: number;
  center: LatLon;
  zoom: number;
  bearing: number;
  overlay: Overlay;
}

export type SnapshotRenderer = (job: SnapshotJob) => Promise<Uint8Array>;

export interface BuildOptions {
  name: string;
  renderer?: SnapshotRenderer;
  onProgress?: (done: number, total: number) => void;
  /** Snapshots rendered in parallel. The renderer must support this many concurrent calls. */
  concurrency?: number;
  /** Aborts the build between snapshots. */
  signal?: AbortSignal;
  now?: Date;
}

export interface BuildResult {
  bundle: Bundle;
  bytes: Uint8Array;
}

export function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 40);
}

export async function buildBundle(route: RouteResult, opts: BuildOptions): Promise<BuildResult> {
  const geom = route.geometry;
  const C = cumulative(geom);

  // Steps → maneuvers on the full-resolution geometry.
  const raw: { geomIndex: number; type: ManeuverType; exit: number; modifier: number; name: string; speedKmh: number }[] = [];
  route.steps.forEach((s, si) => {
    const m = mapStep(s);
    if (!m) return;
    // Incoming speed = average over the step that leads into this maneuver.
    const prev = route.steps[si - 1];
    const speedKmh = prev && prev.duration > 0 ? (prev.distance / prev.duration) * 3.6 : 0;
    raw.push({
      geomIndex: s.geomIndex,
      type: m.type,
      exit: m.exit,
      modifier: m.type === ManeuverType.DEPART ? 0 : turnModifier(s.bearingBefore, s.bearingAfter),
      name: shortName(s.name || s.ref || ''),
      speedKmh,
    });
  });

  // Simplify, keeping every maneuver vertex.
  const kept = simplifyKeep(geom, SIMPLIFY_TOLERANCE_M, raw.map((m) => m.geomIndex));
  const remap = new Map<number, number>();
  kept.forEach((g, i) => remap.set(g, i));
  const points = kept.map((i) => geom[i]);

  // Plan one snapshot per maneuver (except DEPART), in maneuver order, capped at MAX_IMAGES.
  const jobs: SnapshotJob[] = [];
  const imageOf = new Map<number, number>();
  raw.forEach((m, i) => {
    if (!opts.renderer || m.type === ManeuverType.DEPART || jobs.length >= MAX_IMAGES) return;
    const along = C[m.geomIndex];
    const prev = i > 0 ? along - C[raw[i - 1].geomIndex] : Infinity;
    const next = i + 1 < raw.length ? C[raw[i + 1].geomIndex] - along : Infinity;
    const zoom = chooseZoom(Math.min(prev, next), m.speedKmh);
    imageOf.set(i, jobs.length);
    jobs.push({ index: i, center: geom[m.geomIndex], zoom, bearing: approachBearing(geom, C, along), overlay: overlayFor(geom, C, along, zoom) });
  });

  // Render with bounded parallelism; results land at their planned index.
  const images: SnapImage[] = new Array(jobs.length);
  let cursor = 0;
  let done = 0;
  let failed = false;
  const worker = async () => {
    while (cursor < jobs.length && !failed) {
      opts.signal?.throwIfAborted();
      const k = cursor++;
      const job = jobs[k];
      try {
        images[k] = { zoom: job.zoom, bearing: job.bearing, jpeg: await opts.renderer!(job) };
      } catch (e) {
        failed = true; // stop the other workers taking new jobs
        throw e;
      }
      opts.onProgress?.(++done, jobs.length);
    }
  };
  // allSettled so no worker is still running when we return or throw.
  const results = await Promise.allSettled(Array.from({ length: Math.min(opts.concurrency ?? 1, jobs.length) }, worker));
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected) throw rejected.reason;
  opts.signal?.throwIfAborted();

  const maneuvers: Maneuver[] = raw.map((m, i) => ({
    pointIndex: remap.get(m.geomIndex)!,
    type: m.type,
    modifier: m.modifier,
    exitNumber: m.exit,
    imageIndex: imageOf.get(i) ?? NO_IMAGE,
    name: m.name,
  }));

  const now = opts.now ?? new Date();
  const bundle: Bundle = {
    manifest: {
      id: `${now.toISOString().slice(0, 10)}-${slug(opts.name) || 'route'}`,
      name: opts.name,
      created: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      total_m: Math.round(C[C.length - 1]),
      source: route.source,
      map: { tile_size: 512, img_px: 240 },
    },
    points,
    maneuvers,
    images,
  };
  return { bundle, bytes: writeTrb(bundle) };
}
