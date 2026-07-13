import type { Schema, TablePosition } from '../model/types';
import { TABLE_WIDTH, tableHeight } from '../model/geometry';

export const ELK_ORIGIN = 60;

export const ELK_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
};

export interface ElkNodeIn {
  id: string;
  width: number;
  height: number;
}

export interface ElkEdgeIn {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraphIn {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNodeIn[];
  edges: ElkEdgeIn[];
}

export function buildElkGraph(schema: Schema, hiddenTableIds: readonly string[] = []): ElkGraphIn {
  // Feature D: lay out only VISIBLE tables. Hidden ones keep their stored
  // positions because elkResultToPositions only emits laid-out children and
  // the auto-layout commit only carries returned ids.
  const hidden = new Set(hiddenTableIds);
  const visible = schema.tables.filter((t) => !hidden.has(t.id));
  const ids = new Set(visible.map((t) => t.id));
  return {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: visible.map((t) => ({
      id: t.id,
      width: TABLE_WIDTH,
      height: tableHeight(t.fields.length),
    })),
    edges: schema.refs
      .filter(
        (r) =>
          ids.has(r.from.tableId) &&
          ids.has(r.to.tableId) &&
          r.from.tableId !== r.to.tableId,
      )
      .map((r) => ({ id: r.id, sources: [r.from.tableId], targets: [r.to.tableId] })),
  };
}

export function elkResultToPositions(graph: {
  children?: Array<{ id: string; x?: number; y?: number }>;
}): Record<string, TablePosition> {
  const out: Record<string, TablePosition> = {};
  for (const c of graph.children ?? []) {
    out[c.id] = { x: ELK_ORIGIN + (c.x ?? 0), y: ELK_ORIGIN + (c.y ?? 0) };
  }
  return out;
}
