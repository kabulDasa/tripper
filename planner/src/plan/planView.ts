// Plan tab: pick waypoints → route → maneuvers → render snapshots → .trb.

import { LngLatBounds, Map as MlMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import { cumulative, type LatLon } from '../geo/geo';
import { ManeuverType } from '../bundle/trb';
import { drawManeuver } from '../pod/icons';
import { formatDist } from '../pod/render';
import { buildBundle } from './buildBundle';
import { mapStep, shortName, turnModifier } from './maneuvers';
import { PROVIDERS, type RouteResult } from './routing';
import { SnapshotPool } from './snapshots';

/** Hidden maps rendering in parallel. Each is a WebGL context; browsers cap those at ~16. */
const SNAPSHOT_WORKERS = 4;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface PlanCallbacks {
  onBundle(bytes: Uint8Array, filename: string): void;
}

export class PlanView {
  private map: MlMap;
  private waypoints: LatLon[] = [];
  private markers: Marker[] = [];
  private route: RouteResult | null = null;
  private bytes: Uint8Array | null = null;
  private filename = 'route.trb';
  private renderer: SnapshotPool | null = null;
  private abort: AbortController | null = null;
  /** While a bundle builds, the route is locked: no waypoint edits, no re-routing. */
  private building = false;

  constructor(private readonly cb: PlanCallbacks) {
    this.map = new MlMap({
      container: 'plan-map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [106.8272, -6.1754],
      zoom: 12,
      attributionControl: { compact: true },
    });
    this.map.on('load', () => {
      this.map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this.map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 8 } });
      this.map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffb000', 'line-width': 5 } });
    });
    this.map.on('click', (e) => this.addWaypoint({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    this.map.once('load', () => this.fromUrl());

    const sel = $<HTMLSelectElement>('sel-provider');
    PROVIDERS.forEach((p) => sel.add(new Option(p.label, p.id)));
    $('btn-route').addEventListener('click', () => void this.doRoute());
    $('btn-clear').addEventListener('click', () => this.clear());
    $('btn-locate').addEventListener('click', () => this.locate());
    $('btn-build').addEventListener('click', () => void this.doBuild());
    $('btn-download').addEventListener('click', () => this.download());
    $('btn-preview').addEventListener('click', () => this.bytes && this.cb.onBundle(this.bytes, this.filename));
  }

  resize(): void {
    this.map.resize();
  }

  /** Prefill waypoints from `?from=lat,lon&via=lat,lon&to=lat,lon` (via may repeat) — shareable routes. */
  private fromUrl(): void {
    const q = new URLSearchParams(location.search);
    const parse = (v: string | null): LatLon | null => {
      const m = v?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (!m) return null;
      const p = { lat: Number(m[1]), lon: Number(m[2]) };
      return Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? p : null;
    };
    const from = parse(q.get('from'));
    const to = parse(q.get('to'));
    if (!from || !to) return;
    const via = q.getAll('via').map(parse).filter((p): p is LatLon => p !== null).slice(0, 8);
    this.waypoints = [from, ...via, to];
    this.redrawMarkers();
    this.invalidate();
    const b = new LngLatBounds();
    this.waypoints.forEach((p) => b.extend([p.lon, p.lat]));
    this.map.fitBounds(b, { padding: 60, duration: 0 });
  }

  private addWaypoint(p: LatLon, asStart = false): void {
    if (this.building || this.waypoints.length >= 10) return;
    if (asStart) this.waypoints.unshift(p);
    else if (this.waypoints.length >= 2) this.waypoints.splice(this.waypoints.length - 1, 0, p); // new stop before destination
    else this.waypoints.push(p);
    this.redrawMarkers();
    this.invalidate();
  }

  private redrawMarkers(): void {
    this.markers.forEach((m) => m.remove());
    this.markers = this.waypoints.map((p, i) => {
      const el = document.createElement('div');
      const last = i === this.waypoints.length - 1 && i > 0;
      el.className = 'marker' + (last ? ' end' : '');
      el.textContent = i === 0 ? 'A' : last ? 'B' : String(i);
      const mk = new Marker({ element: el, draggable: !this.building }).setLngLat([p.lon, p.lat]).addTo(this.map);
      mk.on('dragend', () => {
        const ll = mk.getLngLat();
        this.waypoints[i] = { lat: ll.lat, lon: ll.lng };
        this.invalidate();
      });
      el.addEventListener('click', (ev) => ev.stopPropagation());
      return mk;
    });
    $<HTMLButtonElement>('btn-route').disabled = this.waypoints.length < 2;
    $('plan-hint').innerHTML =
      this.waypoints.length === 0
        ? 'Tap the map to set the <b>start</b>.'
        : this.waypoints.length === 1
          ? 'Now tap the <b>destination</b>.'
          : 'Tap to add stops before the destination, drag markers to adjust, then <b>Get route</b>.';
  }

  private invalidate(): void {
    this.abort?.abort(); // a route request for the old waypoints must not land later
    this.abort = null;
    this.route = null;
    this.bytes = null;
    $('maneuver-group').hidden = true;
    $('build-group').hidden = true;
    $('route-summary').textContent = '';
    $('warnings').innerHTML = '';
    this.setRouteLine([]);
  }

  private clear(): void {
    if (this.building) return;
    this.waypoints = [];
    this.redrawMarkers();
    this.invalidate();
  }

  private locate(): void {
    if (!navigator.geolocation) return this.error('Geolocation is not available in this browser.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        this.addWaypoint(p, true);
        this.map.flyTo({ center: [p.lon, p.lat], zoom: 14 });
      },
      (err) => this.error(`Location unavailable: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  private error(msg: string): void {
    $('route-summary').innerHTML = `<span class="err"></span>`;
    ($('route-summary').firstChild as HTMLElement).textContent = msg;
  }

  private setRouteLine(geom: LatLon[]): void {
    const src = this.map.getSource('route') as GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: geom.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geom.map((p) => [p.lon, p.lat]) } }] : [],
    });
  }

  private async doRoute(): Promise<void> {
    const provider = PROVIDERS.find((p) => p.id === $<HTMLSelectElement>('sel-provider').value)!;
    if (this.building) return;
    this.abort?.abort();
    const ctl = new AbortController();
    this.abort = ctl;
    const btn = $<HTMLButtonElement>('btn-route');
    btn.disabled = true;
    btn.textContent = 'Routing…';
    try {
      const r = await provider.route([...this.waypoints], ctl.signal);
      if (this.abort !== ctl) return; // waypoints changed meanwhile
      this.route = r;
      this.setRouteLine(r.geometry);
      const b = new LngLatBounds();
      r.geometry.forEach((p) => b.extend([p.lon, p.lat]));
      this.map.fitBounds(b, { padding: 50, duration: 600 });
      $('route-summary').textContent = `${(r.distance / 1000).toFixed(1)} km · ${Math.round(r.duration / 60)} min · ${r.geometry.length} points`;
      $('warnings').innerHTML = '';
      for (const w of r.warnings) {
        const li = document.createElement('li');
        li.textContent = w;
        $('warnings').appendChild(li);
      }
      this.listManeuvers(r);
      $('build-group').hidden = false;
      $('build-actions').hidden = true;
      $('build-result').textContent = '';
      this.clearThumbs();
      const name = $<HTMLInputElement>('inp-name');
      const named = r.steps.filter((s) => s.name);
      name.value = named.length ? `${shortName(named[0].name)} → ${shortName(named[named.length - 1].name)}` : 'My route';
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && this.abort === ctl) this.error((e as Error).message);
    } finally {
      if (this.abort === ctl || this.abort === null) {
        btn.disabled = this.waypoints.length < 2;
        btn.textContent = 'Get route';
      }
    }
  }

  private listManeuvers(r: RouteResult): void {
    const C = cumulative(r.geometry);
    const ol = $('maneuver-list');
    ol.innerHTML = '';
    let n = 0;
    for (const s of r.steps) {
      const m = mapStep(s);
      if (!m) continue;
      n++;
      const li = document.createElement('li');
      const cv = document.createElement('canvas');
      cv.width = cv.height = 60;
      const ctx = cv.getContext('2d')!;
      const mod = m.type === ManeuverType.DEPART ? 0 : turnModifier(s.bearingBefore, s.bearingAfter);
      drawManeuver(ctx, m.type, mod, m.exit, 30, 30, 44, { fg: '#fff', ghost: '#555', bg: '#000' });
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = shortName(s.name || s.ref || '') || ManeuverType[m.type].toLowerCase().replace('_', ' ');
      const dist = document.createElement('span');
      dist.className = 'dist';
      const d = formatDist(C[s.geomIndex]);
      dist.textContent = `${d.value} ${d.unit}`;
      li.append(cv, name, dist);
      const p = r.geometry[s.geomIndex];
      li.addEventListener('click', () => this.map.flyTo({ center: [p.lon, p.lat], zoom: 17 }));
      ol.appendChild(li);
    }
    $('maneuver-count').textContent = `(${n})`;
    $('maneuver-group').hidden = false;
  }

  private setBuilding(on: boolean): void {
    this.building = on;
    for (const id of ['btn-route', 'btn-clear', 'btn-locate', 'sel-provider']) {
      ($(id) as HTMLButtonElement).disabled = on || (id === 'btn-route' && this.waypoints.length < 2);
    }
    this.markers.forEach((m) => m.setDraggable(!on));
  }

  private async doBuild(): Promise<void> {
    const route = this.route;
    if (!route || this.building) return;
    // A route request still in flight would replace this.route mid-build.
    this.abort?.abort();
    this.abort = null;
    this.setBuilding(true);
    const btn = $<HTMLButtonElement>('btn-build');
    const prog = $<HTMLProgressElement>('build-progress');
    btn.disabled = true;
    prog.hidden = false;
    prog.value = 0;
    this.clearThumbs();
    $('build-actions').hidden = true;
    const t0 = performance.now();
    try {
      this.renderer ??= new SnapshotPool(SNAPSHOT_WORKERS);
      await this.renderer.setRoute(route.geometry);
      const thumbs = $('thumbs');
      const render = this.renderer.render;
      const name = $<HTMLInputElement>('inp-name').value.trim() || 'My route';
      const { bundle, bytes } = await buildBundle(route, {
        name,
        concurrency: SNAPSHOT_WORKERS,
        renderer: async (job) => {
          const jpeg = await render(job);
          const img = document.createElement('img');
          img.src = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
          img.title = `#${job.index} z${job.zoom} ${Math.round(job.bearing)}°`;
          thumbs.appendChild(img);
          return jpeg;
        },
        onProgress: (done, total) => {
          prog.max = total;
          prog.value = done;
          $('build-result').textContent = `Rendering snapshot ${done}/${total}…`;
        },
      });
      if (this.route !== route) return; // route was replaced; this bundle is stale
      this.bytes = bytes;
      this.filename = `${bundle.manifest.id}.trb`;
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      $('build-result').textContent =
        `${(bytes.length / 1024).toFixed(0)} KB · ${bundle.points.length} points · ${bundle.maneuvers.length} maneuvers · ${bundle.images.length} snapshots · built in ${secs} s`;
      $('build-actions').hidden = false;
    } catch (e) {
      // A failed map (offline, style never loaded) shouldn't poison later builds.
      this.renderer?.destroy();
      this.renderer = null;
      $('build-result').innerHTML = '<span class="err"></span>';
      ($('build-result').firstChild as HTMLElement).textContent = `Build failed: ${(e as Error).message}`;
    } finally {
      btn.disabled = false;
      prog.hidden = true;
      this.setBuilding(false);
    }
  }

  private clearThumbs(): void {
    $('thumbs').querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
    $('thumbs').innerHTML = '';
  }

  private download(): void {
    if (!this.bytes) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.bytes as BlobPart], { type: 'application/octet-stream' }));
    a.download = this.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
