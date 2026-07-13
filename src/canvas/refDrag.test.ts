import { describe, it, expect } from 'vitest';
import { parseDbml } from '../core/parse/parseDbml';
import { HEADER_HEIGHT, ROW_HEIGHT, TABLE_WIDTH } from '../core/model/geometry';
import { fieldDropTarget, isDuplicateRef } from './refDrag';

const schema = (() => {
  const r = parseDbml('Table a { x int \n y int }\nTable b { p int }\nRef: a.x > b.p');
  if (!r.ok) throw new Error('fixture parse failed');
  return r.schema;
})();
const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 400, y: 0 } };

describe('fieldDropTarget', () => {
  it('resolves a point inside a field row to that field', () => {
    const pt = { x: 10, y: HEADER_HEIGHT + ROW_HEIGHT * 1.5 }; // a's second row
    expect(fieldDropTarget(schema, positions, [], pt)).toEqual({
      tableId: 'public.a', schemaName: 'public', tableName: 'a', fieldName: 'y',
    });
  });

  it('returns null on the header strip, outside all tables, and below the last row', () => {
    expect(fieldDropTarget(schema, positions, [], { x: 10, y: HEADER_HEIGHT / 2 })).toBeNull();
    expect(fieldDropTarget(schema, positions, [], { x: -50, y: 10 })).toBeNull();
    expect(fieldDropTarget(schema, positions, [], { x: 10, y: HEADER_HEIGHT + ROW_HEIGHT * 5 })).toBeNull();
  });

  it('ignores hidden tables and unpositioned tables', () => {
    const pt = { x: 410, y: HEADER_HEIGHT + ROW_HEIGHT / 2 };
    expect(fieldDropTarget(schema, positions, ['public.b'], pt)).toBeNull();
    expect(fieldDropTarget(schema, { 'public.a': positions['public.a'] }, [], pt)).toBeNull();
  });

  it('prefers the TOPMOST table when rects overlap (later in schema order paints on top)', () => {
    const overlapping = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: TABLE_WIDTH / 2, y: 0 } };
    const pt = { x: TABLE_WIDTH / 2 + 10, y: HEADER_HEIGHT + ROW_HEIGHT / 2 };
    expect(fieldDropTarget(schema, overlapping, [], pt)?.tableId).toBe('public.b');
  });
});

describe('isDuplicateRef', () => {
  const A = { tableId: 'public.a', fieldName: 'x' };
  const B = { tableId: 'public.b', fieldName: 'p' };
  it('detects the existing pair in both directions', () => {
    expect(isDuplicateRef(schema.refs, A, B)).toBe(true);
    expect(isDuplicateRef(schema.refs, B, A)).toBe(true);
  });
  it('a different field pair is not a duplicate', () => {
    expect(isDuplicateRef(schema.refs, { tableId: 'public.a', fieldName: 'y' }, B)).toBe(false);
  });
});
