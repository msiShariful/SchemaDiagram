import type { Rect, Schema, TablePosition } from './types';
import { getTableRect } from './geometry';

/** Feature D helpers. Hidden tables KEEP their entries in store.positions —
 *  hiding is a VIEW concern, never a layout mutation — so consumers that
 *  must not see them (group rects, export bounds) look through this lens. */

/** Positions map without the hidden tables' entries. Returns the input map
 *  unchanged when nothing is hidden (memo/referential-equality friendly). */
export function omitHidden(
  positions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[],
): Record<string, TablePosition> {
  if (hiddenTableIds.length === 0) return positions;
  const hidden = new Set(hiddenTableIds);
  const out: Record<string, TablePosition> = {};
  for (const id of Object.keys(positions)) {
    if (!hidden.has(id)) out[id] = positions[id];
  }
  return out;
}

/** id+rect of every VISIBLE positioned table — the one assembly shared by
 *  zoom-to-fit, marquee hit-testing, and export bounds, so "hidden tables
 *  don't count" cannot drift between them. */
export function visibleTableRects(
  schema: Schema,
  positions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[],
): Array<{ id: string; rect: Rect }> {
  const hidden = new Set(hiddenTableIds);
  return schema.tables
    .filter((t) => positions[t.id] && !hidden.has(t.id))
    .map((t) => ({ id: t.id, rect: getTableRect(t, positions[t.id]) }));
}
