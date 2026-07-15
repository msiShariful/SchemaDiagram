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

export const NOTE_WIDTH = 180;
export const NOTE_HEIGHT = 120;

export function getNoteRect(pos: TablePosition, size?: { w: number; h: number }): Rect {
  return { x: pos.x, y: pos.y, w: size?.w ?? NOTE_WIDTH, h: size?.h ?? NOTE_HEIGHT };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function expandRect(r: Rect, margin: number): Rect {
  return { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 };
}
