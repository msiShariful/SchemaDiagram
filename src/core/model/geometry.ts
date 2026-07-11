import type { Table, TablePosition, Rect } from './types';

export const TABLE_WIDTH = 220;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 28;

export function tableHeight(fieldCount: number): number {
  return HEADER_HEIGHT + fieldCount * ROW_HEIGHT;
}

export function fieldRowY(index: number): number {
  return HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function getTableRect(table: Table, pos: TablePosition): Rect {
  return { x: pos.x, y: pos.y, w: TABLE_WIDTH, h: tableHeight(table.fields.length) };
}

/** Strict-inequality intersection: rects that merely touch do not overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
