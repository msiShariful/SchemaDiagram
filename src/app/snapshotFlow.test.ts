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
    hiddenTableIds: [], diagramCreatedAt: null,
    collapsedGroupIds: [],
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
    useAppStore.getState().applyParse(parseDbml(EDITED), EDITED); // clean parse state
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
    useAppStore.getState().applyParse(parseDbml('Table broken {'), 'Table broken {'); // errors + stale
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
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
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
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
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
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    // The NEWEST snapshot has the SAME text as the live diagram (taken right
    // after this text was typed) — text-only dedupe sees newest.dbml ===
    // cur.dbml and skips the pre-restore checkpoint. takenAt 300 keeps it
    // newest past `target` below: if an older-than-target snapshot held the
    // matching text, target's differing text alone would force a checkpoint
    // even under the old dedupe, and this test would pin nothing.
    const textMatch: DiagramSnapshot = {
      id: 'snap-textmatch', diagramId: a.id, takenAt: 300, name: 'A',
      dbml: BASE, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(textMatch);
    // Layout has since drifted (a drag/pan) without a text change — drag/pan
    // never snapshots on its own, so this state was never captured.
    // commitCanvasCommand (not moveTable, retired — no non-test caller) moves
    // it the same way a real drag commit would; snapshots only happen on
    // autosave, so this alone doesn't create one.
    const beforePos = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.a', before: beforePos, after: { x: 999, y: 111 } }],
      notes: [],
    });
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

  it('restore round-trips notePositions into live state and the persisted diagram', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    const snap: DiagramSnapshot = {
      id: 's-notes', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, notePositions: { 'note-1': { x: 77, y: 88 } }, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);

    await restoreSnapshot(snap); // identical text to BASE -> patches layout in place

    expect(useAppStore.getState().notePositions).toEqual({ 'note-1': { x: 77, y: 88 } });
    expect((await getDiagram(a.id))?.notePositions).toEqual({ 'note-1': { x: 77, y: 88 } });
  });

  it('restoring an old-shaped snapshot without notePositions falls back to empty (backward compatible)', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    useAppStore.setState({ notePositions: { stale: { x: 1, y: 1 } } });
    const snap: DiagramSnapshot = {
      id: 's-old', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, // no notePositions field — pre-Plan-3 shape
    };
    await putSnapshot(snap);

    await restoreSnapshot(snap);

    expect(useAppStore.getState().notePositions).toEqual({});
  });

  it('restore checkpoints note-only drift even when text, positions, and viewport all match the newest snapshot', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    // The NEWEST snapshot matches live text, positions AND viewport — only
    // notePositions has drifted (a note drag never snapshots on its own,
    // same class as the layout-drift case above). The positions map is
    // captured from live state (applyParse auto-placed public.a) and
    // notePositions is {} not absent: every non-note field must genuinely
    // match, or the checkpoint would fire on an unrelated mismatch and this
    // test would pin nothing about the notePositions comparison.
    const textMatch: DiagramSnapshot = {
      id: 'snap-textmatch-notes', diagramId: a.id, takenAt: 300, name: 'A',
      dbml: BASE, positions: { ...useAppStore.getState().positions },
      notePositions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(textMatch);
    useAppStore.setState({ notePositions: { 'note-1': { x: 42, y: 42 } } });

    const target: DiagramSnapshot = {
      id: 'snap-target-notes', diagramId: a.id, takenAt: 200, name: 'A',
      dbml: 'Table target { id int }', positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(target);

    await restoreSnapshot(target);

    const snaps = await listSnapshots(a.id);
    const checkpoint = snaps.find((s) => s.dbml === BASE && s.notePositions?.['note-1']?.x === 42);
    expect(checkpoint).toBeDefined(); // the drifted note position was NOT discarded silently
  });

  it('same-text restore resets the canvas undo stack: a later undo cannot replay a pre-restore move', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    // A committed drag before the restore — its before/after coordinates
    // belong to the pre-restore layout.
    const placed = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move', notes: [],
      tables: [{ id: 'public.a', before: placed, after: { x: 300, y: 300 } }],
    });
    const snap: DiagramSnapshot = {
      id: 's-undo', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE, // identical text -> patch branch
      positions: { 'public.a': { x: 555, y: 66 } }, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);

    await restoreSnapshot(snap);
    useAppStore.getState().undoCanvas(); // must be a no-op, not a replay of the stale move

    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 555, y: 66 });
  });

  it('restore aborts before mutating live state if the current diagram changed mid-flight', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
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

describe('createdAt + hiddenTableIds threading (Plan 6)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });

  it('importDiagram stamps createdAt and threads hiddenTableIds', async () => {
    await importDiagram({ name: 'Imp', dbml: BASE, hiddenTableIds: ['public.a'] });
    const s = useAppStore.getState();
    expect(s.diagramCreatedAt).not.toBeNull();
    expect(s.hiddenTableIds).toEqual(['public.a']);
    const all = await listDiagrams();
    expect(all[0].createdAt).toBe(s.diagramCreatedAt);
    expect(all[0].hiddenTableIds).toEqual(['public.a']);
  });

  it('hiddenTableIds travel through snapshot restore', async () => {
    const a: PersistedDiagram = { ...diagramA(), hiddenTableIds: ['public.a'] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);

    const snap: DiagramSnapshot = {
      id: 'snap-1', diagramId: a.id, takenAt: 5, name: 'A', dbml: EDITED,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, hiddenTableIds: ['public.b'],
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.b']);
    expect(useAppStore.getState().source).toBe(EDITED);
  });

  it('restoring an OLD snapshot without hiddenTableIds clears them (backward compat)', async () => {
    const a: PersistedDiagram = { ...diagramA(), hiddenTableIds: ['public.a'] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    const snap: DiagramSnapshot = {
      id: 'snap-old', diagramId: a.id, takenAt: 5, name: 'A', dbml: EDITED,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, // pre-Plan-6 row
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().hiddenTableIds).toEqual([]);
  });

  it('restore-checkpoint dedupe treats a pre-Plan-6 snapshot (no hiddenTableIds) as []', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a); // hiddenTableIds → []
    // Plan-3-era snapshot: HAS notePositions (so that compare passes) but
    // predates hiddenTableIds — the ?? [] normalization is what's under test.
    const snap: DiagramSnapshot = {
      id: 'snap-pre6', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, notePositions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap); // identical text+layout → checkpoint must dedupe
    expect(await listSnapshots(a.id)).toHaveLength(1); // no spurious checkpoint
  });

  it('same-text restore patches hiddenTableIds without reloading the diagram', async () => {
    const a: PersistedDiagram = { ...diagramA(), hiddenTableIds: [] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    const schemaBefore = useAppStore.getState().schema;
    const snap: DiagramSnapshot = {
      id: 'snap-same', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, hiddenTableIds: ['public.a'],
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().schema).toBe(schemaBefore); // no blank-canvas reload
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);
  });
});

