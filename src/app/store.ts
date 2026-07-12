import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Schema, TablePosition, Viewport } from '../core/model/types';
import { EMPTY_SCHEMA } from '../core/model/types';
import type { ParseError, ParseResult } from '../core/parse/parseDbml';
import type { PersistedDiagram } from '../core/persist/repository';
import { reconcilePositions } from '../core/model/reconcile';
import { placeNewTables, placeNewNotes } from '../core/layout/placement';
import { getTableRect } from '../core/model/geometry';
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

// A command may carry deltas for a table/note that a later (or mid-gesture)
// parse deleted; applying such a delta would resurrect a dead position key
// (autosaved until the next clean parse prunes it). Keep only ids still
// tracked in the current position maps. For tables this matches "still
// exists in the schema": reconcilePositions() prunes `positions` to the live
// schema on every successful parse, so a deleted table's key is already gone
// here. Notes get the analogous prune-then-place pass in applyParse (keyed
// by note name — no rename heuristic by design), so notePositions membership
// is likewise equivalent to schema.notes membership after every successful
// parse; the notePositions map is still what's checked here, it's just kept
// in sync with the schema by that pass rather than by this filter.
// Used by BOTH the commit path (a parse can land mid-drag: single,
// multi-select, or group) and the undo/redo replay path.
// Redo-after-recreate semantics are deliberate: the stack retains dead deltas rather
// than pruning them on delete, and this filter re-admits revived ids, so an old undo
// entry can end up moving a re-created same-id table — do not "fix" without a design decision.
function filterToLive(
  s: Pick<AppState, 'positions' | 'notePositions'>,
  cmd: CanvasCommand,
): CanvasCommand {
  return {
    ...cmd,
    tables: cmd.tables.filter((d) => Object.hasOwn(s.positions, d.id)),
    notes: cmd.notes.filter((d) => Object.hasOwn(s.notePositions, d.id)),
  };
}

function applyCommandSide(
  s: Pick<AppState, 'positions' | 'notePositions'>,
  cmd: CanvasCommand,
  key: 'before' | 'after',
): Pick<AppState, 'positions' | 'notePositions'> {
  const live = filterToLive(s, cmd);
  return {
    positions: applyDeltas(s.positions, live.tables, key),
    notePositions: applyDeltas(s.notePositions, live.notes, key),
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
  selectedTableIds: string[];
  setSource(source: string): void;
  applyParse(result: ParseResult, source: string): void;
  moveTable(id: string, pos: TablePosition): void;
  setViewport(v: Viewport): void;
  setHoveredTable(id: string | null): void;
  setEditorFocusTable(editorFocusTableId: string | null): void;
  setDiagramName(name: string): void;
  setStorageUnavailable(v: boolean): void;
  setSelectedTables(ids: string[]): void;
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
    selectedTableIds: [],

    setSource: (source) => set({ source }),

    applyParse: (result, source) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions, notePositions, selectedTableIds } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      const nextPositions = { ...kept, ...placed };
      const keptNotes: Record<string, TablePosition> = {};
      for (const n of result.schema.notes) {
        if (Object.hasOwn(notePositions, n.id)) keptNotes[n.id] = notePositions[n.id];
      }
      const occupied = result.schema.tables
        .filter((t) => nextPositions[t.id])
        .map((t) => getTableRect(t, nextPositions[t.id]));
      const placedNotes = placeNewNotes(result.schema, keptNotes, occupied);
      const tableIds = new Set(result.schema.tables.map((t) => t.id));
      set({
        schema: result.schema,
        positions: nextPositions,
        notePositions: { ...keptNotes, ...placedNotes },
        selectedTableIds: selectedTableIds.filter((id) => tableIds.has(id)),
        errors: [],
        stale: false,
        parsedSource: source,
      });
    },

    moveTable: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),

    commitCanvasCommand: (raw) => {
      // filterToLive first: a parse landing mid-gesture can prune a member's
      // position; committing its delta anyway would resurrect the dead key.
      // An all-pruned command falls through to the no-op guard below.
      const cmd = pruneZeroDeltas(filterToLive(get(), raw));
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
    setSelectedTables: (selectedTableIds) => set({ selectedTableIds }),

    loadDiagram: (rec) => {
      resetCanvasStack();
      set({
        diagramId: rec.id,
        diagramName: rec.name,
        source: rec.dbml,
        positions: rec.positions,
        notePositions: rec.notePositions ?? {},
        viewport: rec.viewport,
        schema: EMPTY_SCHEMA,
        errors: [],
        stale: true, // until the parse pipeline catches up
        parsedSource: null,
        hoveredTableId: null,
        editorFocusTableId: null,
        selectedTableIds: [],
      });
    },
  })),
);
