import { useEffect } from 'react';
import { useAppStore, resetCanvasStack, type DiagramRecord } from './store';
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
    positions: s.positions, notePositions: s.notePositions,
    hiddenTableIds: s.hiddenTableIds,
    viewport: s.viewport, updatedAt: Date.now(),
    // Only stamp createdAt when the store actually knows it — an autosave of
    // a pre-Plan-6 record must not invent a birth date.
    ...(s.diagramCreatedAt !== null ? { createdAt: s.diagramCreatedAt } : {}),
  };
}

// Shared by maybeSnapshot (autosave) and restoreSnapshot (pre-restore
// checkpoint): write a snapshot for `rec` unless the newest stored snapshot
// for its diagram already matches it. `compareLayout` controls what
// "matches" means:
//  - false (autosave): text-only, so a layout-only save (drag/pan) never
//    produces a new History entry — snapshots are text milestones, not a
//    pixel-by-pixel log.
//  - true (pre-restore checkpoint): text AND positions/notePositions/viewport,
//    because a restore can discard layout that drifted (drag/pan, note move)
//    since the newest snapshot even when the text hasn't changed — dedupe-by-
//    text-alone would then leave nothing to recover that layout from.
// Runs strictly AFTER the caller's diagram write has succeeded and swallows
// every failure: history is best-effort and must never break, abort, or
// reorder the write it follows.
async function snapshotIfChanged(rec: DiagramRecord, compareLayout: boolean): Promise<void> {
  try {
    const newest = (await listSnapshots(rec.id))[0];
    const sameLayout = !compareLayout || (
      JSON.stringify(newest?.positions) === JSON.stringify(rec.positions) &&
      JSON.stringify(newest?.notePositions) === JSON.stringify(rec.notePositions) &&
      JSON.stringify(newest?.viewport) === JSON.stringify(rec.viewport) &&
      // ?? [] on BOTH sides: a pre-Plan-6 snapshot (undefined) must equal a
      // live [] — otherwise the first restore after upgrade writes a
      // spurious checkpoint.
      JSON.stringify(newest?.hiddenTableIds ?? []) === JSON.stringify(rec.hiddenTableIds ?? [])
    );
    if (newest && newest.dbml === rec.dbml && sameLayout) return;
    await putSnapshot({
      id: nanoid(),
      diagramId: rec.id,
      takenAt: rec.updatedAt,
      name: rec.name,
      dbml: rec.dbml,
      positions: rec.positions,
      notePositions: rec.notePositions,
      hiddenTableIds: rec.hiddenTableIds,
      viewport: rec.viewport,
    });
  } catch {
    // best-effort: the diagram row itself was already saved above; a failed
    // snapshot write must not surface or flip the storage banner.
  }
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
// never snapshot (text-only dedupe — see snapshotIfChanged).
async function maybeSnapshot(rec: DiagramRecord): Promise<void> {
  const s = useAppStore.getState();
  if (s.stale || s.errors.length > 0) return;
  await snapshotIfChanged(rec, false);
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
  const copy: DiagramRecord = {
    ...cur, id: nanoid(), name: `${cur.name} copy`,
    createdAt: Date.now(), updatedAt: Date.now(), // a copy is a NEW document
  };
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

/** Rename an arbitrary diagram from the dashboard (Feature C). The CURRENT
 *  diagram routes through renameDiagram (store + immediate flush); any other
 *  row is a plain read-modify-write of its persisted record. Neither path
 *  repoints the store's diagram, so no autosave invalidation is needed. */
export async function renameDiagramById(id: string, name: string): Promise<void> {
  if (useAppStore.getState().diagramId === id) return renameDiagram(name);
  try {
    const rec = await getDiagram(id);
    if (rec) await putDiagram({ ...rec, name: name.trim() || 'Untitled', updatedAt: Date.now() });
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
  }
}

/** Duplicate any diagram WITHOUT switching to the copy (dashboard kebab).
 *  saveCurrent() first so duplicating the CURRENT row copies the latest
 *  in-memory edits rather than a stale record. The current diagram never
 *  changes, so no autosave invalidation is needed. */
export async function duplicateDiagramById(id: string): Promise<void> {
  await saveCurrent();
  try {
    const rec = await getDiagram(id);
    if (!rec) return;
    await putDiagram({
      ...rec, id: nanoid(), name: `${rec.name} copy`,
      createdAt: Date.now(), updatedAt: Date.now(), // a copy is a NEW document
    });
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
  }
}

export interface ImportedDiagram {
  name: string;
  dbml: string;
  positions?: Record<string, TablePosition>;
  notePositions?: Record<string, TablePosition>;
  hiddenTableIds?: string[];
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
    notePositions: imp.notePositions ?? {},
    hiddenTableIds: imp.hiddenTableIds ?? [],
    viewport: imp.viewport ?? { x: 40, y: 40, zoom: 1 },
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

// Restore a snapshot into the CURRENT diagram (same id). Non-destructive:
// the pre-restore state is checkpointed first (deduped against the newest
// snapshot by text AND layout — see snapshotIfChanged — since drag/pan never
// snapshots on its own, so layout can drift from the newest snapshot even
// when the text hasn't), so a restore can itself be undone from the History
// panel. The checkpoint deliberately has no clean-parse gate — restore must
// never destroy state, even mid-error.
export async function restoreSnapshot(snap: DiagramSnapshot): Promise<void> {
  const cur = currentRecord();
  if (!cur || cur.id !== snap.diagramId) return;
  invalidatePendingAutosave();
  await snapshotIfChanged(cur, true);
  const rec: DiagramRecord = {
    id: cur.id, name: snap.name, dbml: snap.dbml,
    positions: snap.positions, notePositions: snap.notePositions ?? {},
    hiddenTableIds: snap.hiddenTableIds ?? [],
    viewport: snap.viewport, updatedAt: Date.now(),
    ...(cur.createdAt !== undefined ? { createdAt: cur.createdAt } : {}), // restore never changes the birth date
  };
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  // The checkpoint + putDiagram awaits above give a diagram switch/import
  // room to land and repoint the store at a DIFFERENT diagram before we get
  // here. Re-check before the tail mutation (both branches): patching live
  // store state for the wrong diagram would corrupt it (and its own next
  // autosave would then persist A's restored data under B's id).
  if (useAppStore.getState().diagramId !== snap.diagramId) return;
  if (snap.dbml === cur.dbml) {
    // Text unchanged: loadDiagram would reset schema to EMPTY_SCHEMA and the
    // parse pipeline — keyed on [diagramId, source], both unchanged — would
    // never re-fire, leaving a blank canvas. Patch layout state directly and
    // keep the live schema. Like every other whole-map position replacement
    // (all of which go through loadDiagram), the canvas undo stack must be
    // reset: its commands hold pre-restore before/after coordinates, and
    // popping one after the swap would snap a table to an unrelated spot —
    // which autosave would then persist.
    resetCanvasStack();
    useAppStore.setState({
      diagramName: rec.name, positions: rec.positions, notePositions: rec.notePositions,
      hiddenTableIds: rec.hiddenTableIds, viewport: rec.viewport,
    });
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
      (s) => [s.source, s.positions, s.viewport, s.diagramName, s.notePositions, s.hiddenTableIds] as const,
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
