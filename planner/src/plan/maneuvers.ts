// OSRM `maneuver.type` + `modifier` → .trb ManeuverType (bundle-format.md § type enum).

import { ManeuverType as T } from '../bundle/trb';
import { angleDiff } from '../geo/geo';
import type { RouteStep } from './routing';

const BY_MODIFIER: Record<string, T> = {
  'sharp left': T.SHARP_LEFT,
  left: T.LEFT,
  'slight left': T.SLIGHT_LEFT,
  straight: T.STRAIGHT,
  'slight right': T.SLIGHT_RIGHT,
  right: T.RIGHT,
  'sharp right': T.SHARP_RIGHT,
};

const isLeft = (m?: string) => !!m && m.includes('left');
const isRight = (m?: string) => !!m && m.includes('right');

/** Step types that only announce a name change or lane info. Dropped when they don't turn. */
const SILENT_WHEN_STRAIGHT = new Set(['new name', 'continue', 'notification', 'use lane']);

/** Map one step. Returns null for steps the pod shouldn't prompt for. */
export function mapStep(s: Pick<RouteStep, 'type' | 'modifier' | 'exit' | 'drivingSide' | 'isFinal'> & { legIndex?: number }): { type: T; exit: number } | null {
  const mod = s.modifier;
  switch (s.type) {
    case 'depart':
      // Every leg starts with a depart; after a via point it's not a maneuver (WAYPOINT covers it).
      return s.legIndex ? null : { type: T.DEPART, exit: 0 };
    case 'arrive':
      return { type: s.isFinal ? T.ARRIVE : T.WAYPOINT, exit: 0 };
    case 'roundabout':
    case 'rotary':
      return { type: T.ROUNDABOUT, exit: s.exit ?? 0 };
    case 'roundabout turn':
      break; // a small roundabout taken as a plain turn: map by modifier below
    case 'exit roundabout':
    case 'exit rotary':
      return null; // folded into the ROUNDABOUT prompt (exit number)
    case 'merge':
      return { type: T.MERGE, exit: 0 };
    case 'on ramp':
    case 'off ramp':
      if (isLeft(mod)) return { type: T.RAMP_LEFT, exit: 0 };
      if (isRight(mod)) return { type: T.RAMP_RIGHT, exit: 0 };
      return { type: T.STRAIGHT, exit: 0 };
    case 'fork':
      if (isLeft(mod)) return { type: T.FORK_LEFT, exit: 0 };
      if (isRight(mod)) return { type: T.FORK_RIGHT, exit: 0 };
      return { type: T.STRAIGHT, exit: 0 };
  }
  // turn, end of road, continue, new name, notification, use lane, unknown
  if (mod === 'uturn') {
    // U-turns swing across oncoming traffic: right in left-hand-traffic countries (Indonesia).
    return { type: s.drivingSide === 'left' ? T.UTURN_RIGHT : T.UTURN_LEFT, exit: 0 };
  }
  if ((!mod || mod === 'straight') && SILENT_WHEN_STRAIGHT.has(s.type)) return null;
  if (s.type === 'continue' && (mod === 'slight left' || mod === 'slight right')) {
    return { type: mod === 'slight left' ? T.KEEP_LEFT : T.KEEP_RIGHT, exit: 0 };
  }
  return { type: (mod ? BY_MODIFIER[mod] : undefined) ?? T.STRAIGHT, exit: 0 };
}

/** `modifier` byte: signed turn angle / 2, positive = right. */
export function turnModifier(bearingBefore: number, bearingAfter: number): number {
  return Math.round(angleDiff(bearingBefore, bearingAfter) / 2);
}

/** Shorten Indonesian street-type prefixes for a 32 mm screen. */
export function shortName(name: string): string {
  return name
    .replace(/^Jalan Tol\b/, 'Tol')
    .replace(/^Jalan\b/, 'Jl.')
    .replace(/^Gang\b/, 'Gg.')
    .trim();
}
