import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, getCanvasStack, resetCanvasStack } from './store';
import { parseDbml } from '../core/parse/parseDbml';
import { EMPTY_SCHEMA } from '../core/model/types';

const reset = () => {
  resetCanvasStack();
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false, editorFocusTableId: null,
    parsedSource: null, notePositions: {}, selectedTableIds: [],
  });
};

describe('useAppStore', () => {
  beforeEach(reset);

  it('applyParse success places new tables and clears stale', () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    const st = useAppStore.getState();
    expect(st.schema.tables).toHaveLength(2);
    expect(st.positions['public.a']).toBeDefined();
    expect(st.positions['public.b']).toBeDefined();
    expect(st.stale).toBe(false);
    expect(st.errors).toEqual([]);
  });

  it('applyParse failure keeps last good schema and sets stale', () => {
    const good = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(good), good);
    const goodSchema = useAppStore.getState().schema;
    useAppStore.getState().applyParse(parseDbml('Table a {'), 'Table a {');
    const st = useAppStore.getState();
    expect(st.schema).toBe(goodSchema);
    expect(st.stale).toBe(true);
    expect(st.errors.length).toBeGreaterThan(0);
  });

  it('keeps a moved table where the user put it across edits', () => {
    const src1 = 'Table a { id int }';
    const src2 = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src1), src1);
    useAppStore.getState().moveTable('public.a', { x: 777, y: 333 });
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 777, y: 333 });
  });

  it('prunes positions of deleted tables', () => {
    const src1 = 'Table a { id int }\nTable b { id int }';
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src1), src1);
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().positions['public.b']).toBeUndefined();
  });

  it('loadDiagram replaces content and marks stale until reparse', () => {
    useAppStore.getState().loadDiagram({
      id: 'd1', name: 'Shop', dbml: 'Table x { id int }',
      positions: { 'public.x': { x: 5, y: 6 } }, viewport: { x: 1, y: 2, zoom: 1.5 }, updatedAt: 123,
    });
    const st = useAppStore.getState();
    expect(st.diagramId).toBe('d1');
    expect(st.source).toBe('Table x { id int }');
    expect(st.positions['public.x']).toEqual({ x: 5, y: 6 });
    expect(st.stale).toBe(true);
  });
});

describe('parsedSource', () => {
  beforeEach(reset);
  it('records the source of a successful parse', () => {
    const src = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    expect(useAppStore.getState().parsedSource).toBe(src);
  });
  it('a failed parse keeps the previous parsedSource', () => {
    const good = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(good), good);
    useAppStore.getState().applyParse(parseDbml('Table a {'), 'Table a {');
    expect(useAppStore.getState().parsedSource).toBe(good);
  });
  it('loadDiagram resets parsedSource', () => {
    const src = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().loadDiagram({
      id: 'd2', name: 'X', dbml: 'Table x { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().parsedSource).toBeNull();
  });
});

describe('editor focus table', () => {
  beforeEach(reset);
  it('sets and clears the focused table', () => {
    useAppStore.getState().setEditorFocusTable('public.users');
    expect(useAppStore.getState().editorFocusTableId).toBe('public.users');
    useAppStore.getState().setEditorFocusTable(null);
    expect(useAppStore.getState().editorFocusTableId).toBeNull();
  });
  it('loadDiagram clears the focused table', () => {
    useAppStore.getState().setEditorFocusTable('public.users');
    useAppStore.getState().loadDiagram({
      id: 'd9', name: 'X', dbml: 'Table x { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().editorFocusTableId).toBeNull();
  });
});

describe('canvas command stack', () => {
  beforeEach(reset);
  const seed = () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
  };

  it('commit applies after-positions and undo/redo round-trips', () => {
    seed();
    const before = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.a', before, after: { x: 900, y: 40 } }],
      notes: [],
    });
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 900, y: 40 });
    useAppStore.getState().undoCanvas();
    expect(useAppStore.getState().positions['public.a']).toEqual(before);
    useAppStore.getState().redoCanvas();
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 900, y: 40 });
  });

  it('zero-delta commit is dropped — no state change, no undo entry', () => {
    seed();
    const st = useAppStore.getState();
    const positionsBefore = st.positions;
    const pos = st.positions['public.a'];
    st.commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.a', before: pos, after: { ...pos } }],
      notes: [],
    });
    expect(useAppStore.getState().positions).toBe(positionsBefore); // not even a new object
    expect(getCanvasStack().canUndo()).toBe(false);
  });

  it('a multi-entry command undoes atomically (tables and notes together)', () => {
    seed();
    useAppStore.setState({ notePositions: { todo: { x: 10, y: 10 } } });
    const a = useAppStore.getState().positions['public.a'];
    const b = useAppStore.getState().positions['public.b'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move tables',
      tables: [
        { id: 'public.a', before: a, after: { x: a.x + 50, y: a.y } },
        { id: 'public.b', before: b, after: { x: b.x + 50, y: b.y } },
      ],
      notes: [{ id: 'todo', before: { x: 10, y: 10 }, after: { x: 60, y: 10 } }],
    });
    useAppStore.getState().undoCanvas();
    const st = useAppStore.getState();
    expect(st.positions['public.a']).toEqual(a);
    expect(st.positions['public.b']).toEqual(b);
    expect(st.notePositions.todo).toEqual({ x: 10, y: 10 });
  });

  it('commit after a mid-gesture parse prune drops the pruned member, keeps survivors', () => {
    seed();
    const a = useAppStore.getState().positions['public.a'];
    const b = useAppStore.getState().positions['public.b'];
    // Parse lands mid-drag: table b deleted, reconcilePositions pruned its key.
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    // Gesture end still commits deltas for the whole moving set, b included.
    useAppStore.getState().commitCanvasCommand({
      label: 'move group',
      tables: [
        { id: 'public.a', before: a, after: { x: a.x + 50, y: a.y + 50 } },
        { id: 'public.b', before: b, after: { x: b.x + 50, y: b.y + 50 } },
      ],
      notes: [],
    });
    const st = useAppStore.getState();
    expect(st.positions['public.b']).toBeUndefined(); // no phantom key resurrected
    expect(st.positions['public.a']).toEqual({ x: a.x + 50, y: a.y + 50 });
    useAppStore.getState().undoCanvas(); // survivors still round-trip
    expect(useAppStore.getState().positions['public.a']).toEqual(a);
    expect(useAppStore.getState().positions['public.b']).toBeUndefined();
  });

  it('undo after a later edit deleted the table does not resurrect its position', () => {
    seed();
    const b = useAppStore.getState().positions['public.b'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.b', before: b, after: { x: 700, y: 700 } }],
      notes: [],
    });
    const src2 = 'Table a { id int }'; // table b deleted by a later edit
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    useAppStore.getState().undoCanvas(); // consumes the entry; must not crash or re-insert public.b
    expect(useAppStore.getState().positions['public.b']).toBeUndefined();
  });

  it('a new command clears redo', () => {
    seed();
    const a = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table', tables: [{ id: 'public.a', before: a, after: { x: 1, y: 1 } }], notes: [],
    });
    useAppStore.getState().undoCanvas();
    useAppStore.getState().commitCanvasCommand({
      label: 'move table', tables: [{ id: 'public.a', before: a, after: { x: 2, y: 2 } }], notes: [],
    });
    expect(getCanvasStack().canRedo()).toBe(false);
  });

  it('loadDiagram starts a fresh stack', () => {
    seed();
    const a = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table', tables: [{ id: 'public.a', before: a, after: { x: 5, y: 5 } }], notes: [],
    });
    useAppStore.getState().loadDiagram({
      id: 'd3', name: 'Y', dbml: 'Table y { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(getCanvasStack().canUndo()).toBe(false);
  });
});

