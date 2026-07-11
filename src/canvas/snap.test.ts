import { describe, it, expect } from 'vitest';
import { GRID_SIZE, SNAP_TOLERANCE, snapToGrid, snapPosition } from './snap';
import type { Rect } from '../core/model/types';

describe('snapToGrid', () => {
  it('rounds to the nearest grid multiple', () => {
    expect(GRID_SIZE).toBe(16);
    expect(snapToGrid(37)).toBe(32);
    expect(snapToGrid(40)).toBe(48);
    expect(snapToGrid(-9)).toBe(-16);
    expect(snapToGrid(0)).toBe(0);
  });
});

describe('snapPosition', () => {
  const size = { w: 200, h: 100 };

  it('grid-snaps with no neighbors and emits no guides', () => {
    const r = snapPosition({ x: 37, y: 70 }, size, []);
    expect(r.pos).toEqual({ x: 32, y: 64 });
    expect(r.guides).toEqual([]);
  });

  it('left-edge alignment beats grid snap and emits a vertical guide', () => {
    const others: Rect[] = [{ x: 100, y: 400, w: 220, h: 120 }];
    const r = snapPosition({ x: 103, y: 100 }, size, others);
    expect(r.pos.x).toBe(100);
    expect(r.pos.y).toBe(96); // y has no alignment within tolerance → grid
    expect(r.guides).toEqual([{ axis: 'x', at: 100 }]);
  });

  it('prefers the closest alignment (center over edge here)', () => {
    const others: Rect[] = [{ x: 0, y: 0, w: 220, h: 120 }];
    // center: |14+100-110| = 4; right-to-right: |214-220| = 6 → center wins
    const r = snapPosition({ x: 14, y: 308 }, size, others);
    expect(r.pos.x).toBe(10); // 110 - w/2
    expect(r.guides).toContainEqual({ axis: 'x', at: 110 });
  });

  it('snaps both axes and emits both guides when both align', () => {
    const others: Rect[] = [{ x: 0, y: 0, w: 220, h: 120 }];
    const r = snapPosition({ x: 3, y: 118 }, { w: 220, h: 120 }, others);
    expect(r.pos).toEqual({ x: 0, y: 120 }); // left-to-left, top-to-bottom stack
    expect(r.guides).toEqual([
      { axis: 'x', at: 0 },
      { axis: 'y', at: 120 },
    ]);
  });

  it('falls back to grid outside the tolerance', () => {
    // same width as the dragged box → all three horizontal candidates
    // (left 108 vs 100, center 208 vs 200, right 308 vs 300) are 8 > SNAP_TOLERANCE
    const others: Rect[] = [{ x: 100, y: 400, w: 200, h: 120 }];
    const r = snapPosition({ x: 108, y: 100 }, size, others);
    expect(SNAP_TOLERANCE).toBe(6);
    expect(r.pos.x).toBe(112);
    expect(r.guides).toEqual([]);
  });

  it('honors a custom tolerance (zoom-scaled by the caller)', () => {
    // all three horizontal candidates are 8 apart; 8 <= 20 → left-to-left
    // (first found) wins the tie
    const others: Rect[] = [{ x: 100, y: 400, w: 200, h: 120 }];
    const r = snapPosition({ x: 108, y: 100 }, size, others, 20);
    expect(r.pos.x).toBe(100);
  });
});
