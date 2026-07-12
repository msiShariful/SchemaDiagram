import type { Point, Rect } from '../core/model/types';

export const MINIMAP_W = 180;
export const MINIMAP_H = 120;
export const MINIMAP_PAD = 8;

export interface MiniTransform {
  scale: number;
  ox: number;
  oy: number;
}

export function boundsOfRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
}

export function minimapTransform(
  bounds: Rect,
  mapW = MINIMAP_W,
  mapH = MINIMAP_H,
  pad = MINIMAP_PAD,
): MiniTransform {
  const scale = Math.min((mapW - 2 * pad) / bounds.w, (mapH - 2 * pad) / bounds.h);
  return {
    scale,
    ox: (mapW - bounds.w * scale) / 2 - bounds.x * scale,
    oy: (mapH - bounds.h * scale) / 2 - bounds.y * scale,
  };
}

export function worldToMini(t: MiniTransform, p: Point): Point {
  return { x: p.x * t.scale + t.ox, y: p.y * t.scale + t.oy };
}

export function miniToWorld(t: MiniTransform, p: Point): Point {
  return { x: (p.x - t.ox) / t.scale, y: (p.y - t.oy) / t.scale };
}
