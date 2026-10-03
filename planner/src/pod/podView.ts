// Pod tab: emulated 240×240 display driven by navcore + a simulated rider.

import { LngLatBounds, Map as MlMap, type GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { jpegSize, ManeuverType, readTrb, TrbError, type Bundle } from '../bundle/trb';
import type { LatLon } from '../geo/geo';
import type { Fix } from '../navcore/matcher';
import { Navigator, type NavEvent, type NavState } from '../navcore/navigator';
import { buildRoute, type Route } from '../navcore/route';
import { Phase } from '../navcore/triggers';
import { drawPod, type PodModel, type View } from './render';
import { saveLast } from './lastBundle';
import { Rider, type RiderOptions } from './rider';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const EPOCH_S = 0.2; // 5 Hz GNSS (hardware.md)
const BOOT_MS = 1800;
const LONG_PRESS_MS = 700;
const BRIGHTNESS = [1, 0.75, 0.5, 0.3];
const FIRMWARE = '0.1-preview';
const VIEWS: View[] = ['auto', 'cruise', 'preview'];
/** Generous cap: a 600 km tour is ~4.5 MB, and the pod's LittleFS holds ~9.9 MB. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_TIMELINE_LINES = 2000;

function hms(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`;
}

const fc = (features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (p: LatLon, kind: string) => ({ type: 'Feature' as const, properties: { kind }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } });

export class PodView {
  private ctx: CanvasRenderingContext2D;
  private model: PodModel;
  private route: Route | null = null;
  private nav: Navigator | null = null;
  private rider: Rider | null = null;
  private playing = false;
  private acc = 0;
  private lastFrame = 0;
  private bootUntil = 0;
  private brightness = 0;
  private lastFix: Fix | null = null;
  private loggedEvents = 0;
  private map: MlMap | null = null;
  private mapReady = false;
  private lastMapUpdate = 0;
  private follow = true;
  /** Bumped on every load so a slow, older load can't replace a newer one. */
  private loadGen = 0;
  private timelineLines = 0;

  constructor() {
    const canvas = $<HTMLCanvasElement>('pod');
    this.ctx = canvas.getContext('2d')!;
    this.model = {
      screen: 'boot',
      view: 'auto',
      theme: 'night',
      bundle: null,
      route: null,
      images: [],
      nav: null,
      clock: new Date(),
      tripTime: 0,
      flash: false,
      satellites: 0,
      firmware: FIRMWARE,
    };
    this.bootUntil = performance.now() + BOOT_MS;
    this.wireControls();
    this.info('<b></b>', 'No route loaded. Try the demo route, load a .trb, or plan one in the Plan tab.');
    requestAnimationFrame(this.frame);
  }

  /** Called when the tab becomes visible (maps can't size themselves while hidden). */
  shown(): void {
    if (!this.map) this.initMap();
    else this.map.resize();
  }

  /** Bundled sample ride (central Jakarta), so the pod can be tried without planning a route. */
  async loadDemo(): Promise<void> {
    try {
      const res = await fetch(new URL('demo.trb', document.baseURI));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Not remembered: the demo must never replace the user's own last route.
      await this.loadBundle(new Uint8Array(await res.arrayBuffer()), 'demo.trb', false);
    } catch (e) {
      this.info(`<span class="err"></span>`, `Couldn't load the demo route: ${(e as Error).message}`);
    }
  }

  /** Loads requested so far (valid or not) — lets the startup restore skip itself if the user already chose. */
  loadsStarted = 0;

  async loadBundle(bytes: Uint8Array, filename: string, remember = true): Promise<void> {
    this.loadsStarted++;
    if (bytes.length > MAX_BUNDLE_BYTES) {
      this.info(`<span class="err"></span>`, `File too large (${(bytes.length / 1048576).toFixed(1)} MB). Previous route kept.`);
      return;
    }
    let b: Bundle;
    try {
      b = readTrb(bytes);
    } catch (e) {
      const msg = e instanceof TrbError ? `Rejected by validation (${e.message}). Previous route kept.` : String(e);
      this.info(`<span class="err"></span>`, msg);
      return;
    }
    // Only a valid bundle supersedes an earlier load still decoding.
    const gen = ++this.loadGen;
    const images = await Promise.all(
      b.images.map((img) => {
        const sz = jpegSize(img.jpeg);
        if (!sz || sz.w !== 240 || sz.h !== 240) return null; // never decode oversized images
        return createImageBitmap(new Blob([img.jpeg as BlobPart], { type: 'image/jpeg' })).catch(() => null);
      }),
    );
    if (gen !== this.loadGen) {
      images.forEach((i) => i?.close()); // a newer load started meanwhile
      return;
    }
    this.model.images.forEach((i) => i?.close());
    this.route = buildRoute(b);
    this.model.bundle = b;
    this.model.route = this.route;
    this.model.images = images;
    const bad = images.filter((i) => !i).length;
    this.info(
      `<b></b><br>${(bytes.length / 1024).toFixed(0)} KB · ${(this.route.total / 1000).toFixed(1)} km · ${b.points.length} points · ${b.maneuvers.length} maneuvers · ${b.images.length} snapshots${bad ? ` · <span class="err">${bad} undecodable</span>` : ''}`,
      `${b.manifest.name} (${filename})`,
    );
    this.restart();
    this.updateMapRoute();
    if (remember) void saveLast(bytes, filename);
  }

  // ------------------------------------------------------------------ simulation

  private restart(): void {
    if (!this.route) return;
    this.rider = new Rider(this.route);
    this.nav = new Navigator(this.route);
    this.loggedEvents = 0;
    this.lastFix = null;
    $('timeline').textContent = '';
    this.timelineLines = 0;
    this.model.nav = null;
    this.model.view = 'auto';
    this.model.screen = 'boot';
    this.bootUntil = performance.now() + BOOT_MS;
    this.setPlaying(false);
    for (const id of ['btn-play', 'btn-restart', 'btn-detour', 'btn-tunnel', 'btn-brownout']) $<HTMLButtonElement>(id).disabled = false;
    this.syncToggles();
  }

  private brownout(): void {
    if (!this.route || !this.nav) return;
    const saved = this.nav.persisted ?? undefined;
    const before = this.nav.events;
    this.nav = new Navigator(this.route, saved);
    this.nav.events = before;
    this.model.screen = 'boot';
    this.bootUntil = performance.now() + BOOT_MS;
    this.log(`${hms(this.rider?.t ?? 0)}  RESET  resume from persisted seg=${saved?.seg ?? '—'}`);
  }

  private options(): RiderOptions {
    return {
      speedKmh: Number($<HTMLInputElement>('rng-speed').value),
      noiseM: Number($<HTMLInputElement>('rng-noise').value),
      slowForTurns: $<HTMLInputElement>('chk-slow').checked,
    };
  }

  private epoch(): void {
    if (!this.rider || !this.nav) return;
    const o = this.options();
    this.rider.step(this.playing ? EPOCH_S : 0, o);
    const fix = this.rider.gnss(o);
    if (fix) this.lastFix = fix;
    if (this.model.screen === 'boot') return;
    const s = this.nav.update(fix, this.rider.t);
    this.model.nav = s;
    this.model.satellites = fix ? Math.max(4, Math.round(22 - o.noiseM)) : 0;
    if (this.model.screen === 'nav' && !s.arrived) this.model.tripTime = this.rider.t;
    this.flushEvents();
    if (this.rider.finished && s.arrived && this.playing) this.setPlaying(false);
  }

  private frame = (now: number): void => {
    const dt = this.lastFrame ? Math.min(0.25, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (this.model.screen === 'boot' && now >= this.bootUntil) {
      this.model.screen = this.route ? 'nav' : 'noroute';
      if (!this.playing) this.epoch(); // first fix after boot, so a paused pod shows the route
    }
    if (this.playing && this.rider) {
      this.acc += dt * Number($<HTMLSelectElement>('sel-mult').value);
      let n = 0;
      while (this.acc >= EPOCH_S && n++ < 400) {
        this.acc -= EPOCH_S;
        this.epoch();
      }
    }
    this.model.clock = new Date();
    this.model.flash = Math.floor(now / 250) % 2 === 0;
    drawPod(this.ctx, this.model);
    this.renderDebug(this.model.nav);
    if (now - this.lastMapUpdate > 200) {
      this.lastMapUpdate = now;
      this.updateMapLive();
    }
    requestAnimationFrame(this.frame);
  };

  private setPlaying(p: boolean): void {
    this.playing = p;
    $('btn-play').textContent = p ? '❚❚ Pause' : '▶ Ride';
  }

  // ------------------------------------------------------------------ hardware buttons

  private wireButton(id: string, short: () => void, long: () => void): void {
    const el = $(id);
    let timer: number | null = null;
    let fired = false;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.classList.add('pressed');
      fired = false;
      timer = window.setTimeout(() => {
        fired = true;
        long();
      }, LONG_PRESS_MS);
    };
    const up = () => {
      el.classList.remove('pressed');
      if (timer !== null) clearTimeout(timer);
      if (timer !== null && !fired) short();
      timer = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    const cancel = () => {
      el.classList.remove('pressed');
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private wireControls(): void {
    // A: short cycles Arrow ↔ Cruise ↔ Snapshot preview; long enters upload mode when stopped.
    this.wireButton(
      'btn-a',
      () => {
        if (this.model.screen === 'upload') this.model.screen = this.route ? 'nav' : 'noroute';
        else this.model.view = VIEWS[(VIEWS.indexOf(this.model.view) + 1) % VIEWS.length];
      },
      () => {
        const stopped = !this.model.nav || this.model.nav.speed < 1;
        if (stopped) this.model.screen = 'upload';
      },
    );
    // B: short = brightness step (PWM on BLK), long = day/night theme.
    this.wireButton(
      'btn-b',
      () => {
        this.brightness = (this.brightness + 1) % BRIGHTNESS.length;
        $('pod').style.filter = `brightness(${BRIGHTNESS[this.brightness]})`;
      },
      () => (this.model.theme = this.model.theme === 'night' ? 'day' : 'night'),
    );

    $('btn-play').addEventListener('click', () => {
      if (this.rider?.finished) this.restart();
      this.setPlaying(!this.playing);
    });
    $('btn-restart').addEventListener('click', () => this.restart());
    $('btn-detour').addEventListener('click', () => {
      if (!this.rider) return;
      if (this.rider.mode === 'route') this.rider.startDetour();
      else this.rider.endDetour();
      this.syncToggles();
    });
    $('btn-tunnel').addEventListener('click', () => {
      if (!this.rider) return;
      this.rider.tunnel = !this.rider.tunnel;
      this.syncToggles();
    });
    $('btn-brownout').addEventListener('click', () => this.brownout());
    $('btn-shot').addEventListener('click', () => this.screenshot());
    $('btn-demo').addEventListener('click', () => void this.loadDemo());

    const speed = $<HTMLInputElement>('rng-speed');
    const noise = $<HTMLInputElement>('rng-noise');
    const syncOut = () => {
      $('out-speed').textContent = `${speed.value} km/h`;
      $('out-noise').textContent = `${noise.value} m`;
    };
    speed.addEventListener('input', syncOut);
    noise.addEventListener('input', syncOut);
    syncOut();

    $<HTMLInputElement>('inp-file').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      await this.loadBundle(new Uint8Array(await f.arrayBuffer()), f.name);
      (e.target as HTMLInputElement).value = '';
    });
  }

  private syncToggles(): void {
    const r = this.rider;
    const detour = $('btn-detour');
    detour.textContent = !r || r.mode === 'route' ? 'Take a wrong turn' : r.mode === 'detour' ? 'Head back to route' : 'Returning…';
    detour.classList.toggle('active', !!r && r.mode !== 'route');
    const tunnel = $('btn-tunnel');
    tunnel.textContent = r?.tunnel ? 'Exit tunnel' : 'Enter tunnel';
    tunnel.classList.toggle('active', !!r?.tunnel);
  }

  private screenshot(): void {
    const n = this.model.nav;
    const tag = this.model.screen !== 'nav' ? this.model.screen : !n ? 'idle' : n.arrived ? 'arrived' : n.offRoute ? 'offroute' : n.phase.toLowerCase();
    $<HTMLCanvasElement>('pod').toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `screen-${tag}-${this.model.theme}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  // ------------------------------------------------------------------ panels

  private info(html: string, text: string): void {
    const el = $('bundle-info');
    el.innerHTML = html;
    const slot = el.querySelector('b, .err');
    if (slot) slot.textContent = text;
  }

  private flushEvents(): void {
    const evs = this.nav!.events;
    for (; this.loggedEvents < evs.length; this.loggedEvents++) this.log(this.formatEvent(evs[this.loggedEvents]));
  }

  private formatEvent(e: NavEvent): string {
    const t = hms(e.time);
    switch (e.kind) {
      case 'phase': {
        const m = this.route!.maneuvers[e.maneuver];
        const head = e.from === Phase.FAR ? `${ManeuverType[m.type]} "${m.name}"` : '';
        const tt = Number.isFinite(e.t) ? `${e.t.toFixed(1)}s` : '—';
        return `${t}  M#${e.maneuver} ${head.padEnd(28)} ${`${e.from}→${e.to}`.padEnd(16)} d=${Math.round(e.d)}m t=${tt} v=${Math.round(e.speed * 3.6)}km/h`;
      }
      case 'offroute':
        return `${t}  OFF-ROUTE confirmed  perp=${Math.round(e.perpDist)}m`;
      case 'rejoined':
        return `${t}  REJOINED  along=${Math.round(e.along)}m`;
      case 'gps':
        return `${t}  GPS ${e.status.toUpperCase()}`;
    }
  }

  private log(line: string): void {
    const pre = $('timeline');
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
    if (++this.timelineLines > MAX_TIMELINE_LINES) {
      const t = pre.textContent ?? '';
      pre.textContent = t.slice(t.indexOf('\n', t.length / 2) + 1); // drop the oldest half
      this.timelineLines = pre.textContent.split('\n').length;
    }
    pre.textContent += (pre.textContent ? '\n' : '') + line;
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }

  private renderDebug(n: NavState | null): void {
    const dl = $('debug');
    if (!n || !this.route) {
      dl.textContent = '';
      return;
    }
    const m = this.route.maneuvers[n.next];
    const rows: [string, string][] = [
      ['screen', `${this.model.screen} / view ${this.model.view} / ${this.model.theme}`],
      ['phase', n.arrived ? 'ARRIVED' : n.phase],
      ['maneuver', m ? `#${n.next}/${this.route.maneuvers.length - 1} ${ManeuverType[m.type]} ${m.name}` : '—'],
      ['d / t', `${Math.round(n.d)} m / ${Number.isFinite(n.t) ? n.t.toFixed(1) : '—'} s`],
      ['speed', `${(n.speed * 3.6).toFixed(0)} km/h · heading ${Math.round(n.heading)}°`],
      ['perpDist', `${n.perpDist.toFixed(1)} m${n.offCandidate ? ' (candidate)' : ''}`],
      ['along', `${Math.round(n.along)} / ${Math.round(this.route.total)} m`],
      ['gps', n.gps + (this.rider?.tunnel ? ' (tunnel)' : '')],
      ['off-route', n.offRoute ? `YES → ${n.rejoin ? `${Math.round(n.rejoin.dist)} m @ ${Math.round(n.rejoin.bearing)}°` : ''}` : 'no'],
      ['persisted', this.nav?.persisted ? `seg ${this.nav.persisted.seg}` : '—'],
      ['sim time', hms(this.rider?.t ?? 0)],
    ];
    const html = rows.map(([k]) => `<dt>${k}</dt><dd></dd>`).join('');
    if (dl.childElementCount !== rows.length * 2) dl.innerHTML = html;
    rows.forEach(([, v], i) => {
      const dd = dl.children[i * 2 + 1];
      if (dd.textContent !== v) dd.textContent = v;
    });
  }

  // ------------------------------------------------------------------ mini map

  private initMap(): void {
    this.map = new MlMap({
      container: 'pod-map',
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [106.8272, -6.1754],
      zoom: 14,
      attributionControl: { compact: true },
    });
    this.map.on('dragstart', () => (this.follow = false));
    this.map.on('dblclick', () => (this.follow = true));
    this.map.on('load', () => {
      const m = this.map!;
      m.addSource('route', { type: 'geojson', data: fc([]) });
      m.addSource('live', { type: 'geojson', data: fc([]) });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#ffb000', 'line-width': 5 } });
      m.addLayer({
        id: 'live',
        type: 'circle',
        source: 'live',
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'snapped', 7, 'true', 5, 'man', 4, 4],
          'circle-color': ['match', ['get', 'kind'], 'snapped', '#19d3ff', 'true', '#222', 'fix', '#e33', 'man', '#ffb000', '#999'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': ['match', ['get', 'kind'], 'man', 1, 2],
        },
      });
      this.mapReady = true;
      this.updateMapRoute();
    });
  }

  private updateMapRoute(): void {
    if (!this.map || !this.mapReady || !this.route) return;
    const r = this.route;
    (this.map.getSource('route') as GeoJSONSource).setData(
      fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.points.map((p) => [p.lon, p.lat]) } }]),
    );
    const b = new LngLatBounds();
    r.points.forEach((p) => b.extend([p.lon, p.lat]));
    this.map.fitBounds(b, { padding: 30, duration: 0 });
    this.follow = true;
  }

  private updateMapLive(): void {
    if (!this.map || !this.mapReady || !this.route || !this.rider) return;
    const feats = this.route.maneuvers.map((m) => pt(this.route!.points[m.pointIndex], 'man'));
    feats.push(pt(this.rider.pos, 'true'));
    if (this.lastFix && !this.rider.tunnel) feats.push(pt(this.lastFix, 'fix'));
    if (this.model.nav) feats.push(pt(this.model.nav.pos, 'snapped'));
    (this.map.getSource('live') as GeoJSONSource).setData(fc(feats));
    if (this.follow && this.playing) this.map.jumpTo({ center: [this.rider.pos.lon, this.rider.pos.lat], zoom: Math.max(this.map.getZoom(), 15) });
  }
}
