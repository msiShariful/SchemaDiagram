import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Schema, TablePosition, Viewport } from '../core/model/types';
import { EMPTY_SCHEMA } from '../core/model/types';
import type { ParseError, ParseResult } from '../core/parse/parseDbml';
import type { PersistedDiagram } from '../core/persist/repository';
import type { LodOverride } from '../canvas/lod';
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
  hiddenTableIds: string[]; // view state: tables hidden from the canvas (Feature D) — layout-side, never DBML
  diagramCreatedAt: number | null; // mirrors PersistedDiagram.createdAt so autosave round-trips it
  snapEnabled: boolean; // session-only (not persisted): drag snap on/off (Feature E)
  lodOverride: LodOverride; // session-only (not persisted): detail dropdown (Feature E)
  traceEnabled: boolean; // session-only: highlight/trace mode toggle (Feature C)
  highlightTableId: string | null; // session-only: the traced table; cleared on diagram switch, pruned on parse
  collapsedGroupIds: string[]; // view state: collapsed table groups — persisted like hiddenTableIds, never DBML
  canvasStackVersion: number; // change counter for the module-level command stack (toolbar undo/redo buttons subscribe to this, never to the stack itself)
  setSource(source: string): void;
  applyParse(result: ParseResult, source: string): void;
  setViewport(v: Viewport): void;
  setHoveredTable(id: string | null): void;
  setEditorFocusTable(editorFocusTableId: string | null): void;
  setDiagramName(name: string): void;
  setStorageUnavailable(v: boolean): void;
  setSelectedTables(ids: string[]): void;
  setHiddenTables(ids: string[]): void;
  setSnapEnabled(v: boolean): void;
  setLodOverride(v: LodOverride): void;
  setTraceEnabled(v: boolean): void;
  setHighlightTable(id: string | null): void;
  setCollapsedGroups(ids: string[]): void;
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
    hiddenTableIds: [],
    diagramCreatedAt: null,
    snapEnabled: true,
    lodOverride: 'auto',
    traceEnabled: false,
    highlightTableId: null,
    collapsedGroupIds: [],
    canvasStackVersion: 0,

    setSource: (source) => set({ source }),

    applyParse: (result, source) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions, notePositions, selectedTableIds, hiddenTableIds, collapsedGroupIds, highlightTableId } = get();
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
        hiddenTableIds: hiddenTableIds.filter((id) => tableIds.has(id)),
        collapsedGroupIds: (() => {
          const groupIds = new Set(result.schema.groups.map((g) => g.id));
          return collapsedGroupIds.filter((id) => groupIds.has(id));
        })(),
        highlightTableId: highlightTableId !== null && tableIds.has(highlightTableId) ? highlightTableId : null,
        errors: [],
        stale: false,
        parsedSource: source,
      });
    },

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
        canvasStackVersion: s.canvasStackVersion + 1, // rides the existing gesture-end set()
      }));
    },

    undoCanvas: () => {
      const cmd = canvasStack.undo();
      if (!cmd) return;
      set((s) => ({ ...applyCommandSide(s, cmd, 'before'), canvasStackVersion: s.canvasStackVersion + 1 }));
    },

    redoCanvas: () => {
      const cmd = canvasStack.redo();
      if (!cmd) return;
      set((s) => ({ ...applyCommandSide(s, cmd, 'after'), canvasStackVersion: s.canvasStackVersion + 1 }));
    },

    setViewport: (viewport) => set({ viewport }),
    setHoveredTable: (hoveredTableId) => set({ hoveredTableId }),
    setEditorFocusTable: (editorFocusTableId) => set({ editorFocusTableId }),
    setDiagramName: (diagramName) => set({ diagramName }),
    setStorageUnavailable: (storageUnavailable) => set({ storageUnavailable }),
    setSelectedTables: (selectedTableIds) => set({ selectedTableIds }),
    setHiddenTables: (hiddenTableIds) =>
      set((s) => {
        // Hiding deselects: a hidden table left in the selection would be
        // silently moved by the next multi-select drag it isn't visible in.
        // (Group drags are the intentional exception — membership, not selection.)
        const hidden = new Set(hiddenTableIds);
        return {
          hiddenTableIds,
          selectedTableIds: s.selectedTableIds.filter((id) => !hidden.has(id)),
        };
      }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    setLodOverride: (lodOverride) => set({ lodOverride }),
    setTraceEnabled: (traceEnabled) =>
      set((s) => ({ traceEnabled, highlightTableId: traceEnabled ? s.highlightTableId : null })),
    setHighlightTable: (highlightTableId) => set({ highlightTableId }),
    setCollapsedGroups: (collapsedGroupIds) =>
      set((s) => {
        // Collapsing hides members ⇒ deselect them (same rationale as
        // setHiddenTables: a hidden table left selected would be silently
        // moved by the next multi-select drag). Group-header drags remain
        // the membership-based exception.
        const collapsed = new Set(collapsedGroupIds);
        const hiddenByCollapse = new Set(
          s.schema.groups.filter((g) => collapsed.has(g.id)).flatMap((g) => g.tableIds),
        );
        return {
          collapsedGroupIds,
          selectedTableIds: s.selectedTableIds.filter((id) => !hiddenByCollapse.has(id)),
        };
      }),

    loadDiagram: (rec) => {
      resetCanvasStack();
      set((s) => ({
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
        hiddenTableIds: rec.hiddenTableIds ?? [], // pre-Plan-6 records: nothing hidden
        diagramCreatedAt: rec.createdAt ?? null,
        collapsedGroupIds: rec.collapsedGroupIds ?? [], // pre-Plan-7 records: nothing collapsed
        highlightTableId: null, // it named a table of the OLD diagram
        canvasStackVersion: s.canvasStackVersion + 1, // resetCanvasStack() above emptied the stack — buttons must re-read
        // traceEnabled / snapEnabled / lodOverride deliberately untouched: session state.
      }));
    },
  })),
);
