import type { Point, Rect } from '../core/model/types';
import { rectsOverlap } from '../core/model/geometry';

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Marquee semantics: any intersection selects (dbdiagram-style), not full containment. */
export function idsInRect(items: Array<{ id: string; rect: Rect }>, sel: Rect): string[] {
  return items.filter((it) => rectsOverlap(it.rect, sel)).map((it) => it.id);
}
