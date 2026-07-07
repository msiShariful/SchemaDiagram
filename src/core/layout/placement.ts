import type { Schema, Table, TablePosition, Rect } from '../model/types';
import { getTableRect, TABLE_WIDTH } from '../model/geometry';

const MARGIN = 40;
const GAP = 60;
const ORIGIN = 60;
const SCAN_STEP = 20;

function collides(candidate: Rect, placed: Rect[]): boolean {
  return placed.some(
    (r) =>
      candidate.x < r.x + r.w + MARGIN &&
      r.x < candidate.x + candidate.w + MARGIN &&
      candidate.y < r.y + r.h + MARGIN &&
      r.y < candidate.y + candidate.h + MARGIN,
  );
}

function neighborCandidates(n: Rect, h: number): TablePosition[] {
  const out: TablePosition[] = [];
  for (let k = 1; k <= 4; k++) {
    const gap = GAP * k;
    out.push({ x: n.x + n.w + gap, y: n.y });          // right
    out.push({ x: n.x, y: n.y + n.h + gap });          // below
    out.push({ x: n.x - gap - TABLE_WIDTH, y: n.y });  // left
    out.push({ x: n.x, y: n.y - gap - h });            // above
  }
  return out;
}

function gridScan(w: number, h: number, placed: Rect[]): TablePosition {
  for (let y = ORIGIN; y < 100_000; y += SCAN_STEP) {
    for (let x = ORIGIN; x < ORIGIN + 3000; x += SCAN_STEP) {
      if (!collides({ x, y, w, h }, placed)) return { x, y };
    }
  }
  return { x: ORIGIN, y: ORIGIN };
}

export function placeNewTables(
  schema: Schema,
  positions: Record<string, TablePosition>,
): Record<string, TablePosition> {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const allPositions: Record<string, TablePosition> = { ...positions };
  const placedRects: Rect[] = schema.tables
    .filter((t) => allPositions[t.id])
    .map((t) => getTableRect(t, allPositions[t.id]));
  const out: Record<string, TablePosition> = {};

  const neighborsOf = (table: Table): Table[] =>
    schema.refs
      .filter((r) => r.from.tableId === table.id || r.to.tableId === table.id)
      .map((r) => (r.from.tableId === table.id ? r.to.tableId : r.from.tableId))
      .filter((id) => allPositions[id])
      .map((id) => byId.get(id))
      .filter((t): t is Table => !!t);

  for (const table of schema.tables) {
    if (allPositions[table.id]) continue;
    const rect = getTableRect(table, { x: 0, y: 0 });
    let chosen: TablePosition | null = null;
    for (const n of neighborsOf(table)) {
      const nRect = getTableRect(n, allPositions[n.id]);
      for (const c of neighborCandidates(nRect, rect.h)) {
        if (!collides({ ...c, w: rect.w, h: rect.h }, placedRects)) { chosen = c; break; }
      }
      if (chosen) break;
    }
    chosen ??= gridScan(rect.w, rect.h, placedRects);
    out[table.id] = chosen;
    allPositions[table.id] = chosen;
    placedRects.push({ ...chosen, w: rect.w, h: rect.h });
  }
  return out;
}