describe('collapsedGroupIds threading (Plan 7 — the hiddenTableIds precedent)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });

  it('importDiagram threads collapsedGroupIds', async () => {
    await importDiagram({ name: 'Imp', dbml: BASE, collapsedGroupIds: ['public.g1'] });
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);
    const all = await listDiagrams();
    expect(all[0].collapsedGroupIds).toEqual(['public.g1']);
  });

  it('collapsedGroupIds travel through snapshot restore; old snapshots clear them', async () => {
    const a: PersistedDiagram = { ...diagramA(), collapsedGroupIds: ['public.g1'] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);

    const snap: DiagramSnapshot = {
      id: 'snap-c1', diagramId: a.id, takenAt: 5, name: 'A', dbml: EDITED,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, collapsedGroupIds: ['public.g2'],
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g2']);

    const old: DiagramSnapshot = {
      id: 'snap-c2', diagramId: a.id, takenAt: 6, name: 'A', dbml: BASE,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, // pre-Plan-7 row
    };
    await putSnapshot(old);
    await restoreSnapshot(old);
    expect(useAppStore.getState().collapsedGroupIds).toEqual([]);
  });

  it('restore-checkpoint dedupe treats a pre-Plan-7 snapshot (no collapsedGroupIds) as []', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a); // collapsedGroupIds → []
    const snap: DiagramSnapshot = {
      id: 'snap-pre7', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, notePositions: {}, hiddenTableIds: [], viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap); // identical text+layout → must dedupe, not checkpoint
    expect(await listSnapshots(a.id)).toHaveLength(1);
  });
});
