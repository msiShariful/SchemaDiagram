import type { Schema, Table, Relation } from '../model/types';

export interface EdgeSpec {
  id: string;
  fromTableId: string;
  fromFieldIndex: number;
  fromRelation: Relation;
  toTableId: string;
  toFieldIndex: number;
  toRelation: Relation;
}

export function buildEdgeSpecs(schema: Schema): EdgeSpec[] {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const specs: EdgeSpec[] = [];
  for (const ref of schema.refs) {
    const fromTable = byId.get(ref.from.tableId);
    const toTable = byId.get(ref.to.tableId);
    if (!fromTable || !toTable) continue;
    const fieldIndex = (table: Table, names: string[]) => {
      const i = table.fields.findIndex((f) => f.name === names[0]);
      return i >= 0 ? i : 0;
    };
    specs.push({
      id: ref.id,
      fromTableId: ref.from.tableId,
      fromFieldIndex: fieldIndex(fromTable, ref.from.fieldNames),
      fromRelation: ref.from.relation,
      toTableId: ref.to.tableId,
      toFieldIndex: fieldIndex(toTable, ref.to.fieldNames),
      toRelation: ref.to.relation,
    });
  }
  return specs;
}
