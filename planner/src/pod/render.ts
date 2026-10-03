// Pod screens on a 240×240 canvas (docs/design/screens.md). Mirrors what the firmware
// will draw with LovyanGFX sprites; fonts here are system fonts, the device will use VLW.

import { ManeuverType, type Bundle } from '../bundle/trb';
import { toScreen } from '../geo/mercator';
import { NAV } from '../navcore/config';
import type { NavState } from '../navcore/navigator';
import type { Route } from '../navcore/route';
import { Phase } from '../navcore/triggers';
import { drawBearingArrow, drawManeuver, type IconColors } from './icons';

export const PX = 240;
const C = PX / 2;
/** Above this distance to the next maneuver (FAR), the auto view switches to Cruise. */
export const CRUISE_D_M = 3000;

export type Theme = 'night' | 'day';
export type View = 'auto' | 'cruise' | 'preview';
export type Screen = 'boot' | 'noroute' | 'upload' | 'nav';

interface Palette {
  bg: string;
  fg: string;
  dim: string;
  track: string;
  accent: string;
  warn: string;
  dot: string;
}
const PALETTES: Record<Theme, Palette> = {
  night: { bg: '#000', fg: '#fff', dim: '#8b93a1', track: '#24282f', accent: '#ffb000', warn: '#ff4d4d', dot: '#19d3ff' },
  day: { bg: '#fff', fg: '#000', dim: '#4a4f57', track: '#d9dce1', accent: '#b86e00', warn: '#d10000', dot: '#006eff' },
};

