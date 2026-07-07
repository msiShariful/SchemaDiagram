import type { Viewport, Point } from '../core/model/types';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function zoomAt(vp: Viewport, cursor: Point, deltaY: number): Viewport {
  const zoom = clampZoom(vp.zoom * Math.exp(-deltaY * 0.0015));
  const scale = zoom / vp.zoom;
  return {
    zoom,
    x: cursor.x - (cursor.x - vp.x) * scale,
    y: cursor.y - (cursor.y - vp.y) * scale,
  };
}
