import { describe, it, expect } from 'vitest';
import { buildEdgeSpecs } from './edges';
import { parseDbml } from '../parse/parseDbml';

describe('buildEdgeSpecs', () => {
  it('resolves field indexes for both endpoints', () => {
    const r = parseDbml(`
Table users { id int [pk] \n name varchar }
Table posts { id int [pk] \n author_id int }
Ref: posts.author_id > users.id
`);
    if (!r.ok) throw new Error('parse failed');
    const specs = buildEdgeSpecs(r.schema);
    expect(specs).toHaveLength(1);
    const s = specs[0];
    const many = s.fromRelation === '*' ? { t: s.fromTableId, i: s.fromFieldIndex } : { t: s.toTableId, i: s.toFieldIndex };
    const one = s.fromRelation === '1' ? { t: s.fromTableId, i: s.fromFieldIndex } : { t: s.toTableId, i: s.toFieldIndex };
    expect(many).toEqual({ t: 'public.posts', i: 1 });
    expect(one).toEqual({ t: 'public.users', i: 0 });
  });

  it('skips refs pointing at unknown tables', () => {
    const r = parseDbml('Table a { id int }');
    if (!r.ok) throw new Error('parse failed');
    const specs = buildEdgeSpecs({
      ...r.schema,
      refs: [{ id: 'x', inline: false, pos: null, from: { tableId: 'public.ghost', fieldNames: ['id'], relation: '*' }, to: { tableId: 'public.a', fieldNames: ['id'], relation: '1' } }],
    });
    expect(specs).toEqual([]);
  });
});
