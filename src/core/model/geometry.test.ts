import { describe, it, expect } from 'vitest';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight, fieldRowY, getTableRect, rectsOverlap, unionRects, expandRect } from './geometry';
import type { Table } from './types';

const table = (fieldCount: number): Table => ({
  id: 'public.users', schemaName: 'public', name: 'users', alias: null,
  headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false, enumValues: null,
  })),
});

describe('geometry', () => {
  it('computes table height from field count', () => {
    expect(tableHeight(0)).toBe(HEADER_HEIGHT);
    expect(tableHeight(3)).toBe(HEADER_HEIGHT + 3 * ROW_HEIGHT);
  });
  it('centers field rows vertically', () => {
    expect(fieldRowY(0)).toBe(HEADER_HEIGHT + ROW_HEIGHT / 2);
    expect(fieldRowY(2)).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT + ROW_HEIGHT / 2);
  });
  it('builds table rect from position', () => {
    expect(getTableRect(table(2), { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: TABLE_WIDTH, h: tableHeight(2) });
  });
});

describe('rectsOverlap', () => {
  it('detects intersection and rejects separation', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
  });
  it('treats touching edges as non-overlapping', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('unionRects / expandRect', () => {
  it('unions rects into a bounding box', () => {
    expect(unionRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 40, y: -5, w: 10, h: 10 },
    ])).toEqual({ x: 0, y: -5, w: 50, h: 15 });
  });
  it('returns null for no rects', () => {
    expect(unionRects([])).toBeNull();
  });
  it('expands a rect by a margin on all sides', () => {
    expect(expandRect({ x: 10, y: 20, w: 30, h: 40 }, 5)).toEqual({ x: 5, y: 15, w: 40, h: 50 });
  });
});
