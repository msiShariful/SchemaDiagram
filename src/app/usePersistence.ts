import { useEffect } from 'react';
import { useAppStore, type DiagramRecord } from './store';
import { listDiagrams, getDiagram, putDiagram, deleteDiagram } from '../core/persist/repository';
import { createStarterDiagram } from './starter';
import { nanoid } from 'nanoid';

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

export async function switchDiagram(id: string): Promise<void> {
  await saveCurrent();
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
  const rec = createStarterDiagram();
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

export async function duplicateDiagram(): Promise<void> {
  // Flush the original first: a pending debounced autosave is otherwise
  // re-scheduled after loadDiagram(copy) and would read the COPY's state,
  // leaving the original's record stale (typed edits lost on switch-back).
  await saveCurrent();
  const cur = currentRecord();
  if (!cur) return;
  const copy: DiagramRecord = { ...cur, id: nanoid(), name: `${cur.name} copy`, updatedAt: Date.now() };
  try { await putDiagram(copy); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(copy);
}

export async function removeDiagram(id: string): Promise<void> {
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

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAppStore.subscribe(
      (s) => [s.source, s.positions, s.viewport, s.diagramName] as const,
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void saveCurrent(), 1000);
      },
      { equalityFn: (a, b) => a.every((v, i) => Object.is(v, b[i])) },
    );
    return () => {
      cancelled = true;
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
