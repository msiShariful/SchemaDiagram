import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from './store';
import { EMPTY_SCHEMA } from '../core/model/types';
import { putDiagram, getDiagram, __resetForTests } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import {
  removeDiagram,
  scheduleAutosave,
  invalidatePendingAutosave,
  AUTOSAVE_DEBOUNCE_MS,
} from './usePersistence';

// Regression for the delete-resurrection race: editing then deleting a
// diagram within the 1s autosave debounce window used to be able to re-put
// the deleted record, because the debounce timer could fire during
// removeDiagram's `await deleteDiagram(id)` / `await listDiagrams()` gaps
// while the store's diagramId still pointed at the diagram being deleted.

const diagramA = (): PersistedDiagram => ({
  id: 'diagram-a',
  name: 'A',
  dbml: 'Table a { id int }',
  positions: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  updatedAt: 1,
});

const resetStore = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false,
  });

describe('usePersistence — delete-resurrection race (Critical 1 regression)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave(); // no debounce/generation state leaks in from another test
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deleting a diagram while its autosave is still debounced does not resurrect it', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);

    vi.useFakeTimers();

    // Simulate typing: mutate state and arm the autosave exactly like the
    // usePersistence() store subscription does.
    useAppStore.getState().setSource('Table a { id int }\nTable b { id int }');
    scheduleAutosave();

    // Delete the diagram being edited, well inside the 1s debounce window.
    const removed = removeDiagram(a.id);
    await vi.runAllTimersAsync(); // drain fake-indexeddb's internal async completions
    await removed;

    // Advance well past the debounce window. Before the fix, the stale
    // timer (armed before the delete) would still be pending here and would
    // fire, re-putting diagram A via saveCurrent().
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 500);
    vi.useRealTimers();

    expect(await getDiagram(a.id)).toBeUndefined();
  });

  it('deleting a NON-current diagram does not drop the current diagram\'s pending edit', async () => {
    // Regression for the follow-up issue introduced by the first fix: an
    // unconditional invalidatePendingAutosave() in removeDiagram cancelled
    // the CURRENT diagram's pending 1s autosave even when deleting some
    // OTHER diagram — if the user then closed/reloaded without another
    // edit, that edit was silently never persisted. A pending save for the
    // current diagram cannot resurrect a different deleted record
    // (saveCurrent puts state.diagramId, not the deleted id), so the
    // invalidation must only happen when deleting the current diagram.
    const a = diagramA();
    const b: PersistedDiagram = { ...diagramA(), id: 'diagram-b', name: 'B' };
    await putDiagram(a);
    await putDiagram(b);
    useAppStore.getState().loadDiagram(a);

    vi.useFakeTimers();

    // Simulate typing in A: mutate state and arm the autosave.
    const editedDbml = 'Table a { id int }\nTable edited_marker { id int }';
    useAppStore.getState().setSource(editedDbml);
    scheduleAutosave();

    // Delete B (not the current diagram) inside A's debounce window.
    const removed = removeDiagram(b.id);
    await vi.runAllTimersAsync(); // drain fake-indexeddb's internal async completions
    await removed;

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 500);
    vi.useRealTimers();

    const savedA = await getDiagram(a.id);
    expect(savedA?.dbml).toBe(editedDbml); // A's edit persisted, not dropped
    expect(await getDiagram(b.id)).toBeUndefined(); // B stays deleted
  });
});
