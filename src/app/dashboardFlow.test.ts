import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';
import { EMPTY_SCHEMA } from '../core/model/types';
import { putDiagram, getDiagram, listDiagrams, __resetForTests } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import { renameDiagramById, duplicateDiagramById, invalidatePendingAutosave, switchDiagram } from './usePersistence';

const rec = (id: string, name: string, over: Partial<PersistedDiagram> = {}): PersistedDiagram => ({
  id, name, dbml: 'Table a { id int }', positions: {},
  viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1, ...over,
});

const resetStore = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, notePositions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hiddenTableIds: [], diagramCreatedAt: null, storageUnavailable: false, parsedSource: null,
  });

describe('dashboard persistence helpers (Plan 6)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });

  it('renameDiagramById renames a NON-current diagram without touching the store', async () => {
    await putDiagram(rec('other', 'Old'));
    useAppStore.getState().loadDiagram(rec('current', 'Current'));
    await renameDiagramById('other', '  New Name  ');
    expect((await getDiagram('other'))?.name).toBe('New Name');
    expect(useAppStore.getState().diagramName).toBe('Current');
  });

  it('renameDiagramById routes the CURRENT diagram through the store + flush', async () => {
    const cur = rec('current', 'Current');
    await putDiagram(cur);
    useAppStore.getState().loadDiagram(cur);
    await renameDiagramById('current', 'Renamed');
    expect(useAppStore.getState().diagramName).toBe('Renamed');
    expect((await getDiagram('current'))?.name).toBe('Renamed');
  });

  it('duplicateDiagramById copies without switching, stamping fresh createdAt', async () => {
    await putDiagram(rec('other', 'Source', { createdAt: 111, hiddenTableIds: ['public.a'] }));
    useAppStore.getState().loadDiagram(rec('current', 'Current'));
    await duplicateDiagramById('other');
    const copy = (await listDiagrams()).find((d) => d.name === 'Source copy');
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe('other');
    expect(copy!.createdAt).toBeGreaterThan(111);
    expect(copy!.hiddenTableIds).toEqual(['public.a']); // view state travels with the copy
    expect(useAppStore.getState().diagramId).toBe('current'); // no switch
  });

  it('duplicateDiagramById of the CURRENT diagram copies the latest in-memory edits', async () => {
    const cur = rec('current', 'Current');
    await putDiagram(cur);
    useAppStore.getState().loadDiagram(cur);
    useAppStore.getState().setSource('Table b { id int }'); // newer than the stored record
    await duplicateDiagramById('current');
    const copy = (await listDiagrams()).find((d) => d.name === 'Current copy');
    expect(copy?.dbml).toBe('Table b { id int }'); // saveCurrent() flushed first
  });

  it('switchDiagram to the CURRENT diagram is a no-op — does not wipe the canvas undo stack', async () => {
    const cur = rec('current', 'Current', { positions: { a: { x: 0, y: 0 } } });
    await putDiagram(cur);
    useAppStore.getState().loadDiagram(cur);
    useAppStore.getState().commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'a', before: { x: 0, y: 0 }, after: { x: 50, y: 50 } }],
      notes: [],
    });
    expect(useAppStore.getState().positions.a).toEqual({ x: 50, y: 50 });
    await switchDiagram('current'); // same id: reloading would call resetCanvasStack()
    useAppStore.getState().undoCanvas();
    expect(useAppStore.getState().positions.a).toEqual({ x: 0, y: 0 }); // undo still works: stack survived
  });
});
