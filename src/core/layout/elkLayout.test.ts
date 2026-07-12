import { describe, it, expect } from 'vitest';
import { runElkLayout } from './elkLayout';
import { parseDbml } from '../parse/parseDbml';
import { getTableRect, rectsOverlap } from '../model/geometry';

describe('runElkLayout (in-thread fallback path)', () => {
  it('returns non-overlapping positions for every table', async () => {
    const r = parseDbml(
      'Table a { id int }\nTable b { id int\n a_id int }\nTable c { id int\n a_id int }\n' +
      'Ref: b.a_id > a.id\nRef: c.a_id > a.id',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pos = await runElkLayout(r.schema);
    expect(Object.keys(pos).sort()).toEqual(['public.a', 'public.b', 'public.c']);
    const rects = r.schema.tables.map((t) => getTableRect(t, pos[t.id]));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i], rects[j])).toBe(false);
      }
    }
  }, 20_000);

  it('resolves empty for an empty schema without touching elkjs', async () => {
    await expect(
      runElkLayout({ tables: [], refs: [], enums: [], groups: [], notes: [] }),
    ).resolves.toEqual({});
  });
});
