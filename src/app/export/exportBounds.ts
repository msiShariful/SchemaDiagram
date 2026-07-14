/** Pure export-bounds computation — no DOM access, unit-tested in vitest's
 *  node environment (see svgExport.ts for the DOM-touching serialization
 *  that consumes this). */
import type { Schema, TablePosition, Rect } from '../../core/model/types';
import { getNoteRect, unionRects } from '../../core/model/geometry';
import { computeGroupRect, GROUP_PILL_W, GROUP_PILL_H } from '../../core/layout/groups';
import { effectiveHiddenIds, omitHidden, visibleTableRects } from '../../core/model/visibility';

/** Full-diagram export bounds: the union of every VISIBLE positioned table,
 *  every sticky note, and every group rect over visible members. Group rects
 *  are included explicitly (not just implied by their member tables) because
 *  computeGroupRect pads beyond its members — header strip + padding — so a
 *  group anchored at the diagram's edge would otherwise get clipped. Hidden
 *  tables (Plan 6, Feature D) are excluded from BOTH the table union and the
 *  group rects: a group whose members are all hidden contributes nothing.
 *
 *  `hiddenTableIds` is the EXPLICIT hide set (as stored) and `collapsedGroupIds`
 *  the collapsed-group set; the effective hidden set (explicit ∪ collapsed
 *  members) is derived internally, mirroring GroupLayer. A collapsed group is
 *  rendered on canvas as a PILL, not its (unmounted) member tables, so its
 *  bounds contribution is the pill rect — anchored via computeGroupRect over
 *  EXPLICIT hides only, since the effective set folds in the group's own
 *  collapsed members and would null the rect (final-review fix). Expanded
 *  groups keep the pre-existing member-bbox-rect behavior. */
export function computeExportBounds(
  schema: Schema,
  positions: Record<string, TablePosition>,
  notePositions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[] = [],
  collapsedGroupIds: readonly string[] = [],
): Rect | null {
  const effectiveHidden = effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds);
  const tableRects = visibleTableRects(schema, positions, effectiveHidden).map((x) => x.rect);
  const noteRects = schema.notes.filter((n) => notePositions[n.id]).map((n) => getNoteRect(notePositions[n.id]));
  const visPositions = omitHidden(positions, effectiveHidden);
  const explicitPositions = omitHidden(positions, hiddenTableIds);
  const collapsed = new Set(collapsedGroupIds);
  const groupRects = schema.groups.flatMap((g): Rect[] => {
    if (collapsed.has(g.id)) {
      const rect = computeGroupRect(g, schema, explicitPositions);
      return rect ? [{ x: rect.x, y: rect.y, w: GROUP_PILL_W, h: GROUP_PILL_H }] : [];
    }
    const rect = computeGroupRect(g, schema, visPositions);
    return rect ? [rect] : [];
  });
  return unionRects([...tableRects, ...noteRects, ...groupRects]);
}
