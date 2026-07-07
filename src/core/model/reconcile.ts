import type { Schema, Table, TablePosition } from './types';

function signature(t: Table): string {
  return `${t.schemaName}|${[...t.fields.map((f) => f.name)].sort().join(',')}`;
}

export function reconcilePositions(
  prev: Schema,
  next: Schema,
  positions: Record<string, TablePosition>,
): Record<string, TablePosition> {
  const nextIds = new Set(next.tables.map((t) => t.id));
  const out: Record<string, TablePosition> = {};
  for (const id of Object.keys(positions)) {
    if (nextIds.has(id)) out[id] = positions[id];
  }

  const removed = prev.tables.filter((t) => !nextIds.has(t.id) && positions[t.id]);
  const added = next.tables.filter((t) => !out[t.id]);
  const removedBySig = new Map<string, Table[]>();
  for (const t of removed) {
    const sig = signature(t);
    removedBySig.set(sig, [...(removedBySig.get(sig) ?? []), t]);
  }
  for (const t of added) {
    const candidates = removedBySig.get(signature(t));
    const match = candidates?.shift();
    if (match) out[t.id] = positions[match.id];
  }
  return out;
}
