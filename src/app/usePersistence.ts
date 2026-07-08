import { useEffect } from 'react';
import { useAppStore, type DiagramRecord } from './store';
import { listDiagrams, getDiagram, putDiagram, deleteDiagram } from '../core/persist/repository';
import { createStarterDiagram } from './starter';
import { nanoid } from 'nanoid';

export const AUTOSAVE_DEBOUNCE_MS = 1000;

// Invalidation generation for the debounced autosave. Bumped by
// invalidatePendingAutosave() any time the diagram the store currently
// points at is about to change or disappear (delete, switch, create,
// duplicate). The debounced callback captures both the generation AND the
// diagramId at schedule time, and re-checks both when the timer fires — so
// a save armed for diagram A can never land once A's slot has been
// reassigned or deleted, even across the async gaps in removeDiagram
// (delete → await → list → await → load) where the store's diagramId alone
// hasn't changed yet.
let saveGeneration = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function currentRecord(): DiagramRecord | null {
  const s = useAppStore.getState();
  if (!s.diagramId) return null;
  return {
    id: s.diagramId, name: s.diagramName, dbml: s.source,
    positions: s.positions, viewport: s.viewport, updatedAt: Date.now(),
  };
}

async function saveCurrent(): Promise<void> {
  const rec = currentRecord();
  if (!rec) return;
  try {
    await putDiagram(rec);
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
  }
}

// Cancels any pending debounced autosave and bumps the generation so a
// callback that has already fired (or is about to) aborts instead of
// writing. Call this synchronously, before the first await, at the start of
// any operation that changes which diagram the store points at.
export function invalidatePendingAutosave(): void {
  saveGeneration += 1;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

// Arms (or re-arms) the debounced autosave. Exported as a plain function so
// both the store subscription below and tests can trigger identical
// scheduling behavior without mounting the React hook.
export function scheduleAutosave(debounceMs: number = AUTOSAVE_DEBOUNCE_MS): void {
  const myGeneration = saveGeneration;
  const myDiagramId = useAppStore.getState().diagramId;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (saveGeneration !== myGeneration) return; // invalidated since scheduling
    if (useAppStore.getState().diagramId !== myDiagramId) return; // diagram changed under us
    void saveCurrent();
  }, debounceMs);
}

export async function switchDiagram(id: string): Promise<void> {
  await saveCurrent();
  invalidatePendingAutosave();
  try {
    const rec = await getDiagram(id);
    if (rec) useAppStore.getState().loadDiagram(rec);
  } catch {
    // Read failed: flag storage and stay on the current diagram.
    useAppStore.getState().setStorageUnavailable(true);
  }
}

export async function createDiagram(): Promise<void> {
  await saveCurrent();
  invalidatePendingAutosave();
  const rec = createStarterDiagram();
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

export async function duplicateDiagram(): Promise<void> {
  // Flush the original first: a pending debounced autosave is otherwise
  // re-scheduled after loadDiagram(copy) and would read the COPY's state,
  // leaving the original's record stale (typed edits lost on switch-back).
  await saveCurrent();
  invalidatePendingAutosave();
  const cur = currentRecord();
  if (!cur) return;
  const copy: DiagramRecord = { ...cur, id: nanoid(), name: `${cur.name} copy`, updatedAt: Date.now() };
  try { await putDiagram(copy); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(copy);
}

export async function removeDiagram(id: string): Promise<void> {
  // Must be the very first thing, synchronously (before any await): it
  // cancels a debounce timer armed for this diagram and bumps the
  // generation so that even a callback which manages to fire during the
  // awaits below aborts instead of re-putting the record we're deleting —
  // otherwise a debounced autosave can resurrect a just-deleted diagram.
  invalidatePendingAutosave();
  try { await deleteDiagram(id); } catch { /* removal failing is non-fatal */ }
  if (useAppStore.getState().diagramId === id) {
    try {
      const rest = await listDiagrams();
      if (rest.length > 0) {
        useAppStore.getState().loadDiagram(rest[0]);
        return;
      }
    } catch {
      useAppStore.getState().setStorageUnavailable(true);
    }
    // Store empty or unreadable: fall back to a fresh starter diagram.
    // Deliberately NOT createDiagram(): its saveCurrent() flush would re-put
    // the record we just deleted (state still points at it), resurrecting it.
    const rec = createStarterDiagram();
    try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
    useAppStore.getState().loadDiagram(rec);
  }
}

export function renameDiagram(name: string): Promise<void> {
  useAppStore.getState().setDiagramName(name.trim() || 'Untitled');
  // Flush immediately (instead of waiting out the 1s debounce) so callers
  // can refresh the persisted diagram list right after the rename lands.
  return saveCurrent();
}

export function usePersistence(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listDiagrams();
        if (cancelled) return;
        if (all.length > 0) {
          useAppStore.getState().loadDiagram(all[0]);
        } else {
          const rec = createStarterDiagram();
          await putDiagram(rec);
          useAppStore.getState().loadDiagram(rec);
        }
      } catch {
        useAppStore.getState().setStorageUnavailable(true);
        useAppStore.getState().loadDiagram(createStarterDiagram());
      }
    })();

    const unsub = useAppStore.subscribe(
      (s) => [s.source, s.positions, s.viewport, s.diagramName] as const,
      () => scheduleAutosave(),
      { equalityFn: (a, b) => a.every((v, i) => Object.is(v, b[i])) },
    );
    return () => {
      cancelled = true;
      unsub();
      invalidatePendingAutosave();
    };
  }, []);
}
