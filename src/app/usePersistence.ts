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
  const rec = await getDiagram(id);
  if (rec) useAppStore.getState().loadDiagram(rec);
}

export async function createDiagram(): Promise<void> {
  await saveCurrent();
  const rec = createStarterDiagram();
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

export async function duplicateDiagram(): Promise<void> {
  const cur = currentRecord();
  if (!cur) return;
  const copy: DiagramRecord = { ...cur, id: nanoid(), name: `${cur.name} copy`, updatedAt: Date.now() };
  try { await putDiagram(copy); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(copy);
}

export async function removeDiagram(id: string): Promise<void> {
  try { await deleteDiagram(id); } catch { /* removal failing is non-fatal */ }
  if (useAppStore.getState().diagramId === id) {
    const rest = await listDiagrams();
    if (rest.length > 0) useAppStore.getState().loadDiagram(rest[0]);
    else await createDiagram();
  }
}

export function renameDiagram(name: string): void {
  useAppStore.getState().setDiagramName(name.trim() || 'Untitled');
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
