import { describe, it, expect } from 'vitest';
import { buildElkGraph, elkResultToPositions, ELK_ORIGIN, ELK_LAYOUT_OPTIONS } from './elkGraph';
import { parseDbml } from '../../core/parse/parseDbml';
import type { Schema } from '../model/types';

const schemaOf = (src: string): Schema => {
  const r = parseDbml(src);
  if (!r.ok) throw new Error('fixture parse failed');
  return r.schema;
};

describe('buildElkGraph', () => {
  it('maps tables to sized nodes and refs to edges', () => {
    const g = buildElkGraph(schemaOf('Table a { id int }\nTable b { id int\n a_id int }\nRef: b.a_id > a.id'));
    expect(g.layoutOptions).toBe(ELK_LAYOUT_OPTIONS);
    expect(g.children).toEqual([
      { id: 'public.a', width: 220, height: 60 },
      { id: 'public.b', width: 220, height: 88 },
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].sources).toEqual(['public.b']);
    expect(g.edges[0].targets).toEqual(['public.a']);
  });
  it('skips self-references', () => {
    const g = buildElkGraph(schemaOf('Table c { id int\n parent_id int }\nRef: c.parent_id > c.id'));
    expect(g.edges).toEqual([]);
  });
  it('maps arrange algorithms to distinct probed ELK options; default stays layered', () => {
    const schema = schemaOf('Table a { id int }');
    expect(buildElkGraph(schema).layoutOptions).toBe(ELK_LAYOUT_OPTIONS);
    expect(buildElkGraph(schema, [], 'left-right').layoutOptions['elk.algorithm']).toBe('layered');
    const snow = buildElkGraph(schema, [], 'snowflake').layoutOptions;
    expect(snow['elk.algorithm']).toBe('stress');
    expect(snow['elk.stress.desiredEdgeLength']).toBe('420'); // probed: default overlaps 220x150 boxes; short form avoids the leak marker
    expect(buildElkGraph(schema, [], 'compact').layoutOptions['elk.algorithm']).toBe('rectpacking');
  });

  it('produces an empty graph for an empty schema', () => {
    const g = buildElkGraph({ tables: [], refs: [], enums: [], groups: [], notes: [] });
    expect(g.children).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe('buildElkGraph — hidden tables (Plan 6)', () => {
  it('lays out only visible tables and drops refs touching hidden ones', () => {
    const r = parseDbml('Table a { id int }\nTable b { a_id int }\nTable c { id int }\nRef: b.a_id > a.id\n');
    if (!r.ok) throw new Error('fixture parse failed');
    const g = buildElkGraph(r.schema, ['public.a']);
    expect(g.children.map((c) => c.id)).toEqual(['public.b', 'public.c']);
    expect(g.edges).toEqual([]); // the only ref touches hidden public.a
  });

  it('default (nothing hidden) is unchanged', () => {
    const r = parseDbml('Table a { id int }\nTable b { a_id int }\nRef: b.a_id > a.id\n');
    if (!r.ok) throw new Error('fixture parse failed');
    const g = buildElkGraph(r.schema);
    expect(g.children).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });
});

describe('elkResultToPositions', () => {
  it('offsets ELK coordinates by the origin', () => {
    expect(elkResultToPositions({ children: [{ id: 't', x: 10, y: 20 }] })).toEqual({
      t: { x: ELK_ORIGIN + 10, y: ELK_ORIGIN + 20 },
    });
  });
});
