import type { Rect, Schema, TableGroup, TablePosition } from '../model/types';
import { getTableRect } from '../model/geometry';

export const GROUP_PADDING = 24;
export const GROUP_HEADER_HEIGHT = 24;

/** Bounding box of the group's positioned member tables, padded, with extra
 *  headroom for the header strip. Null when nothing is positioned yet. */
export function computeGroupRect(
  group: TableGroup,
  schema: Schema,
  positions: Record<string, TablePosition>,
): Rect | null {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const rects: Rect[] = [];
  for (const id of group.tableIds) {
    const table = byId.get(id);
    const pos = positions[id];
    if (table && pos) rects.push(getTableRect(table, pos));
  }
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x)) - GROUP_PADDING;
  const minY = Math.min(...rects.map((r) => r.y)) - GROUP_PADDING - GROUP_HEADER_HEIGHT;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + GROUP_PADDING;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + GROUP_PADDING;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
