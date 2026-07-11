import type { TablePosition } from '../model/types';

export interface PositionDelta {
  id: string;
  before: TablePosition;
  after: TablePosition;
}

export interface CanvasCommand {
  label: string;
  tables: PositionDelta[];
  notes: PositionDelta[];
}

const changed = (d: PositionDelta) => d.before.x !== d.after.x || d.before.y !== d.after.y;

/** Drop entries that do not actually move anything. THE zero-delta guard:
 *  every canvas commit funnels through this, so click / double-click gestures
 *  can never pollute undo history with no-op commands. */
export function pruneZeroDeltas(cmd: CanvasCommand): CanvasCommand {
  return { ...cmd, tables: cmd.tables.filter(changed), notes: cmd.notes.filter(changed) };
}

export function isNoopCommand(cmd: CanvasCommand): boolean {
  return cmd.tables.length === 0 && cmd.notes.length === 0;
}

export function applyDeltas(
  positions: Record<string, TablePosition>,
  deltas: PositionDelta[],
  key: 'before' | 'after',
): Record<string, TablePosition> {
  if (deltas.length === 0) return positions;
  const out = { ...positions };
  for (const d of deltas) out[d.id] = d[key];
  return out;
}

export interface CommandStack {
  push(cmd: CanvasCommand): void;
  undo(): CanvasCommand | null;
  redo(): CanvasCommand | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createCommandStack(limit = 100): CommandStack {
  const undoStack: CanvasCommand[] = [];
  const redoStack: CanvasCommand[] = [];
  return {
    push(cmd) {
      undoStack.push(cmd);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    undo() {
      const cmd = undoStack.pop();
      if (!cmd) return null;
      redoStack.push(cmd);
      return cmd;
    },
    redo() {
      const cmd = redoStack.pop();
      if (!cmd) return null;
      undoStack.push(cmd);
      return cmd;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}
