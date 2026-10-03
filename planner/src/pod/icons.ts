// Maneuver icons for the round display. Stylised, high-contrast, readable at a glance.

import { ManeuverType as T } from '../bundle/trb';

const D2R = Math.PI / 180;

interface Pen {
  ctx: CanvasRenderingContext2D;
  s: number; // icon size, px
  cx: number;
  cy: number;
}

function head(p: Pen, x: number, y: number, angDeg: number, color: string): void {
  const { ctx, s } = p;
  const a = angDeg * D2R;
  const ux = Math.sin(a);
  const uy = -Math.cos(a);
  const L = 0.2 * s;
  const W = 0.19 * s;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + ux * L, y + uy * L);
  ctx.lineTo(x - uy * W, y + ux * W);
  ctx.lineTo(x + uy * W, y - ux * W);
  ctx.closePath();
  ctx.fill();
}

function stroke(p: Pen, color: string, pts: [number, number][]): void {
  const { ctx, s } = p;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.15 * s;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

/** Stem up from the bottom, then a branch at `ang` degrees (0 = straight, + = right). */
function turn(p: Pen, ang: number, color: string, withHead = true): void {
  const { s, cx, cy } = p;
  const jx = cx;
  const jy = cy + 0.08 * s;
  const L = 0.36 * s;
  const ex = jx + Math.sin(ang * D2R) * L;
  const ey = jy - Math.cos(ang * D2R) * L;
  stroke(p, color, [
    [cx, cy + 0.48 * s],
    [jx, jy],
    [ex, ey],
  ]);
  if (withHead) head(p, ex, ey, ang, color);
}

function uturn(p: Pen, side: 1 | -1, color: string): void {
  const { ctx, s, cx, cy } = p;
  const r = 0.18 * s;
  const x0 = cx - side * r;
  const x1 = cx + side * r;
  const top = cy - 0.12 * s;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.15 * s;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, cy + 0.48 * s);
  ctx.lineTo(x0, top);
  // Over the top: left→right for a right U-turn, right→left for a left one.
  if (side === 1) ctx.arc(cx, top, r, Math.PI, 0, false);
  else ctx.arc(cx, top, r, 0, Math.PI, true);
  ctx.lineTo(x1, cy + 0.12 * s);
  ctx.stroke();
  head(p, x1, cy + 0.12 * s, 180, color);
}

function roundabout(p: Pen, exitAng: number, exit: number, color: string): void {
  const { ctx, s, cx, cy } = p;
  const r = 0.2 * s;
  const ccy = cy + 0.02 * s;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.12 * s;
  ctx.beginPath();
  ctx.arc(cx, ccy, r, 0, Math.PI * 2);
  ctx.stroke();
  stroke(p, color, [
    [cx, cy + 0.48 * s],
    [cx, ccy + r],
  ]);
  const a = exitAng * D2R;
  const sx = cx + Math.sin(a) * r;
  const sy = ccy - Math.cos(a) * r;
  const ex = cx + Math.sin(a) * (r + 0.2 * s);
  const ey = ccy - Math.cos(a) * (r + 0.2 * s);
  stroke(p, color, [
    [sx, sy],
    [ex, ey],
  ]);
  head(p, ex, ey, exitAng, color);
  if (exit > 0) {
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(0.22 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(exit), cx, ccy + 1);
  }
}

function flag(p: Pen, color: string, bg: string, checkered: boolean): void {
  const { ctx, s, cx, cy } = p;
  const x = cx - 0.22 * s;
  const y = cy - 0.4 * s;
  const w = 0.5 * s;
  const h = 0.36 * s;
  ctx.fillStyle = color;
  ctx.fillRect(x - 0.07 * s, y, 0.07 * s, 0.88 * s);
  if (!checkered) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  const n = 4;
  const m = 3;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      ctx.fillStyle = (i + j) % 2 ? bg : color;
      ctx.fillRect(x + (i * w) / n, y + (j * h) / m, w / n + 0.5, h / m + 0.5);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

export interface IconColors {
  fg: string;
  ghost: string;
  bg: string;
}

export function drawManeuver(
  ctx: CanvasRenderingContext2D,
  type: T,
  modifier: number,
  exit: number,
  cx: number,
  cy: number,
  size: number,
  c: IconColors,
): void {
  const p: Pen = { ctx, s: size, cx, cy };
  switch (type) {
    case T.DEPART:
    case T.STRAIGHT:
      return turn(p, 0, c.fg);
    case T.SLIGHT_LEFT:
      return turn(p, -45, c.fg);
    case T.LEFT:
      return turn(p, -90, c.fg);
    case T.SHARP_LEFT:
      return turn(p, -135, c.fg);
    case T.SLIGHT_RIGHT:
      return turn(p, 45, c.fg);
    case T.RIGHT:
      return turn(p, 90, c.fg);
    case T.SHARP_RIGHT:
      return turn(p, 135, c.fg);
    case T.UTURN_LEFT:
      return uturn(p, -1, c.fg);
    case T.UTURN_RIGHT:
      return uturn(p, 1, c.fg);
    case T.KEEP_LEFT:
      turn(p, 0, c.ghost, false);
      return turn(p, -28, c.fg);
    case T.KEEP_RIGHT:
      turn(p, 0, c.ghost, false);
      return turn(p, 28, c.fg);
    case T.FORK_LEFT:
      turn(p, 32, c.ghost, false);
      return turn(p, -32, c.fg);
    case T.FORK_RIGHT:
      turn(p, -32, c.ghost, false);
      return turn(p, 32, c.fg);
    case T.RAMP_LEFT:
      turn(p, 0, c.ghost, false);
      return turn(p, -42, c.fg);
    case T.RAMP_RIGHT:
      turn(p, 0, c.ghost, false);
      return turn(p, 42, c.fg);
    case T.MERGE: {
      const side = modifier < 0 ? -1 : 1;
      stroke(p, c.ghost, [
        [cx - side * 0.3 * size, cy + 0.48 * size],
        [cx, cy - 0.05 * size],
      ]);
      return turn(p, 0, c.fg);
    }
    case T.ROUNDABOUT:
      return roundabout(p, Math.max(-170, Math.min(170, modifier * 2)), exit, c.fg);
    case T.ARRIVE:
      return flag(p, c.fg, c.bg, true);
    case T.WAYPOINT:
      return flag(p, c.fg, c.bg, false);
  }
}

/** Generic arrow pointing at `ang` degrees (screen-relative), used for off-route. */
export function drawBearingArrow(ctx: CanvasRenderingContext2D, ang: number, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang * D2R);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -0.5 * size);
  ctx.lineTo(0.36 * size, 0.05 * size);
  ctx.lineTo(0.12 * size, 0.05 * size);
  ctx.lineTo(0.12 * size, 0.45 * size);
  ctx.lineTo(-0.12 * size, 0.45 * size);
  ctx.lineTo(-0.12 * size, 0.05 * size);
  ctx.lineTo(-0.36 * size, 0.05 * size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
