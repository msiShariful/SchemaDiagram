/** Pure export-bounds computation — no DOM access, unit-tested in vitest's
 *  node environment (see svgExport.ts for the DOM-touching serialization
 *  that consumes this). */
import type { Schema, TablePosition, Rect } from '../../core/model/types';
import { getTableRect, getNoteRect, unionRects } from '../../core/model/geometry';
import { computeGroupRect } from '../../core/layout/groups';

/** Full-diagram export bounds: the union of every positioned table, sticky
 *  note, and group rect. Group rects are included explicitly (not just
 *  implied by their member tables) because computeGroupRect pads beyond its
 *  members — header strip + padding — so a group anchored at the diagram's
 *  edge would otherwise get clipped by a table-only union. */
export function computeExportBounds(
  schema: Schema,
  positions: Record<string, TablePosition>,
  notePositions: Record<string, TablePosition>,
): Rect | null {
  const tableRects = schema.tables.filter((t) => positions[t.id]).map((t) => getTableRect(t, positions[t.id]));
  const noteRects = schema.notes.filter((n) => notePositions[n.id]).map((n) => getNoteRect(notePositions[n.id]));
  const groupRects = schema.groups
    .map((g) => computeGroupRect(g, schema, positions))
    .filter((r): r is Rect => r !== null);
  return unionRects([...tableRects, ...noteRects, ...groupRects]);
}
