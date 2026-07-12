import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { TablePosition, Viewport } from '../model/types';

export interface PersistedDiagram {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  notePositions?: Record<string, TablePosition>; // optional: pre-Plan-3 records lack it
  viewport: Viewport;
  updatedAt: number;
}

const DB_NAME = 'dbdraft';
const STORE = 'diagrams';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' });
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
  await (await db()).delete(STORE, id);
}

export async function __resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB(DB_NAME);
}
