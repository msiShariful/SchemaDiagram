import { describe, it, expect } from 'vitest';
import { computeGroupRect, GROUP_PADDING, GROUP_HEADER_HEIGHT } from './groups';
import type { Schema, Table } from '../model/types';

const mkTable = (name: string, fieldCount: number): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false, enumValues: null,
  })),
});

const schema: Schema = {
  tables: [mkTable('a', 1), mkTable('b', 2)],
  refs: [], enums: [],
  groups: [{ id: 'public.core', name: 'core', color: '#1e69de', tableIds: ['public.a', 'public.b'] }],
  notes: [],
};

describe('computeGroupRect', () => {
  it('wraps positioned members with padding and a header strip', () => {
    expect(GROUP_PADDING).toBe(24);
    expect(GROUP_HEADER_HEIGHT).toBe(24);
    const rect = computeGroupRect(schema.groups[0], schema, {
      'public.a': { x: 100, y: 100 }, // 220x60
      'public.b': { x: 400, y: 300 }, // 220x88
    });
    expect(rect).toEqual({ x: 76, y: 52, w: 568, h: 360 });
  });
  it('ignores unpositioned members', () => {
    const rect = computeGroupRect(schema.groups[0], schema, { 'public.a': { x: 0, y: 0 } });
    expect(rect).toEqual({ x: -24, y: -48, w: 268, h: 132 });
  });
  it('returns null when no member is positioned', () => {
    expect(computeGroupRect(schema.groups[0], schema, {})).toBeNull();
  });
});
