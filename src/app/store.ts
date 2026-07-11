import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Schema, TablePosition, Viewport } from '../core/model/types';
import { EMPTY_SCHEMA } from '../core/model/types';
import type { ParseError, ParseResult } from '../core/parse/parseDbml';
import type { PersistedDiagram } from '../core/persist/repository';
import { reconcilePositions } from '../core/model/reconcile';
import { placeNewTables } from '../core/layout/placement';
import {
  applyDeltas, createCommandStack, isNoopCommand, pruneZeroDeltas,
  type CanvasCommand, type CommandStack,
} from '../core/layout/commands';

export type DiagramRecord = PersistedDiagram;

// Module-level, deliberately NOT zustand state: the command stack is not
// render state — nothing subscribes to it, and mutating an object held
// inside state in place would never notify subscribers anyway.
let canvasStack = createCommandStack();
export const getCanvasStack = (): CommandStack => canvasStack;
export function resetCanvasStack(): void {
  canvasStack = createCommandStack();
}

// Undo/redo may replay a command whose table/note a later edit deleted;
// applying that delta would resurrect a dead position key (autosaved until
// the next clean parse prunes it). Apply only ids still tracked in the
// current position maps. For tables this matches "still exists in the
// schema": reconcilePositions() prunes `positions` to the live schema on
// every successful parse, so a deleted table's key is already gone here.
// Notes have no schema-backed existence yet (sticky-note parsing lands in a
// later Plan 3 task — parseDbml's normalizer always emits `notes: []`), so
// the notePositions map itself is the only source of truth available now.
function applyCommandSide(
  s: Pick<AppState, 'positions' | 'notePositions'>,
  cmd: CanvasCommand,
  key: 'before' | 'after',
): Pick<AppState, 'positions' | 'notePositions'> {
  return {
    positions: applyDeltas(s.positions, cmd.tables.filter((d) => d.id in s.positions), key),
    notePositions: applyDeltas(s.notePositions, cmd.notes.filter((d) => d.id in s.notePositions), key),
  };
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
  editorFocusTableId: string | null;
  storageUnavailable: boolean;
  parsedSource: string | null;
  notePositions: Record<string, TablePosition>;
  setSource(source: string): void;
  applyParse(result: ParseResult, source: string): void;
  moveTable(id: string, pos: TablePosition): void;
  setViewport(v: Viewport): void;
  setHoveredTable(id: string | null): void;
  setEditorFocusTable(editorFocusTableId: string | null): void;
  setDiagramName(name: string): void;
  setStorageUnavailable(v: boolean): void;
  loadDiagram(rec: DiagramRecord): void;
  commitCanvasCommand(cmd: CanvasCommand): void;
  undoCanvas(): void;
  redoCanvas(): void;
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
    editorFocusTableId: null,
    storageUnavailable: false,
    parsedSource: null,
    notePositions: {},

    setSource: (source) => set({ source }),

    applyParse: (result, source) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      set({
        schema: result.schema,
        positions: { ...kept, ...placed },
        errors: [],
        stale: false,
        parsedSource: source,
      });
    },

    moveTable: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),

    commitCanvasCommand: (raw) => {
      const cmd = pruneZeroDeltas(raw);
      if (isNoopCommand(cmd)) return; // zero-delta guard: no state change, no history entry
      canvasStack.push(cmd);
      set((s) => ({
        positions: applyDeltas(s.positions, cmd.tables, 'after'),
        notePositions: applyDeltas(s.notePositions, cmd.notes, 'after'),
      }));
    },

    undoCanvas: () => {
      const cmd = canvasStack.undo();
      if (!cmd) return;
      set((s) => applyCommandSide(s, cmd, 'before'));
    },

    redoCanvas: () => {
      const cmd = canvasStack.redo();
      if (!cmd) return;
      set((s) => applyCommandSide(s, cmd, 'after'));
    },

    setViewport: (viewport) => set({ viewport }),
    setHoveredTable: (hoveredTableId) => set({ hoveredTableId }),
    setEditorFocusTable: (editorFocusTableId) => set({ editorFocusTableId }),
    setDiagramName: (diagramName) => set({ diagramName }),
    setStorageUnavailable: (storageUnavailable) => set({ storageUnavailable }),

    loadDiagram: (rec) => {
      resetCanvasStack();
      set({
        diagramId: rec.id,
        diagramName: rec.name,
        source: rec.dbml,
        positions: rec.positions,
        notePositions: {},
        viewport: rec.viewport,
        schema: EMPTY_SCHEMA,
        errors: [],
        stale: true, // until the parse pipeline catches up
        parsedSource: null,
        hoveredTableId: null,
        editorFocusTableId: null,
      });
    },
  })),
);
