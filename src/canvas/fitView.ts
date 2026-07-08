import type { Rect, Viewport } from '../core/model/types';
import { clampZoom } from './viewport';

export function fitViewport(rects: Rect[], viewW: number, viewH: number, padding = 40): Viewport {
  if (rects.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const w = maxX - minX;
  const h = maxY - minY;
  const zoom = clampZoom(Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h, 1));
  return {
    zoom,
    x: (viewW - w * zoom) / 2 - minX * zoom,
    y: (viewH - h * zoom) / 2 - minY * zoom,
  };
}
