import { describe, it, expect } from 'vitest';
import { zoomAt, clampZoom } from './viewport';

describe('viewport math', () => {
  it('clamps zoom to [0.1, 2.5]', () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(9)).toBe(2.5);
    expect(clampZoom(1)).toBe(1);
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const vp = { x: 100, y: 50, zoom: 1 };
    const cursor = { x: 400, y: 300 };
    const worldBefore = { x: (cursor.x - vp.x) / vp.zoom, y: (cursor.y - vp.y) / vp.zoom };
    const next = zoomAt(vp, cursor, -100); // zoom in
    const worldAfter = { x: (cursor.x - next.x) / next.zoom, y: (cursor.y - next.y) / next.zoom };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(next.zoom).toBeGreaterThan(vp.zoom);
  });

  it('zooms out on positive deltaY', () => {
    const next = zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 100);
    expect(next.zoom).toBeLessThan(1);
  });
});
