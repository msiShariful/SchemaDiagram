import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { listDiagrams, getDiagram, putDiagram, deleteDiagram, __resetForTests } from './repository';
import type { PersistedDiagram } from './repository';

const rec = (id: string, updatedAt: number): PersistedDiagram => ({
  id, name: `d-${id}`, dbml: 'Table a { id int }',
  positions: { 'public.a': { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt,
});

describe('repository', () => {
  beforeEach(async () => { await __resetForTests(); });

  it('puts and gets a diagram round-trip', async () => {
    await putDiagram(rec('one', 100));
    const got = await getDiagram('one');
    expect(got).toEqual(rec('one', 100));
  });

  it('lists diagrams newest first', async () => {
    await putDiagram(rec('old', 100));
    await putDiagram(rec('new', 200));
    const all = await listDiagrams();
    expect(all.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('deletes a diagram', async () => {
    await putDiagram(rec('x', 1));
    await deleteDiagram('x');
    expect(await getDiagram('x')).toBeUndefined();
    expect(await listDiagrams()).toEqual([]);
  });

  it('round-trips notePositions', async () => {
    await putDiagram({ ...rec('n', 5), notePositions: { todo: { x: 3, y: 4 } } });
    const got = await getDiagram('n');
    expect(got?.notePositions).toEqual({ todo: { x: 3, y: 4 } });
  });
});
