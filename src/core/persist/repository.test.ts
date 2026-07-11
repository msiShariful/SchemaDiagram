import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import {
  listDiagrams, getDiagram, putDiagram, deleteDiagram,
  listSnapshots, putSnapshot, SNAPSHOT_LIMIT, __resetForTests,
} from './repository';
import type { PersistedDiagram, DiagramSnapshot } from './repository';

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
});

const snap = (id: string, diagramId: string, takenAt: number): DiagramSnapshot => ({
  id, diagramId, takenAt, name: 'd', dbml: `Table t { id int } // v${takenAt}`,
  positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
});

describe('snapshots', () => {
  beforeEach(async () => { await __resetForTests(); });

  it('lists snapshots for a diagram newest first, isolated per diagram', async () => {
    await putSnapshot(snap('a1', 'da', 100));
    await putSnapshot(snap('a2', 'da', 300));
    await putSnapshot(snap('b1', 'db', 200));
    expect((await listSnapshots('da')).map((s) => s.id)).toEqual(['a2', 'a1']);
    expect((await listSnapshots('db')).map((s) => s.id)).toEqual(['b1']);
  });

  it('prunes the ring buffer to SNAPSHOT_LIMIT per diagram', async () => {
    for (let i = 1; i <= SNAPSHOT_LIMIT + 3; i++) await putSnapshot(snap(`s${i}`, 'da', i));
    const all = await listSnapshots('da');
    expect(all).toHaveLength(SNAPSHOT_LIMIT);
    expect(all[0].takenAt).toBe(SNAPSHOT_LIMIT + 3); // newest kept
    expect(all[all.length - 1].takenAt).toBe(4);      // 1..3 pruned
  });

  it("deleteDiagram removes that diagram's snapshots only", async () => {
    await putDiagram(rec('da', 1));
    await putSnapshot(snap('a1', 'da', 100));
    await putSnapshot(snap('b1', 'db', 100));
    await deleteDiagram('da');
    expect(await listSnapshots('da')).toEqual([]);
    expect((await listSnapshots('db')).map((s) => s.id)).toEqual(['b1']);
  });

  it('upgrades a v1 database in place, preserving diagrams', async () => {
    // Recreate the exact Plan-1 schema: version 1, diagrams store only.
    const v1 = await openDB('dbdraft', 1, {
      upgrade(d) { d.createObjectStore('diagrams', { keyPath: 'id' }); },
    });
    await v1.put('diagrams', rec('legacy', 42));
    v1.close();
    // The repository now opens it at version 2 (oldVersion === 1 path).
    expect((await listDiagrams()).map((d) => d.id)).toEqual(['legacy']);
    await putSnapshot(snap('s1', 'legacy', 1));
    expect(await listSnapshots('legacy')).toHaveLength(1);
  });
});
