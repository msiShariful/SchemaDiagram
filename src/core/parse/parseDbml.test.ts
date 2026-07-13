import { describe, it, expect } from 'vitest';
import { parseDbml } from './parseDbml';

const SAMPLE = `
Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
  role user_role [default: 'member']
}
Table posts {
  id integer [pk]
  user_id integer [not null, note: 'author']
}
Enum user_role { admin \n member }
Ref: posts.user_id > users.id
`;

describe('parseDbml', () => {
  it('normalizes tables, fields, and ids', () => {
    const r = parseDbml(SAMPLE);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.schema.tables.map((t) => t.id).sort()).toEqual(['public.posts', 'public.users']);
    const users = r.schema.tables.find((t) => t.id === 'public.users')!;
    expect(users.fields.map((f) => f.name)).toEqual(['id', 'username', 'role']);
    expect(users.fields[0]).toMatchObject({ pk: true, increment: true });
    expect(users.fields[1]).toMatchObject({ notNull: true, unique: true });
    expect(users.fields[2].isEnum).toBe(true);
    expect(users.fields[2].defaultValue).toBe('member');
    const posts = r.schema.tables.find((t) => t.id === 'public.posts')!;
    expect(posts.fields[1].note).toBe('author');
  });

  it('normalizes refs with endpoints and relations', () => {
    const r = parseDbml(SAMPLE);
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.refs).toHaveLength(1);
    const ref = r.schema.refs[0];
    const endpoints = [ref.from, ref.to];
    const many = endpoints.find((e) => e.relation === '*')!;
    const one = endpoints.find((e) => e.relation === '1')!;
    expect(many.tableId).toBe('public.posts');
    expect(many.fieldNames).toEqual(['user_id']);
    expect(one.tableId).toBe('public.users');
  });

  it('normalizes enums', () => {
    const r = parseDbml(SAMPLE);
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.enums).toEqual([{ id: 'public.user_role', name: 'user_role', values: ['admin', 'member'] }]);
  });

  it('supports multiple schemas in table ids', () => {
    const r = parseDbml('Table shop.orders { id int [pk] }');
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.tables[0].id).toBe('shop.orders');
  });

  it('returns positioned errors for invalid source', () => {
    const r = parseDbml('Table users {\n  id integer [pk\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].line).toBeGreaterThanOrEqual(1);
    expect(r.errors[0].message).toBeTruthy();
  });

  it('parses empty source to an empty schema', () => {
    const r = parseDbml('');
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.tables).toEqual([]);
  });
});

describe('table groups and sticky notes', () => {
  it('normalizes a TableGroup with members and color', () => {
    const r = parseDbml(
      'Table a { id int }\nTable b { id int }\nTableGroup core [color: #1e69de] {\n  a\n  b\n}',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.groups).toHaveLength(1);
    const g = r.schema.groups[0];
    expect(g.id).toBe('public.core');
    expect(g.name).toBe('core');
    expect(g.tableIds).toEqual(['public.a', 'public.b']);
    expect((g.color ?? '').toLowerCase()).toBe('#1e69de');
  });

  it('normalizes a standalone Note block', () => {
    const r = parseDbml("Table a { id int }\nNote todo {\n  'ship the canvas'\n}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.notes).toHaveLength(1);
    expect(r.schema.notes[0]).toEqual({ id: 'todo', name: 'todo', content: 'ship the canvas' });
  });

  it('emits empty groups and notes when the source has none', () => {
    const r = parseDbml('Table a { id int }');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.groups).toEqual([]);
    expect(r.schema.notes).toEqual([]);
  });
});

describe('ref origin: inline flag + pos (Plan 7 Feature A refusal path)', () => {
  const parse = (src: string) => {
    const r = parseDbml(src);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    return r.schema;
  };

  it('flags a field-settings ref inline and a standalone Ref line not', () => {
    const s = parse('Table a { id int }\nTable b { a_id int [pk, ref: > a.id] }\nTable c { a_id int }\nRef: c.a_id > a.id');
    expect(s.refs).toHaveLength(2);
    const inline = s.refs.find((r) => r.inline);
    const standalone = s.refs.find((r) => !r.inline);
    expect(inline).toBeDefined();
    expect(standalone).toBeDefined();
    // the standalone line is line 4
    expect(standalone!.pos?.line).toBe(4);
    // the inline token starts inside line 2's settings bracket
    expect(inline!.pos?.line).toBe(2);
    expect((inline!.pos?.column ?? 0) > 1).toBe(true);
  });

  it('an INDENTED standalone Ref stays standalone (column is not the signal)', () => {
    const s = parse('Table a { x int }\nTable b { p int }\n   Ref: a.x > b.p');
    expect(s.refs[0].inline).toBe(false);
  });

  it('a comment ending in a comma before a Ref line cannot fake inline (blanked scan)', () => {
    const s = parse('Table a { x int }\nTable b { p int }\n// note, with a comma,\nRef: a.x > b.p');
    expect(s.refs[0].inline).toBe(false);
  });

  it('named standalone refs with settings stay standalone', () => {
    const s = parse('Table a { x int }\nTable b { p int }\nRef fk_name: a.x > b.p [delete: cascade]');
    expect(s.refs[0].inline).toBe(false);
  });
});

describe('field enumValues (Plan 7 Feature B tooltips)', () => {
  it('resolves the enum value list onto enum-typed fields, null elsewhere', () => {
    const r = parseDbml('Enum status { draft\n live }\nTable t { s status\n n int }');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const [s, n] = r.schema.tables[0].fields;
    expect(s.isEnum).toBe(true);
    expect(s.enumValues).toEqual(['draft', 'live']);
    expect(n.isEnum).toBe(false);
    expect(n.enumValues).toBeNull();
  });
});
