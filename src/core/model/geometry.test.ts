import { describe, it, expect } from 'vitest';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight, fieldRowY, getTableRect } from './geometry';
import type { Table } from './types';

const table = (fieldCount: number): Table => ({
  id: 'public.users', schemaName: 'public', name: 'users', alias: null,
  headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
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
