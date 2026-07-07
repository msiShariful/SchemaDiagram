import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Schema, TablePosition, Viewport } from '../core/model/types';
import { EMPTY_SCHEMA } from '../core/model/types';
import type { ParseError, ParseResult } from '../core/parse/parseDbml';
import { reconcilePositions } from '../core/model/reconcile';
import { placeNewTables } from '../core/layout/placement';

export interface DiagramRecord {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
  updatedAt: number;
}

interface AppState {
  diagramId: string | null;
  diagramName: string;
  source: string;
  schema: Schema;
  errors: ParseError[];
  stale: boolean;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
  hoveredTableId: string | null;
  storageUnavailable: boolean;
  setSource(source: string): void;
  applyParse(result: ParseResult): void;
  moveTable(id: string, pos: TablePosition): void;
  setViewport(v: Viewport): void;
  setHoveredTable(id: string | null): void;
  setDiagramName(name: string): void;
  setStorageUnavailable(v: boolean): void;
  loadDiagram(rec: DiagramRecord): void;
}

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    diagramId: null,
    diagramName: 'Untitled',
    source: '',
    schema: EMPTY_SCHEMA,
    errors: [],
    stale: false,
    positions: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null,
    storageUnavailable: false,

    setSource: (source) => set({ source }),

    applyParse: (result) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      set({ schema: result.schema, positions: { ...kept, ...placed }, errors: [], stale: false });
    },

    moveTable: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),
    setViewport: (viewport) => set({ viewport }),
    setHoveredTable: (hoveredTableId) => set({ hoveredTableId }),
    setDiagramName: (diagramName) => set({ diagramName }),
    setStorageUnavailable: (storageUnavailable) => set({ storageUnavailable }),

    loadDiagram: (rec) =>
      set({
        diagramId: rec.id,
        diagramName: rec.name,
        source: rec.dbml,
        positions: rec.positions,
        viewport: rec.viewport,
        schema: EMPTY_SCHEMA,
        errors: [],
        stale: true, // until the parse pipeline catches up
        hoveredTableId: null,
      }),
  })),
);