describe('table selection', () => {
  beforeEach(reset);
  it('sets and clears the selection', () => {
    useAppStore.getState().setSelectedTables(['public.a', 'public.b']);
    expect(useAppStore.getState().selectedTableIds).toEqual(['public.a', 'public.b']);
    useAppStore.getState().setSelectedTables([]);
    expect(useAppStore.getState().selectedTableIds).toEqual([]);
  });
  it('applyParse prunes selected ids for deleted tables', () => {
    const src1 = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src1), src1);
    useAppStore.getState().setSelectedTables(['public.a', 'public.b']);
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().selectedTableIds).toEqual(['public.a']);
  });
  it('loadDiagram clears the selection', () => {
    useAppStore.getState().setSelectedTables(['public.a']);
    useAppStore.getState().loadDiagram({
      id: 'd4', name: 'Z', dbml: 'Table z { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().selectedTableIds).toEqual([]);
  });
});

describe('sticky note positions', () => {
  beforeEach(reset);
  const NOTE_SRC = "Table a { id int }\nNote todo {\n  'hello'\n}";

  it('applyParse places new notes and keeps them across edits', () => {
    useAppStore.getState().applyParse(parseDbml(NOTE_SRC), NOTE_SRC);
    const placed = useAppStore.getState().notePositions.todo;
    expect(placed).toBeDefined();
    useAppStore.setState({ notePositions: { todo: { x: 555, y: 444 } } });
    const src2 = NOTE_SRC + '\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().notePositions.todo).toEqual({ x: 555, y: 444 });
  });

  it('applyParse prunes positions of deleted notes', () => {
    useAppStore.getState().applyParse(parseDbml(NOTE_SRC), NOTE_SRC);
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().notePositions.todo).toBeUndefined();
  });

  it('note moves commit through the command stack and undo', () => {
    useAppStore.getState().applyParse(parseDbml(NOTE_SRC), NOTE_SRC);
    const before = useAppStore.getState().notePositions.todo;
    useAppStore.getState().commitCanvasCommand({
      label: 'move note', tables: [], notes: [{ id: 'todo', before, after: { x: 9, y: 9 } }],
    });
    expect(useAppStore.getState().notePositions.todo).toEqual({ x: 9, y: 9 });
    useAppStore.getState().undoCanvas();
    expect(useAppStore.getState().notePositions.todo).toEqual(before);
  });

  it('loadDiagram restores notePositions (defaulting to empty)', () => {
    useAppStore.getState().loadDiagram({
      id: 'd5', name: 'N', dbml: NOTE_SRC,
      positions: {}, notePositions: { todo: { x: 7, y: 8 } },
      viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().notePositions).toEqual({ todo: { x: 7, y: 8 } });
    useAppStore.getState().loadDiagram({
      id: 'd6', name: 'O', dbml: 'Table x { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().notePositions).toEqual({});
  });
});
