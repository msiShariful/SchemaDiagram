import { describe, it, expect } from 'vitest';
import { rectFromPoints, idsInRect } from './marquee';

describe('rectFromPoints', () => {
  it('normalizes any drag direction into a positive rect', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 50 })).toEqual({ x: 4, y: 20, w: 6, h: 30 });
    expect(rectFromPoints({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('idsInRect', () => {
  const items = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 50 } },
    { id: 'b', rect: { x: 200, y: 0, w: 100, h: 50 } },
    { id: 'c', rect: { x: 0, y: 200, w: 100, h: 50 } },
  ];
  it('selects by intersection, not containment', () => {
    expect(idsInRect(items, { x: 50, y: 25, w: 200, h: 10 })).toEqual(['a', 'b']);
  });
  it('returns empty for a rect that hits nothing', () => {
    expect(idsInRect(items, { x: 400, y: 400, w: 50, h: 50 })).toEqual([]);
  });
});
