import { describe, it, expect } from 'vitest';
import { fitViewport } from './fitView';

describe('fitViewport', () => {
  it('fits content bounds inside the view with padding', () => {
    const vp = fitViewport([{ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 200, w: 100, h: 100 }], 800, 600, 40);
    // content bounds: 0,0 → 400,300; check corners map inside view
    const sx = (wx: number) => wx * vp.zoom + vp.x;
    const sy = (wy: number) => wy * vp.zoom + vp.y;
    expect(sx(0)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(sy(0)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(sx(400)).toBeLessThanOrEqual(800 - 40 + 1e-6);
    expect(sy(300)).toBeLessThanOrEqual(600 - 40 + 1e-6);
  });
  it('returns identity-ish default for empty content', () => {
    expect(fitViewport([], 800, 600)).toEqual({ x: 0, y: 0, zoom: 1 });
  });
  it('never zooms in past 1 for tiny content', () => {
    const vp = fitViewport([{ x: 0, y: 0, w: 10, h: 10 }], 800, 600, 40);
    expect(vp.zoom).toBeLessThanOrEqual(1);
  });
});
