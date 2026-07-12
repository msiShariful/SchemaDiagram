import { describe, it, expect } from 'vitest';
import { boundsOfRects, minimapTransform, worldToMini, miniToWorld, MINIMAP_W, MINIMAP_H, MINIMAP_PAD } from './minimapMath';

describe('boundsOfRects', () => {
  it('returns null for empty input', () => {
    expect(boundsOfRects([])).toBeNull();
  });
  it('returns the union bounding box', () => {
    expect(boundsOfRects([
      { x: 100, y: 100, w: 200, h: 100 },
      { x: 400, y: 250, w: 100, h: 50 },
    ])).toEqual({ x: 100, y: 100, w: 400, h: 200 });
  });
});

describe('minimapTransform', () => {
  const bounds = { x: 100, y: 100, w: 400, h: 200 };
  const t = minimapTransform(bounds);
  it('fits the bounds inside the padded map, centered', () => {
    expect(MINIMAP_W).toBe(180);
    expect(MINIMAP_H).toBe(120);
    expect(t.scale).toBeCloseTo((MINIMAP_W - 2 * MINIMAP_PAD) / 400); // width-limited: 0.41
    const topLeft = worldToMini(t, { x: 100, y: 100 });
    const bottomRight = worldToMini(t, { x: 500, y: 300 });
    expect(topLeft.x).toBeCloseTo(MINIMAP_PAD);
    expect(bottomRight.x).toBeCloseTo(MINIMAP_W - MINIMAP_PAD);
    // vertically centered: equal slack above and below
    expect(topLeft.y - 0).toBeCloseTo(MINIMAP_H - bottomRight.y);
  });
  it('round-trips world↔mini', () => {
    const p = { x: 234, y: 187 };
    const back = miniToWorld(t, worldToMini(t, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});
