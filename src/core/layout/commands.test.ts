import { describe, it, expect } from 'vitest';
import {
  createCommandStack, pruneZeroDeltas, isNoopCommand, applyDeltas,
  type CanvasCommand,
} from './commands';

const move = (id: string, x: number): CanvasCommand => ({
  label: 'move table',
  tables: [{ id, before: { x: 0, y: 0 }, after: { x, y: 0 } }],
  notes: [],
});

describe('pruneZeroDeltas / isNoopCommand', () => {
  it('drops entries whose before equals after', () => {
    const cmd: CanvasCommand = {
      label: 'move tables',
      tables: [
        { id: 'a', before: { x: 1, y: 2 }, after: { x: 1, y: 2 } },
        { id: 'b', before: { x: 1, y: 2 }, after: { x: 9, y: 2 } },
      ],
      notes: [{ id: 'n', before: { x: 5, y: 5 }, after: { x: 5, y: 5 } }],
    };
    const pruned = pruneZeroDeltas(cmd);
    expect(pruned.tables.map((d) => d.id)).toEqual(['b']);
    expect(pruned.notes).toEqual([]);
    expect(isNoopCommand(pruned)).toBe(false);
    expect(isNoopCommand(pruneZeroDeltas({ label: 'x', tables: cmd.notes, notes: [] }))).toBe(true);
  });
});

describe('applyDeltas', () => {
  it('applies the chosen side and returns the same object for empty deltas', () => {
    const pos = { a: { x: 0, y: 0 } };
    expect(applyDeltas(pos, [], 'after')).toBe(pos);
    const out = applyDeltas(pos, [{ id: 'a', before: { x: 0, y: 0 }, after: { x: 7, y: 8 } }], 'after');
    expect(out.a).toEqual({ x: 7, y: 8 });
    expect(pos.a).toEqual({ x: 0, y: 0 }); // input not mutated
    const back = applyDeltas(out, [{ id: 'a', before: { x: 0, y: 0 }, after: { x: 7, y: 8 } }], 'before');
    expect(back.a).toEqual({ x: 0, y: 0 });
  });
});

describe('createCommandStack', () => {
  it('undo/redo round-trips in LIFO order', () => {
    const s = createCommandStack();
    s.push(move('a', 10));
    s.push(move('a', 20));
    expect(s.canUndo()).toBe(true);
    expect(s.undo()?.tables[0].after.x).toBe(20);
    expect(s.undo()?.tables[0].after.x).toBe(10);
    expect(s.undo()).toBeNull();
    expect(s.redo()?.tables[0].after.x).toBe(10);
    expect(s.redo()?.tables[0].after.x).toBe(20);
    expect(s.redo()).toBeNull();
  });
  it('push clears the redo stack', () => {
    const s = createCommandStack();
    s.push(move('a', 10));
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.push(move('a', 30));
    expect(s.canRedo()).toBe(false);
  });
  it('caps history at the limit, dropping the oldest', () => {
    const s = createCommandStack(2);
    s.push(move('a', 1));
    s.push(move('a', 2));
    s.push(move('a', 3));
    expect(s.undo()?.tables[0].after.x).toBe(3);
    expect(s.undo()?.tables[0].after.x).toBe(2);
    expect(s.undo()).toBeNull();
  });
  it('clear empties both stacks', () => {
    const s = createCommandStack();
    s.push(move('a', 1));
    s.undo();
    s.clear();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });
});
