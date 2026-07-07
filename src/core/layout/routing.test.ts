import { describe, it, expect } from 'vitest';
import { routeEdge, pointsToPath } from './routing';
import type { Rect } from '../model/types';

const rect = (x: number, y: number, w = 220, h = 116): Rect => ({ x, y, w, h });
const isOrthogonal = (pts: Array<{ x: number; y: number }>) =>
  pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y);

describe('routeEdge', () => {
  it('routes right → left when target is to the right', () => {
    const a = rect(0, 0);
    const b = rect(600, 0);
    const pts = routeEdge(a, 60, b, 90);
    expect(pts[0]).toEqual({ x: 220, y: 60 });           // exits a's right edge
    expect(pts[pts.length - 1]).toEqual({ x: 600, y: 90 }); // enters b's left edge
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('routes left → right when target is to the left', () => {
    const a = rect(600, 0);
    const b = rect(0, 0);
    const pts = routeEdge(a, 60, b, 90);
    expect(pts[0]).toEqual({ x: 600, y: 60 });
    expect(pts[pts.length - 1]).toEqual({ x: 220, y: 90 });
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('U-routes on the right when tables overlap horizontally', () => {
    const a = rect(0, 0);
    const b = rect(40, 300);
    const pts = routeEdge(a, 60, b, 360);
    expect(pts[0]).toEqual({ x: 220, y: 60 });
    expect(pts[pts.length - 1]).toEqual({ x: 260, y: 360 });
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(260);
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('serializes to an SVG path', () => {
    expect(pointsToPath([{ x: 1, y: 2 }, { x: 3, y: 2 }])).toBe('M 1 2 L 3 2');
  });
});
