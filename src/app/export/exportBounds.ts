/** Pure export-bounds computation — no DOM access, unit-tested in vitest's
 *  node environment (see svgExport.ts for the DOM-touching serialization
 *  that consumes this). */
import type { Schema, TablePosition, Rect } from '../../core/model/types';
import { getNoteRect, unionRects } from '../../core/model/geometry';
import { computeGroupRect } from '../../core/layout/groups';
import { omitHidden, visibleTableRects } from '../../core/model/visibility';

/** Full-diagram export bounds: the union of every VISIBLE positioned table,
 *  every sticky note, and every group rect over visible members. Group rects
 *  are included explicitly (not just implied by their member tables) because
 *  computeGroupRect pads beyond its members — header strip + padding — so a
 *  group anchored at the diagram's edge would otherwise get clipped. Hidden
 *  tables (Plan 6, Feature D) are excluded from BOTH the table union and the
 *  group rects: a group whose members are all hidden contributes nothing. */
export function computeExportBounds(
  schema: Schema,
  positions: Record<string, TablePosition>,
  notePositions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[] = [],
): Rect | null {
  const tableRects = visibleTableRects(schema, positions, hiddenTableIds).map((x) => x.rect);
  const noteRects = schema.notes.filter((n) => notePositions[n.id]).map((n) => getNoteRect(notePositions[n.id]));
  const visPositions = omitHidden(positions, hiddenTableIds);
  const groupRects = schema.groups
    .map((g) => computeGroupRect(g, schema, visPositions))
    .filter((r): r is Rect => r !== null);
  return unionRects([...tableRects, ...noteRects, ...groupRects]);
}
