import { describe, it, expect } from 'vitest';
import { computeExportBounds } from './exportBounds';
import type { Schema, Table, StickyNote } from '../../core/model/types';
import { parseDbml } from '../../core/parse/parseDbml';

const mkTable = (name: string): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: [{
    name: 'id', type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false, enumValues: null,
  }],
});

const mkNote = (id: string): StickyNote => ({ id, name: id, content: '' });

const schema = (extra: Partial<Schema>): Schema => ({
  tables: [mkTable('a')], refs: [], enums: [], groups: [], notes: [], ...extra,
});

describe('computeExportBounds', () => {
  it('is null when nothing is positioned', () => {
    expect(computeExportBounds(schema({}), {}, {})).toBeNull();
  });

  it('bounds a single table (220x60 at the origin)', () => {
    const b = computeExportBounds(schema({}), { 'public.a': { x: 0, y: 0 } }, {});
    expect(b).toEqual({ x: 0, y: 0, w: 220, h: 60 });
  });

  it('a note far outside the table extents expands the computed bounds', () => {
    const s = schema({ notes: [mkNote('n1')] });
    const withoutNote = computeExportBounds(s, { 'public.a': { x: 0, y: 0 } }, {});
    const withNote = computeExportBounds(
      s,
      { 'public.a': { x: 0, y: 0 } },
      { n1: { x: 2000, y: 2000 } }, // 180x120, well beyond the table
    );
    expect(withNote).toEqual({ x: 0, y: 0, w: 2180, h: 2120 });
    expect(withNote!.w).toBeGreaterThan(withoutNote!.w);
    expect(withNote!.h).toBeGreaterThan(withoutNote!.h);
  });

  it('includes group rects, whose header+padding can pad beyond their member tables', () => {
    const s: Schema = {
      tables: [mkTable('a')], refs: [], enums: [], notes: [],
      groups: [{ id: 'g1', name: 'g', color: null, tableIds: ['public.a'] }],
    };
    // Group padding (24) + header (24) = 48px above the table, beyond what a
    // table-only union would capture.
    const b = computeExportBounds(s, { 'public.a': { x: 100, y: 100 } }, {});
    expect(b!.y).toBe(100 - 24 - 24);
  });
});

describe('computeExportBounds — hidden tables (Plan 6)', () => {
  it('excludes hidden tables (and their group contribution) from the bounds', () => {
    const r = parseDbml('Table a { id int }\nTable b { id int }\nTableGroup g1 {\n  a\n  b\n}');
    if (!r.ok) throw new Error('fixture parse failed');
    const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 1000, y: 0 } };
    const full = computeExportBounds(r.schema, positions, {});
    const without = computeExportBounds(r.schema, positions, {}, ['public.b']);
    expect(full).not.toBeNull();
    expect(without).not.toBeNull();
    // b sits at x=1000: with it hidden, nothing (table OR group padding) may reach that far right
    expect(without!.x + without!.w).toBeLessThan(1000);
    expect(full!.x + full!.w).toBeGreaterThan(1000);
  });

  it('returns null when every table is hidden and nothing else is positioned', () => {
    const r = parseDbml('Table a { id int }\nTableGroup g1 {\n  a\n}');
    if (!r.ok) throw new Error('fixture parse failed');
    expect(computeExportBounds(r.schema, { 'public.a': { x: 0, y: 0 } }, {}, ['public.a'])).toBeNull();
  });
});

describe('computeExportBounds — collapsed group pills (final-review fix)', () => {
  it('unions a collapsed group pill rect (not the member table\'s own rect) even far outside other content', () => {
    const s: Schema = {
      tables: [mkTable('a'), mkTable('b')], refs: [], enums: [], notes: [],
      groups: [{ id: 'g1', name: 'g', color: null, tableIds: ['public.b'] }],
    };
    const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 5000, y: 5000 } };
    // b is a collapsed-group member (not explicitly hidden): the canvas does
    // not mount table b, only GroupLayer's pill for g1 — bounds must follow.
    const b = computeExportBounds(s, positions, {}, [], ['g1']);
    expect(b).not.toBeNull();
    // Must reach well past table a alone (the original bug: the collapsed
    // group contributed nothing, so bounds stopped at table a's 220x60).
    expect(b!.w).toBeGreaterThan(220);
    expect(b!.h).toBeGreaterThan(60);
    // But must NOT reach as far as table b's own full rect would (x to 5220,
    // y to 5060) — that would mean b leaked in as an ordinary table rect
    // instead of being replaced by the smaller (200x36) pill anchored at the
    // group's padded top-left corner (member origin minus padding+header).
    expect(b!.x + b!.w).toBeLessThan(5220);
    expect(b!.y + b!.h).toBeLessThan(5060);
  });

  it('a collapsed group with every member explicitly hidden contributes nothing (matches GroupLayer rendering no pill)', () => {
    const s: Schema = {
      tables: [mkTable('a'), mkTable('b')], refs: [], enums: [], notes: [],
      groups: [{ id: 'g1', name: 'g', color: null, tableIds: ['public.b'] }],
    };
    const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 5000, y: 5000 } };
    const b = computeExportBounds(s, positions, {}, ['public.b'], ['g1']);
    // Only table a remains — same 220x60 rect as the single-table case above.
    expect(b).toEqual({ x: 0, y: 0, w: 220, h: 60 });
  });
});