export interface PodModel {
  screen: Screen;
  view: View;
  theme: Theme;
  bundle: Bundle | null;
  route: Route | null;
  images: (ImageBitmap | null)[];
  nav: NavState | null;
  /** Wall-clock-ish time for the clock face. */
  clock: Date;
  /** Seconds since the ride started (Arrived screen). */
  tripTime: number;
  /** Toggles at ~2 Hz for the NOW-phase ring flash. */
  flash: boolean;
  satellites: number;
  firmware: string;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Distance label: 10 m steps under 100 m, 50 m steps under 1 km, 0.1 km above (whole km past 10). */
export function formatDist(d: number): { value: string; unit: string } {
  const m = Math.max(0, d);
  if (m >= 10000) return { value: (m / 1000).toFixed(0), unit: 'km' };
  if (m >= 950) return { value: (m / 1000).toFixed(1), unit: 'km' };
  if (m >= 100) return { value: String(Math.round(m / 50) * 50), unit: 'm' };
  return { value: String(Math.round(m / 10) * 10), unit: 'm' };
}

/** Width of the round face at height y, minus a margin. */
function chord(y: number, margin = 14): number {
  const dy = Math.abs(y - C);
  return Math.max(0, 2 * Math.sqrt(Math.max(0, C * C - dy * dy)) - 2 * margin);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, weight = 700): void {
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

function distanceLabel(ctx: CanvasRenderingContext2D, d: number, y: number, color: string, unitColor: string, big = 44): void {
  const { value, unit } = formatDist(d);
  ctx.font = `800 ${big}px ${FONT}`;
  const vw = ctx.measureText(value).width;
  ctx.font = `700 ${Math.round(big * 0.5)}px ${FONT}`;
  const uw = ctx.measureText(' ' + unit).width;
  const x0 = C - (vw + uw) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 ${big}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x0, y);
  ctx.font = `700 ${Math.round(big * 0.5)}px ${FONT}`;
  ctx.fillStyle = unitColor;
  ctx.fillText(' ' + unit, x0 + vw, y);
}

function ring(ctx: CanvasRenderingContext2D, r: number, w: number, color: string, from = 0, to = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(C, C, r, -Math.PI / 2 + from * 2 * Math.PI, -Math.PI / 2 + to * 2 * Math.PI);
  ctx.stroke();
}

function gpsBadge(ctx: CanvasRenderingContext2D, n: NavState, p: Palette, y = 30): void {
  if (n.gps === 'ok') return;
  const color = n.gps === 'dr' ? p.accent : p.warn;
  ctx.font = `800 15px ${FONT}`;
  const w = ctx.measureText('GPS').width + 14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(C - w / 2, y - 14, w, 20, 6);
  ctx.fill();
  text(ctx, 'GPS', C, y + 1, 15, p.bg, 800);
}

function clockText(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function icons(p: Palette): IconColors {
  return { fg: p.fg, ghost: p.track, bg: p.bg };
}

// ---------------------------------------------------------------------------- screens

function bootScreen(ctx: CanvasRenderingContext2D, m: PodModel, p: Palette): void {
  text(ctx, 'TRIPPER', C, 112, 34, p.accent, 900);
  text(ctx, `fw ${m.firmware}`, C, 142, 16, p.dim, 600);
  text(ctx, 'GNSS…', C, 180, 18, p.fg, 600);
}

function noRouteScreen(ctx: CanvasRenderingContext2D, m: PodModel, p: Palette): void {
  text(ctx, clockText(m.clock), C, 100, 52, p.fg, 800);
  const kmh = m.nav ? Math.round(m.nav.speed * 3.6) : 0;
  text(ctx, `${kmh} km/h · ${m.satellites} sats`, C, 136, 18, p.dim, 600);
  text(ctx, 'No route', C, 172, 20, p.accent, 800);
  text(ctx, 'Hold A for upload mode', C, 198, 15, p.dim, 600);
}

function uploadScreen(ctx: CanvasRenderingContext2D, _m: PodModel, p: Palette): void {
  text(ctx, 'Upload mode', C, 52, 20, p.accent, 800);
  // QR placeholder (firmware draws a WIFI: QR code here with ricmoo/QRCode).
  ctx.fillStyle = p.fg;
  ctx.fillRect(C - 45, 66, 90, 90);
  ctx.fillStyle = p.bg;
  ctx.fillRect(C - 39, 72, 78, 78);
  text(ctx, 'QR', C, 120, 22, p.fg, 800);
  text(ctx, 'TRIPPER-1A2B', C, 180, 17, p.fg, 700);
  text(ctx, 'pass: ride-safe-42', C, 200, 14, p.dim, 600);
  text(ctx, '192.168.4.1', C, 218, 14, p.dim, 600);
}

function prevAlong(r: Route, next: number): number {
  return next > 0 ? r.manAlong[next - 1] : 0;
}

function arrowScreen(ctx: CanvasRenderingContext2D, m: PodModel, n: NavState, p: Palette): void {
  const r = m.route!;
  const man = r.maneuvers[n.next];
  const span = Math.max(1, r.manAlong[n.next] - prevAlong(r, n.next));
  const frac = Math.max(0, Math.min(1, 1 - n.d / span));
  const prepare = n.phase === Phase.PREPARE;
  ring(ctx, 113, 8, p.track);
  ring(ctx, 113, 8, prepare ? p.accent : p.dim, 0, frac);
  if (prepare) ring(ctx, 118.5, 3, p.accent);
  drawManeuver(ctx, man.type, man.modifier, man.exitNumber, C, 86, 104, icons(p));
  distanceLabel(ctx, n.d, 178, p.fg, p.dim);
  ctx.font = `700 19px ${FONT}`;
  text(ctx, fitText(ctx, man.name || ' ', chord(204)), C, 206, 19, prepare ? p.accent : p.fg, 700);
  gpsBadge(ctx, n, p);
}

function cruiseScreen(ctx: CanvasRenderingContext2D, m: PodModel, n: NavState, p: Palette): void {
  const r = m.route!;
  const man = r.maneuvers[n.next];
  text(ctx, clockText(m.clock), C, 52, 20, p.dim, 700);
  text(ctx, String(Math.round(n.speed * 3.6)), C, 136, 76, p.fg, 800);
  text(ctx, 'km/h', C, 160, 16, p.dim, 700);
  if (man) {
    drawManeuver(ctx, man.type, man.modifier, man.exitNumber, C - 38, 196, 34, icons(p));
    const { value, unit } = formatDist(n.d);
    ctx.font = `800 22px ${FONT}`;
    ctx.fillStyle = p.fg;
    ctx.textAlign = 'left';
    ctx.fillText(`${value} ${unit}`, C - 12, 204);
  }
  gpsBadge(ctx, n, p, 76);
}

function junctionScreen(ctx: CanvasRenderingContext2D, m: PodModel, n: NavState, p: Palette, idx: number): boolean {
  const r = m.route!;
  const man = r.maneuvers[idx];
  const bmp = man && man.imageIndex !== 255 ? m.images[man.imageIndex] : null;
  const cam = man && man.imageIndex !== 255 ? m.bundle!.images[man.imageIndex] : null;
  if (!bmp || !cam) return false;
  const center = r.points[man.pointIndex];
  ctx.drawImage(bmp, 0, 0, PX, PX);

  // Live position — snapped, not raw (algorithms.md §4 tip).
  const s = toScreen(n.pos.lat, n.pos.lon, { lat: center.lat, lon: center.lon, zoom: cam.zoom, bearing: cam.bearing });
  let x = s.x - C;
  let y = s.y - C;
  const R = 104;
  const len = Math.hypot(x, y);
  const clamped = len > R;
  if (clamped) {
    x = (x / len) * R;
    y = (y / len) * R;
  }
  ctx.save();
  ctx.translate(C + x, C + y);
  if (n.speed > NAV.HEADING_MIN_SPEED_MS && !clamped) {
    ctx.rotate(((n.heading - cam.bearing) * Math.PI) / 180);
    ctx.fillStyle = p.dot;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  } else {
    ctx.fillStyle = p.dot;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, clamped ? 7 : 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();

  // Distance pill.
  const { value, unit } = formatDist(n.d);
  ctx.font = `800 28px ${FONT}`;
  const w = ctx.measureText(`${value} ${unit}`).width + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.beginPath();
  ctx.roundRect(C - w / 2, 186, w, 38, 19);
  ctx.fill();
  text(ctx, `${value} ${unit}`, C, 215, 28, '#fff', 800);

  // "then ↰" chip.
  if (n.thenType !== null && idx === n.next && (n.phase === Phase.NEAR || n.phase === Phase.NOW)) {
    const nm = r.maneuvers[n.next + 1];
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.beginPath();
    ctx.roundRect(C - 46, 16, 92, 34, 17);
    ctx.fill();
    text(ctx, 'then', C - 14, 39, 16, '#fff', 700);
    drawManeuver(ctx, nm.type, nm.modifier, nm.exitNumber, C + 24, 33, 24, { fg: '#ffb000', ghost: '#444', bg: '#000' });
  }

  if (n.phase === Phase.NOW && m.flash) ring(ctx, 114, 12, p.accent);
  gpsBadge(ctx, n, p, 70);
  return true;
}

function offRouteScreen(ctx: CanvasRenderingContext2D, n: NavState, p: Palette): void {
  ring(ctx, 115, 6, p.warn);
  if (n.rejoin) {
    const rel = n.rejoin.bearing - n.heading;
    drawBearingArrow(ctx, rel, C, 92, 100, p.accent);
    distanceLabel(ctx, n.rejoin.dist, 178, p.fg, p.dim, 38);
  }
  text(ctx, 'Off route', C, 206, 20, p.warn, 800);
  gpsBadge(ctx, n, p);
}

function arrivedScreen(ctx: CanvasRenderingContext2D, m: PodModel, p: Palette): void {
  drawManeuver(ctx, ManeuverType.ARRIVE, 0, 0, C + 6, 82, 90, icons(p));
  text(ctx, 'Arrived', C, 162, 28, p.accent, 800);
  const km = (m.route!.total / 1000).toFixed(1);
  const mins = Math.round(m.tripTime / 60);
  text(ctx, `${km} km · ${mins} min`, C, 192, 18, p.dim, 700);
}

export function drawPod(ctx: CanvasRenderingContext2D, m: PodModel): void {
  const p = PALETTES[m.theme];
  ctx.save();
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, PX, PX);
  ctx.beginPath();
  ctx.arc(C, C, C, 0, Math.PI * 2);
  ctx.clip();

  const n = m.nav;
  if (m.screen === 'boot') bootScreen(ctx, m, p);
  else if (m.screen === 'upload') uploadScreen(ctx, m, p);
  else if (m.screen === 'noroute' || !m.route || !n) noRouteScreen(ctx, m, p);
  else if (n.arrived) arrivedScreen(ctx, m, p);
  else if (n.offRoute) offRouteScreen(ctx, n, p);
  else if (m.view === 'preview') {
    if (!junctionScreen(ctx, m, n, p, n.next)) arrowScreen(ctx, m, n, p);
  } else if (n.phase === Phase.NEAR || n.phase === Phase.NOW) {
    if (!junctionScreen(ctx, m, n, p, n.next)) arrowScreen(ctx, m, n, p);
  } else if (m.view === 'cruise' || (n.phase === Phase.FAR && n.d > CRUISE_D_M)) {
    cruiseScreen(ctx, m, n, p);
  } else arrowScreen(ctx, m, n, p);

  ctx.restore();
}
