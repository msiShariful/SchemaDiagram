import type { Rect, TablePosition } from '../core/model/types';

export const GRID_SIZE = 16;
export const SNAP_TOLERANCE = 6; // world units; callers divide by zoom for screen-constant feel

/** Below this raw pointer travel (screen px), a canvas gesture is a click,
 *  not a drag — shared by table drags (DiagramCanvas.handleLiveMove) and
 *  note drags (NoteNode) so the two feel identical. */
export const DRAG_THRESHOLD_PX = 3;

export interface GuideLine {
  axis: 'x' | 'y'; // 'x' = vertical line at world x `at`
  at: number;
}

export interface SnapResult {
  pos: TablePosition;
  guides: GuideLine[];
}

export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

interface Best {
  at: number;
  snapped: number;
  d: number;
}

/** Snap a dragged box: edge/center alignment with nearby rects wins (closest
 *  match, strict <, first-found breaks ties), else snap-to-grid. Guides are
 *  emitted only for alignment snaps.
 *  ponytail: O(others × 9) per pointermove — fine for the 120-table target;
 *  switch to sorted edge lists if a profile ever says otherwise. */
export function snapPosition(
  raw: TablePosition,
  size: { w: number; h: number },
  others: Rect[],
  tolerance = SNAP_TOLERANCE,
): SnapResult {
  let bestX: Best | null = null;
  let bestY: Best | null = null;
  for (const r of others) {
    const xTargets = [r.x, r.x + r.w / 2, r.x + r.w];
    const yTargets = [r.y, r.y + r.h / 2, r.y + r.h];
    const xAnchors = [0, size.w / 2, size.w];
    const yAnchors = [0, size.h / 2, size.h];
    for (const t of xTargets) {
      for (const a of xAnchors) {
        const d = Math.abs(raw.x + a - t);
        if (d <= tolerance && (!bestX || d < bestX.d)) bestX = { at: t, snapped: t - a, d };
      }
    }
    for (const t of yTargets) {
      for (const a of yAnchors) {
        const d = Math.abs(raw.y + a - t);
        if (d <= tolerance && (!bestY || d < bestY.d)) bestY = { at: t, snapped: t - a, d };
      }
    }
  }
  const guides: GuideLine[] = [];
  if (bestX) guides.push({ axis: 'x', at: bestX.at });
  if (bestY) guides.push({ axis: 'y', at: bestY.at });
  return {
    pos: {
      x: bestX ? bestX.snapped : snapToGrid(raw.x),
      y: bestY ? bestY.snapped : snapToGrid(raw.y),
    },
    guides,
  };
}
