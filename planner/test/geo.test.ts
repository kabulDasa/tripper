import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, destination, haversine } from '../src/geo/geo';
import { toScreen } from '../src/geo/mercator';
import { simplifyKeep } from '../src/plan/simplify';
import { JKT, ll, path } from './helpers';

const C = JKT.toLatLon({ x: 0, y: 0 });

describe('projection sanity (algorithms.md §4)', () => {
  const cam = (b: number) => ({ lat: C.lat, lon: C.lon, zoom: 17, bearing: b });

  it('north with bearing 0 → above center', () => {
    const p = toScreen(ll(0, 30).lat, ll(0, 30).lon, cam(0));
    expect(p.x).toBeCloseTo(120, 1);
    expect(p.y).toBeLessThan(120 - 10);
  });

  it('east with bearing 90 → above center', () => {
    const p = toScreen(ll(30, 0).lat, ll(30, 0).lon, cam(90));
    expect(p.x).toBeCloseTo(120, 1);
    expect(p.y).toBeLessThan(120 - 10);
  });

  it('east with bearing 0 → right of center', () => {
    const p = toScreen(ll(30, 0).lat, ll(30, 0).lon, cam(0));
    expect(p.y).toBeCloseTo(120, 1);
    expect(p.x).toBeGreaterThan(120 + 10);
  });

  it('north with bearing 90 → left of center', () => {
    const p = toScreen(ll(0, 30).lat, ll(0, 30).lon, cam(90));
    expect(p.x).toBeLessThan(120 - 10);
  });
});

describe('geo helpers', () => {
  it('haversine and local frame agree at route scale', () => {
    expect(haversine(ll(0, 0), ll(3000, 4000))).toBeCloseTo(5000, -1);
  });
  it('bearing / destination round trip', () => {
    const d = destination(C, 123, 500);
    expect(bearing(C, d)).toBeCloseTo(123, 1);
    expect(haversine(C, d)).toBeCloseTo(500, 0);
  });
  it('angleDiff is signed, positive clockwise', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });
});

describe('simplifyKeep', () => {
  it('collapses a straight line but keeps forced vertices', () => {
    const pts = path([[0, 0], [0, 1000]], 10);
    const keep = simplifyKeep(pts, 3, [37]);
    expect(keep).toEqual([0, 37, pts.length - 1]);
  });
  it('keeps corners', () => {
    const pts = path([[0, 0], [0, 500], [500, 500]], 10);
    const keep = simplifyKeep(pts, 3, []);
    expect(keep.length).toBe(3);
    expect(keep[1]).toBe(50);
  });
});
