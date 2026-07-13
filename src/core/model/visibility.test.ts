import { describe, it, expect } from 'vitest';
import { omitHidden, visibleTableRects } from './visibility';
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
