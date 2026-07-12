import { describe, it, expect } from 'vitest';
import { visibleWorldRect, CULL_MARGIN_FRACTION } from './culling';
import { rectsOverlap } from '../core/model/geometry';

describe('visibleWorldRect', () => {
  it('maps the screen to world coordinates with margin', () => {
    expect(CULL_MARGIN_FRACTION).toBe(0.5);
    expect(visibleWorldRect({ x: 0, y: 0, zoom: 1 }, 800, 600)).toEqual({ x: -400, y: -300, w: 1600, h: 1200 });
  });
  it('accounts for pan and zoom (no margin)', () => {
    expect(visibleWorldRect({ x: -100, y: 50, zoom: 2 }, 800, 600, 0)).toEqual({ x: 50, y: -25, w: 400, h: 300 });
  });
  it('composes with rectsOverlap as the culling predicate', () => {
    const view = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, 800, 600, 0);
    expect(rectsOverlap({ x: 700, y: 100, w: 220, h: 88 }, view)).toBe(true); // straddles right edge
    expect(rectsOverlap({ x: 900, y: 100, w: 220, h: 88 }, view)).toBe(false); // fully offscreen
  });
});
