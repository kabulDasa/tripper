// Junction snapshot renderer: a hidden 240×240 MapLibre map, heading-up, JPEG out.
// planner.md § Render snapshots / § Snapshot style.

import { Map as MlMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { LatLon } from '../geo/geo';
import { IMG_PX } from '../geo/mercator';
import { isBaselineJpeg } from '../bundle/trb';
import type { SnapshotJob } from './buildBundle';

export const JPEG_QUALITY = 0.7;
const IDLE_TIMEOUT_MS = 15000;
const LOAD_TIMEOUT_MS = 20000;

const ROUTE_DIM = '#8a6414';
const ROUTE_HI = '#ffb000';

const line = (pts: LatLon[]): Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) },
});
const poly = (pts: LatLon[]): Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: pts.length ? [pts.map((p) => [p.lon, p.lat])] : [] },
});
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Minimal dark style: grey roads, muted water, no buildings, no labels. */
export function snapshotStyle(): StyleSpecification {
  const roadWidth = (major: number, minor: number) =>
    ['interpolate', ['exponential', 1.6], ['zoom'], 14, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], major * 0.35, minor * 0.35], 18, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], major * 3, minor * 3]] as unknown as number;
  return {
    version: 8,
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      route: { type: 'geojson', data: empty },
      leg: { type: 'geojson', data: empty },
      head: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#14171c' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#1d2a38' } },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['minor', 'service', 'track', 'path'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3a4049', 'line-width': roadWidth(6, 5) },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#5c636e', 'line-width': roadWidth(9, 7) },
      },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-width': 13 },
      },
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_DIM, 'line-width': 9 },
      },
      {
        id: 'leg',
        type: 'line',
        source: 'leg',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_HI, 'line-width': 10 },
      },
      { id: 'head-casing', type: 'line', source: 'head', paint: { 'line-color': '#000', 'line-width': 2 } },
      { id: 'head', type: 'fill', source: 'head', paint: { 'fill-color': ROUTE_HI } },
    ],
  };
}

export class SnapshotRenderer {
  private map: MlMap;
  private ready: Promise<void>;
  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: `${IMG_PX}px`,
      height: `${IMG_PX}px`,
    });
    document.body.appendChild(this.container);
    this.map = new MlMap({
      container: this.container,
      style: snapshotStyle(),
      pixelRatio: 1,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      center: [106.8, -6.2],
      zoom: 16,
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('map style did not load (offline or tile server unavailable?)')), LOAD_TIMEOUT_MS);
      this.map.once('load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.ready.catch(() => undefined); // surfaced by the first render/setRoute
  }

  async setRoute(geom: LatLon[]): Promise<void> {
    await this.ready;
    (this.map.getSource('route') as GeoJSONSource).setData(line(geom));
  }

  render = async (job: SnapshotJob): Promise<Uint8Array> => {
    await this.ready;
    await (this.map.getSource('leg') as GeoJSONSource).setData(line(job.overlay.leg));
    await (this.map.getSource('head') as GeoJSONSource).setData(job.overlay.head.length ? poly(job.overlay.head) : empty);
    this.map.jumpTo({ center: [job.center.lon, job.center.lat], zoom: job.zoom, bearing: job.bearing, pitch: 0 });
    if (!(await this.idle()) || !this.map.areTilesLoaded()) {
      throw new Error(`map tiles did not load for snapshot #${job.index} (network?)`);
    }
    const blob = await new Promise<Blob | null>((res) => this.map.getCanvas().toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('canvas.toBlob returned null');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isBaselineJpeg(bytes)) throw new Error('browser produced a non-baseline JPEG; TJpgDec cannot decode it');
    return bytes;
  };

  /** Resolves true when the map went idle, false on timeout. */
  private idle(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), IDLE_TIMEOUT_MS);
      this.map.once('idle', () => {
        clearTimeout(timer);
        resolve(true);
      });
      this.map.triggerRepaint();
    });
  }

  destroy(): void {
    this.map.remove();
    this.container.remove();
  }
}

/** Several hidden maps so tile loading for different junctions overlaps. */
export class SnapshotPool {
  private all: SnapshotRenderer[];
  private free: SnapshotRenderer[];
  private waiters: ((r: SnapshotRenderer) => void)[] = [];

  constructor(readonly size: number) {
    this.all = Array.from({ length: size }, () => new SnapshotRenderer());
    this.free = [...this.all];
  }

  /** Call only between builds (the plan view never runs two at once). */
  async setRoute(geom: LatLon[]): Promise<void> {
    await Promise.all(this.all.map((r) => r.setRoute(geom)));
  }

  destroy(): void {
    this.all.forEach((r) => r.destroy());
    this.all = [];
    this.free = [];
  }

  render = async (job: SnapshotJob): Promise<Uint8Array> => {
    const r = this.free.pop() ?? (await new Promise<SnapshotRenderer>((res) => this.waiters.push(res)));
    try {
      return await r.render(job);
    } finally {
      const next = this.waiters.shift();
      if (next) next(r);
      else this.free.push(r);
    }
  };
}
