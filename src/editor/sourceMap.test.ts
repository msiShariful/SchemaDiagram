import { describe, it, expect } from 'vitest';
import { blankNoise, buildTableRanges, tableAtPos, rangeForTable } from './sourceMap';

describe('blankNoise', () => {
  it('blanks comments and single-quoted strings, preserving length and newlines', () => {
    const src = "Table a { // brace }\n  n text [note: 'x } y']\n}";
    const out = blankNoise(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(3);
    expect(out).not.toContain('brace');
    expect(out).not.toContain('x } y');
    expect(out).toContain('Table a {');
  });
  it('blanks triple-quoted strings spanning lines', () => {
    const src = "Note: '''\n{ not a brace }\n'''\nTable b { }";
    const out = blankNoise(src);
    expect(out).not.toContain('not a brace');
    expect(out).toContain('Table b');
  });
  it('preserves double-quoted identifier content', () => {
    expect(blankNoise('Table "order items" { }')).toContain('order items');
  });
});

describe('buildTableRanges', () => {
  const src = [
    'Table users {',        // 0
    '  id integer [pk]',
    '}',
    '',
    'Table shop.orders as O {',
    "  note text [note: 'has } brace']",
    '  indexes {',
    '    (id)',
    '  }',
    '}',
    '// Table ghost { }',
    'Enum status { active }',
  ].join('\n');

  it('finds tables with ids, aliases, and correct extents', () => {
    const ranges = buildTableRanges(src);
    expect(ranges.map((r) => r.tableId)).toEqual(['public.users', 'shop.orders']);
    const orders = ranges[1];
    expect(orders.alias).toBe('O');
    expect(src.slice(orders.headerFrom, orders.headerTo)).toContain('Table shop.orders as O');
    // extent covers the nested indexes block and closes at the right brace
    expect(src.slice(orders.from, orders.to)).toContain('indexes {');
    expect(src.slice(orders.to - 1, orders.to)).toBe('}');
  });

  it('ignores tables inside comments and is not fooled by braces in strings', () => {
    const ranges = buildTableRanges(src);
    expect(ranges.find((r) => r.name === 'ghost')).toBeUndefined();
    expect(ranges).toHaveLength(2);
  });

  it('maps a cursor position to its enclosing table', () => {
    const ranges = buildTableRanges(src);
    const insideUsers = src.indexOf('id integer');
    expect(tableAtPos(ranges, insideUsers)?.tableId).toBe('public.users');
    expect(tableAtPos(ranges, src.indexOf('Enum'))).toBeNull();
  });

  it('looks up a range by tableId', () => {
    const ranges = buildTableRanges(src);
    expect(rangeForTable(ranges, 'shop.orders')?.alias).toBe('O');
    expect(rangeForTable(ranges, 'public.nope')).toBeNull();
  });

  it('supports double-quoted table names', () => {
    const ranges = buildTableRanges('Table "order items" {\n  id int\n}');
    expect(ranges[0].tableId).toBe('public.order items');
  });
});
