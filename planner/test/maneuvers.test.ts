import { describe, expect, it } from 'vitest';
import { ManeuverType as T } from '../src/bundle/trb';
import { mapStep, shortName, turnModifier } from '../src/plan/maneuvers';

const step = (type: string, modifier?: string, extra: Partial<{ exit: number; drivingSide: 'left' | 'right'; isFinal: boolean }> = {}) =>
  mapStep({ type, modifier, exit: extra.exit, drivingSide: extra.drivingSide ?? 'left', isFinal: extra.isFinal ?? true });

describe('OSRM → .trb maneuver mapping', () => {
  const cases: [string, string | undefined, T | null][] = [
    ['depart', undefined, T.DEPART],
    ['turn', 'sharp left', T.SHARP_LEFT],
    ['turn', 'left', T.LEFT],
    ['turn', 'slight left', T.SLIGHT_LEFT],
    ['turn', 'straight', T.STRAIGHT],
    ['turn', 'slight right', T.SLIGHT_RIGHT],
    ['turn', 'right', T.RIGHT],
    ['turn', 'sharp right', T.SHARP_RIGHT],
    ['end of road', 'left', T.LEFT],
    ['end of road', 'right', T.RIGHT],
    ['new name', 'straight', null],
    ['new name', 'slight left', T.SLIGHT_LEFT],
    ['continue', 'straight', null],
    ['continue', 'slight left', T.KEEP_LEFT],
    ['continue', 'slight right', T.KEEP_RIGHT],
    ['continue', 'left', T.LEFT],
    ['notification', 'straight', null],
    ['use lane', undefined, null],
    ['merge', 'slight left', T.MERGE],
    ['on ramp', 'left', T.RAMP_LEFT],
    ['on ramp', 'slight right', T.RAMP_RIGHT],
    ['off ramp', 'straight', T.STRAIGHT],
    ['fork', 'slight left', T.FORK_LEFT],
    ['fork', 'right', T.FORK_RIGHT],
    ['exit roundabout', 'left', null],
    ['exit rotary', 'right', null],
  ];
  it.each(cases)('%s / %s', (type, mod, want) => {
    const r = step(type, mod);
    expect(r?.type ?? null).toBe(want);
  });

  it('roundabouts carry the exit number', () => {
    expect(step('roundabout', 'right', { exit: 3 })).toEqual({ type: T.ROUNDABOUT, exit: 3 });
    expect(step('rotary', undefined, { exit: 2 })).toEqual({ type: T.ROUNDABOUT, exit: 2 });
  });

  it('U-turns swing right in left-hand traffic, left in right-hand traffic', () => {
    expect(step('turn', 'uturn', { drivingSide: 'left' })?.type).toBe(T.UTURN_RIGHT);
    expect(step('continue', 'uturn', { drivingSide: 'right' })?.type).toBe(T.UTURN_LEFT);
  });

  it('arrive at a via point is a WAYPOINT', () => {
    expect(step('arrive', undefined, { isFinal: false })?.type).toBe(T.WAYPOINT);
    expect(step('arrive', undefined, { isFinal: true })?.type).toBe(T.ARRIVE);
  });

  it('modifier is signed angle / 2, right positive', () => {
    expect(turnModifier(0, 90)).toBe(45);
    expect(turnModifier(90, 0)).toBe(-45);
    expect(turnModifier(350, 170)).toBe(90);
  });

  it('shortens Indonesian street prefixes', () => {
    expect(shortName('Jalan Gunung Sahari')).toBe('Jl. Gunung Sahari');
    expect(shortName('Gang Mawar')).toBe('Gg. Mawar');
    expect(shortName('Jalan Tol Lingkar Luar')).toBe('Tol Lingkar Luar');
    expect(shortName('Jalanan')).toBe('Jalanan');
  });
});
