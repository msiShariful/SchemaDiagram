import type { Rect, Viewport } from '../core/model/types';

/** Margin as a fraction of each viewport dimension, added on every side.
 *  Half a viewport keeps pop-in out of sight for anything less than a
 *  half-screen fling: culling recomputes only on gesture-end commits (pan
 *  release / the wheel's 150 ms idle commit) — the gestures themselves are
 *  imperative and never re-render. */
export const CULL_MARGIN_FRACTION = 0.5;

export function visibleWorldRect(
  vp: Viewport,
  viewW: number,
  viewH: number,
  marginFraction = CULL_MARGIN_FRACTION,
): Rect {
  const mx = viewW * marginFraction;
  const my = viewH * marginFraction;
  return {
    x: (-vp.x - mx) / vp.zoom,
    y: (-vp.y - my) / vp.zoom,
    w: (viewW + 2 * mx) / vp.zoom,
    h: (viewH + 2 * my) / vp.zoom,
  };
}
