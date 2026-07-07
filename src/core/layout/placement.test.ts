import { describe, it, expect } from 'vitest';
import { placeNewTables } from './placement';
import { getTableRect } from '../model/geometry';
import type { Schema, Table, Rect } from '../model/types';

const mkTable = (name: string, fieldCount = 3): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
  })),
});
const ref = (a: string, b: string) => ({
  id: `r-${a}-${b}`,
  from: { tableId: `public.${a}`, fieldNames: ['f0'], relation: '*' as const },
  to: { tableId: `public.${b}`, fieldNames: ['f0'], relation: '1' as const },
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeNewTables', () => {
  it('places all unplaced tables without overlap', () => {
    const tables = Array.from({ length: 12 }, (_, i) => mkTable(`t${i}`));
    const schema: Schema = { tables, refs: [], enums: [], groups: [], notes: [] };
    const placed = placeNewTables(schema, {});
    expect(Object.keys(placed)).toHaveLength(12);
    const rects = tables.map((t) => getTableRect(t, placed[t.id]));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(overlaps(rects[i], rects[j])).toBe(false);
  });

  it('is deterministic', () => {
    const schema: Schema = { tables: [mkTable('a'), mkTable('b')], refs: [], enums: [], groups: [], notes: [] };
    expect(placeNewTables(schema, {})).toEqual(placeNewTables(schema, {}));
  });

  it('does not move already-placed tables', () => {
    const schema: Schema = { tables: [mkTable('a'), mkTable('b')], refs: [], enums: [], groups: [], notes: [] };
    const placed = placeNewTables(schema, { 'public.a': { x: 500, y: 500 } });
    expect(placed['public.a']).toBeUndefined(); // only NEW positions returned
    expect(placed['public.b']).toBeDefined();
  });

  it('places a ref-connected table near its placed neighbor', () => {
    const schema: Schema = {
      tables: [mkTable('users'), mkTable('posts')],
      refs: [ref('posts', 'users')], enums: [], groups: [], notes: [],
    };
    const placed = placeNewTables(schema, { 'public.users': { x: 1000, y: 1000 } });
    const p = placed['public.posts'];
    const dist = Math.hypot(p.x - 1000, p.y - 1000);
    expect(dist).toBeLessThan(600);
  });
});
