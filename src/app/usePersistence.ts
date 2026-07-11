import { useEffect } from 'react';
import { useAppStore, type DiagramRecord } from './store';
import {
  listDiagrams, getDiagram, putDiagram, deleteDiagram, listSnapshots, putSnapshot,
} from '../core/persist/repository';
import type { DiagramSnapshot } from '../core/persist/repository';
import type { TablePosition, Viewport } from '../core/model/types';
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

// Snapshot policy (History): every successful diagram write below produces
// a snapshot CANDIDATE. It is kept only when (a) the parse state LOOKS
// clean (`!stale && errors.length === 0`) and (b) the text differs from the
// newest stored snapshot. Note the gate is approximate: stale/errors
// reflect the last COMPLETED parse, so a slow worker parse still in flight
// when the 1 s autosave fires can let a not-yet-validated text through —
// same race class as the applyFormat stale-check ledger item; move to a
// `parsedSource === dbml` gate once a parsedSource field exists.
// Layout-only saves (drag/pan) and the keystroke stream (1 s debounce)
// never snapshot. Runs strictly AFTER putDiagram has succeeded and swallows
// every failure: history is best-effort and must never break, abort, or
// reorder the diagram save itself.
async function maybeSnapshot(rec: DiagramRecord): Promise<void> {
  const s = useAppStore.getState();
  if (s.stale || s.errors.length > 0) return;
  try {
    const newest = (await listSnapshots(rec.id))[0];
    if (newest && newest.dbml === rec.dbml) return;
    await putSnapshot({
      id: nanoid(),
      diagramId: rec.id,
      takenAt: rec.updatedAt,
      name: rec.name,
      dbml: rec.dbml,
      positions: rec.positions,
      viewport: rec.viewport,
    });
  } catch {
    // best-effort: the diagram row itself was already saved above; a failed
    // snapshot write must not surface or flip the storage banner.
  }
}

async function saveCurrent(): Promise<void> {
  const rec = currentRecord();
  if (!rec) return;
  try {
    await putDiagram(rec);
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
    return;
  }
  await maybeSnapshot(rec);
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
  if (useAppStore.getState().diagramId === id) {
    // Deleting the CURRENT diagram: must run first, synchronously (before
    // any await) — it cancels a debounce timer armed for this diagram and
    // bumps the generation so that even a callback which manages to fire
    // during the awaits below aborts instead of re-putting the record
    // we're deleting (a debounced autosave would resurrect it otherwise).
    invalidatePendingAutosave();
  } else {
    // Deleting a NON-current diagram: a pending autosave belongs to the
    // current diagram and cannot resurrect the deleted record (saveCurrent
    // puts state.diagramId, which differs from `id`), so cancelling it
    // would only risk silently losing the user's latest edit if they
    // close/reload before another mutation re-arms the debounce. Flush it
    // instead — belt and suspenders, and the semantics stay obvious.
    await saveCurrent();
  }
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

export interface ImportedDiagram {
  name: string;
  dbml: string;
  positions?: Record<string, TablePosition>;
  viewport?: Viewport;
}

// Import ALWAYS creates a new diagram — it must never overwrite the current
// one (spec §3). Exact same discipline as createDiagram: flush the current
// diagram, then synchronously invalidate its pending autosave before the
// awaits tied to the switch.
export async function importDiagram(imp: ImportedDiagram): Promise<void> {
  await saveCurrent();
  invalidatePendingAutosave();
  const rec: DiagramRecord = {
    id: nanoid(),
    name: imp.name.trim() || 'Imported',
    dbml: imp.dbml,
    positions: imp.positions ?? {},
    viewport: imp.viewport ?? { x: 40, y: 40, zoom: 1 },
    updatedAt: Date.now(),
  };
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

// Restore a snapshot into the CURRENT diagram (same id). Non-destructive:
// the pre-restore state is checkpointed first (deduped against the newest
// snapshot), so a restore can itself be undone from the History panel.
// The checkpoint deliberately has no clean-parse gate — restore must never
// destroy state, even mid-error.
export async function restoreSnapshot(snap: DiagramSnapshot): Promise<void> {
  const cur = currentRecord();
  if (!cur || cur.id !== snap.diagramId) return;
  invalidatePendingAutosave();
  try {
    const newest = (await listSnapshots(cur.id))[0];
    if (!newest || newest.dbml !== cur.dbml) {
      await putSnapshot({
        id: nanoid(), diagramId: cur.id, takenAt: Date.now(), name: cur.name,
        dbml: cur.dbml, positions: cur.positions, viewport: cur.viewport,
      });
    }
  } catch {
    // history is best-effort; the restore itself proceeds
  }
  const rec: DiagramRecord = {
    id: cur.id, name: snap.name, dbml: snap.dbml,
    positions: snap.positions, viewport: snap.viewport, updatedAt: Date.now(),
  };
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  if (snap.dbml === cur.dbml) {
    // Text unchanged: loadDiagram would reset schema to EMPTY_SCHEMA and the
    // parse pipeline — keyed on [diagramId, source], both unchanged — would
    // never re-fire, leaving a blank canvas. Patch layout state directly and
    // keep the live schema.
    useAppStore.setState({ diagramName: rec.name, positions: rec.positions, viewport: rec.viewport });
  } else {
    useAppStore.getState().loadDiagram(rec);
  }
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
