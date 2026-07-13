import type { Point, Ref, Schema, TablePosition } from '../core/model/types';
import { getTableRect, HEADER_HEIGHT, ROW_HEIGHT } from '../core/model/geometry';

/** REF-DRAG drop hit-test (Feature A). GEOMETRIC lookup, not
 *  elementFromPoint: pure math over committed state is unit-testable, immune
 *  to overlay/temp-line pointer-events interference, and sees CULLED targets
 *  (mounted-ness is a render optimization, not a semantic). */

export interface DropField {
  tableId: string;
  schemaName: string;
  tableName: string;
  fieldName: string;
}

export function fieldDropTarget(
  schema: Schema,
  positions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[],
  pt: Point,
): DropField | null {
  const hidden = new Set(hiddenTableIds);
  // Reverse order: tables render in schema order, so the LAST hit paints on top.
  for (let i = schema.tables.length - 1; i >= 0; i--) {
    const t = schema.tables[i];
    const pos = positions[t.id];
    if (!pos || hidden.has(t.id)) continue;
    const r = getTableRect(t, pos);
    if (pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y || pt.y > r.y + r.h) continue;
    const row = Math.floor((pt.y - pos.y - HEADER_HEIGHT) / ROW_HEIGHT);
    if (row < 0 || row >= t.fields.length) return null; // header strip / rounding edge — invalid, and this table occludes anything below
    return { tableId: t.id, schemaName: t.schemaName, tableName: t.name, fieldName: t.fields[row].name };
  }
  return null;
}

export interface FieldRefLite {
  tableId: string;
  fieldName: string;
}

/** dbmlv2 rejects duplicate endpoint pairs (either order) as a parse error —
 *  a drop that would duplicate an existing single-field ref must cancel. */
export function isDuplicateRef(refs: readonly Ref[], a: FieldRefLite, b: FieldRefLite): boolean {
  const matches = (ep: { tableId: string; fieldNames: string[] }, x: FieldRefLite) =>
    ep.tableId === x.tableId && ep.fieldNames.length === 1 && ep.fieldNames[0] === x.fieldName;
  return refs.some(
    (r) => (matches(r.from, a) && matches(r.to, b)) || (matches(r.from, b) && matches(r.to, a)),
  );
}
