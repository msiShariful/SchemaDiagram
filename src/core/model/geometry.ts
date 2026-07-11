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
