import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { TablePosition, Viewport } from '../model/types';

export interface PersistedDiagram {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
  updatedAt: number;
}

/** One History entry. Ring buffer: at most SNAPSHOT_LIMIT rows per diagram. */
export interface DiagramSnapshot {
  id: string;
  diagramId: string;
  takenAt: number;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
}

export const SNAPSHOT_LIMIT = 20;

const DB_NAME = 'dbdraft';
const DB_VERSION = 2; // v1: diagrams. v2: + snapshots (keyPath id, index byDiagram).
const STORE = 'diagrams';
const SNAPSHOTS = 'snapshots';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      // Guarded per-version so both fresh installs (0 → 2) and existing
      // Plan-1 databases (1 → 2) arrive at the same shape without ever
      // touching existing diagram rows.
      if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' });
      if (oldVersion < 2) {
        const snaps = d.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
        snaps.createIndex('byDiagram', 'diagramId');
      }
    },
  });
  return dbPromise;
}

export async function listDiagrams(): Promise<PersistedDiagram[]> {
  const all = (await (await db()).getAll(STORE)) as PersistedDiagram[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDiagram(id: string): Promise<PersistedDiagram | undefined> {
  return (await (await db()).get(STORE, id)) as PersistedDiagram | undefined;
}

export async function putDiagram(rec: PersistedDiagram): Promise<void> {
  await (await db()).put(STORE, rec);
}

export async function deleteDiagram(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
  // History is per-diagram: deleting the diagram deletes its snapshots too.
  const snaps = (await d.getAllFromIndex(SNAPSHOTS, 'byDiagram', id)) as DiagramSnapshot[];
  await Promise.all(snaps.map((s) => d.delete(SNAPSHOTS, s.id)));
}

export async function listSnapshots(diagramId: string): Promise<DiagramSnapshot[]> {
  const all = (await (await db()).getAllFromIndex(SNAPSHOTS, 'byDiagram', diagramId)) as DiagramSnapshot[];
  return all.sort((a, b) => b.takenAt - a.takenAt);
}

/** Insert a snapshot, then prune the ring: only the newest SNAPSHOT_LIMIT
 *  rows for that diagram survive. */
export async function putSnapshot(snap: DiagramSnapshot): Promise<void> {
  const d = await db();
  await d.put(SNAPSHOTS, snap);
  const all = (await d.getAllFromIndex(SNAPSHOTS, 'byDiagram', snap.diagramId)) as DiagramSnapshot[];
  if (all.length > SNAPSHOT_LIMIT) {
    all.sort((a, b) => b.takenAt - a.takenAt);
    await Promise.all(all.slice(SNAPSHOT_LIMIT).map((s) => d.delete(SNAPSHOTS, s.id)));
  }
}

export async function __resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB(DB_NAME);
}
