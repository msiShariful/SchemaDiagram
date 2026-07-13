import { describe, it, expect } from 'vitest';
import { omitHidden, visibleTableRects, effectiveHiddenIds } from './visibility';
import { parseDbml } from '../parse/parseDbml';

const r = parseDbml('Table a { id int }\nTable b { id int }\nTable c { id int }');
if (!r.ok) throw new Error('fixture parse failed');
const schema = r.schema;
const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 300, y: 0 } }; // c unpositioned

describe('omitHidden', () => {
  it('drops hidden ids, keeps the rest', () => {
    expect(Object.keys(omitHidden(positions, ['public.b']))).toEqual(['public.a']);
  });

  it('returns the SAME map object when nothing is hidden (memo-friendly)', () => {
    expect(omitHidden(positions, [])).toBe(positions);
  });

  it('ignores hidden ids with no position entry', () => {
    expect(omitHidden(positions, ['public.zzz'])).toEqual(positions);
  });
});

describe('visibleTableRects', () => {
  it('excludes hidden and unpositioned tables', () => {
    expect(visibleTableRects(schema, positions, ['public.a']).map((x) => x.id)).toEqual(['public.b']);
  });

  it('with nothing hidden, matches the positioned set', () => {
    expect(visibleTableRects(schema, positions, []).map((x) => x.id)).toEqual(['public.a', 'public.b']);
  });
});

describe('effectiveHiddenIds (Plan 7 group collapse)', () => {
  const schema = (() => {
    const r = parseDbml('Table a { id int }\nTable b { id int }\nTable c { id int }\nTableGroup g1 {\n  a\n  b\n}');
    if (!r.ok) throw new Error('fixture parse failed');
    return r.schema;
  })();

  it('returns the input array untouched when nothing is collapsed (referential stability)', () => {
    const hidden = ['public.c'];
    expect(effectiveHiddenIds(schema, hidden, [])).toBe(hidden);
  });

  it('unions collapsed-group members with explicit hides, without duplicates', () => {
    const out = effectiveHiddenIds(schema, ['public.a', 'public.c'], ['public.g1']);
    expect([...out].sort()).toEqual(['public.a', 'public.b', 'public.c']);
  });

  it('ignores collapsed ids that name no live group', () => {
    expect([...effectiveHiddenIds(schema, [], ['public.ghost'])]).toEqual([]);
  });
});
