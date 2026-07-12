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
