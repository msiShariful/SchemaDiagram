import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from './store';
import { EMPTY_SCHEMA } from '../core/model/types';
import { parseDbml } from '../core/parse/parseDbml';
import {
  putDiagram, getDiagram, listDiagrams, putSnapshot, listSnapshots, __resetForTests,
} from '../core/persist/repository';
import type { DiagramSnapshot, PersistedDiagram } from '../core/persist/repository';
import {
  scheduleAutosave, invalidatePendingAutosave, AUTOSAVE_DEBOUNCE_MS,
  importDiagram, restoreSnapshot,
} from './usePersistence';

const BASE = 'Table a { id int }';
const EDITED = 'Table a { id int }\nTable b { id int }';

const diagramA = (): PersistedDiagram => ({
  id: 'diagram-a', name: 'A', dbml: BASE,
  positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
});

const resetStore = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, editorFocusTableId: null, storageUnavailable: false,
  });

describe('snapshot + import persistence flows', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('writes a snapshot on a clean-parse autosave and dedupes identical text', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(EDITED)); // clean parse state
    vi.useFakeTimers();
    useAppStore.getState().setSource(EDITED);
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const snaps = await listSnapshots(a.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].dbml).toBe(EDITED);

    // an identical follow-up save must not add a second snapshot
    vi.useFakeTimers();
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await listSnapshots(a.id)).toHaveLength(1);
  });

  it('autosaves dirty text (never lose work) but does NOT snapshot it', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml('Table broken {')); // errors + stale
    vi.useFakeTimers();
    useAppStore.getState().setSource('Table broken {');
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect((await getDiagram(a.id))?.dbml).toBe('Table broken {'); // raw source still saved
    expect(await listSnapshots(a.id)).toEqual([]);                  // but never snapshotted
  });

  it('restore is non-destructive: checkpoints the pre-restore state first', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE));
    const old: DiagramSnapshot = {
      id: 'snap-old', diagramId: a.id, takenAt: 111, name: 'A',
      dbml: 'Table old { id int }', positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(old);

    await restoreSnapshot(old);

    expect(useAppStore.getState().source).toBe('Table old { id int }');
    expect((await getDiagram(a.id))?.dbml).toBe('Table old { id int }');
    const snaps = await listSnapshots(a.id);
    expect(snaps[0].dbml).toBe(BASE); // pre-restore checkpoint is the newest snapshot
    expect(snaps.map((s) => s.id)).toContain('snap-old');
  });

  it('restoring identical text patches layout without resetting the schema', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE));
    const schemaBefore = useAppStore.getState().schema;
    const snap: DiagramSnapshot = {
      id: 's-layout', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: { 'public.a': { x: 555, y: 66 } }, viewport: { x: 1, y: 2, zoom: 0.5 },
    };
    await putSnapshot(snap);

    await restoreSnapshot(snap);

    const st = useAppStore.getState();
    expect(st.schema).toBe(schemaBefore); // no EMPTY_SCHEMA reset, no stuck parse
    expect(st.positions['public.a']).toEqual({ x: 555, y: 66 });
    expect(st.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
    expect((await getDiagram(a.id))?.positions['public.a']).toEqual({ x: 555, y: 66 });
  });

  it('restore checkpoints layout-only drift even when text matches the newest snapshot', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE));
    // A prior snapshot with the SAME text as the live diagram (e.g. taken
    // right after this text was typed) — text-only dedupe would treat the
    // live state as "unchanged" and skip the pre-restore checkpoint.
    const textMatch: DiagramSnapshot = {
      id: 'snap-textmatch', diagramId: a.id, takenAt: 50, name: 'A',
      dbml: BASE, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(textMatch);
    // Layout has since drifted (a drag/pan) without a text change — drag/pan
    // never snapshots on its own, so this state was never captured.
    useAppStore.getState().moveTable('public.a', { x: 999, y: 111 });
    useAppStore.getState().setViewport({ x: 7, y: 8, zoom: 2 });

    const target: DiagramSnapshot = {
      id: 'snap-target', diagramId: a.id, takenAt: 200, name: 'A',
      dbml: 'Table target { id int }', positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(target);

    await restoreSnapshot(target);

    const snaps = await listSnapshots(a.id);
    const checkpoint = snaps.find((s) => s.dbml === BASE && s.positions['public.a']?.x === 999);
    expect(checkpoint).toBeDefined(); // the drifted layout was NOT discarded silently
    expect(checkpoint?.viewport).toEqual({ x: 7, y: 8, zoom: 2 });
  });

  it('restore aborts before mutating live state if the current diagram changed mid-flight', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE));
    const snap: DiagramSnapshot = {
      id: 'snap-x', diagramId: a.id, takenAt: 10, name: 'A',
      dbml: 'Table restored { id int }', positions: { 'public.a': { x: 1, y: 1 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);

    const p = restoreSnapshot(snap);
    // Simulate a diagram switch (or import) landing on the store while
    // restoreSnapshot's IDB awaits are still in flight — synchronous, so it
    // beats every one of restoreSnapshot's internal awaits.
    useAppStore.setState({
      diagramId: 'diagram-b', diagramName: 'B', source: 'Table b { id int }',
      positions: { 'public.b': { x: 5, y: 5 } }, viewport: { x: 9, y: 9, zoom: 3 },
    });
    await p;

    const st = useAppStore.getState();
    expect(st.diagramId).toBe('diagram-b');
    expect(st.diagramName).toBe('B');
    expect(st.source).toBe('Table b { id int }');
    expect(st.positions).toEqual({ 'public.b': { x: 5, y: 5 } });
    expect(st.viewport).toEqual({ x: 9, y: 9, zoom: 3 });
  });

  it('import creates a NEW diagram and never overwrites the current one', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    vi.useFakeTimers();
    useAppStore.getState().setSource(EDITED);
    scheduleAutosave(); // a pending edit on A when the import lands
    const done = importDiagram({ name: 'Imported', dbml: 'Table z { id int }' });
    await vi.runAllTimersAsync();
    await done;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 500);
    vi.useRealTimers();

    const st = useAppStore.getState();
    expect(st.diagramId).not.toBe(a.id);
    expect(st.source).toBe('Table z { id int }');
    expect(st.diagramName).toBe('Imported');
    expect((await getDiagram(a.id))?.dbml).toBe(EDITED); // A kept its flushed edit
    expect(await listDiagrams()).toHaveLength(2);
  });
});
