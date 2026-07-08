import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';
import { parseDbml } from '../core/parse/parseDbml';
import { EMPTY_SCHEMA } from '../core/model/types';

const reset = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false, editorFocusTableId: null,
  });

describe('useAppStore', () => {
  beforeEach(reset);

  it('applyParse success places new tables and clears stale', () => {
    const s = useAppStore.getState();
    s.applyParse(parseDbml('Table a { id int }\nTable b { id int }'));
    const st = useAppStore.getState();
    expect(st.schema.tables).toHaveLength(2);
    expect(st.positions['public.a']).toBeDefined();
    expect(st.positions['public.b']).toBeDefined();
    expect(st.stale).toBe(false);
    expect(st.errors).toEqual([]);
  });

  it('applyParse failure keeps last good schema and sets stale', () => {
    useAppStore.getState().applyParse(parseDbml('Table a { id int }'));
    const goodSchema = useAppStore.getState().schema;
    useAppStore.getState().applyParse(parseDbml('Table a {'));
    const st = useAppStore.getState();
    expect(st.schema).toBe(goodSchema);
    expect(st.stale).toBe(true);
    expect(st.errors.length).toBeGreaterThan(0);
  });

  it('keeps a moved table where the user put it across edits', () => {
    useAppStore.getState().applyParse(parseDbml('Table a { id int }'));
    useAppStore.getState().moveTable('public.a', { x: 777, y: 333 });
    useAppStore.getState().applyParse(parseDbml('Table a { id int }\nTable b { id int }'));
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 777, y: 333 });
  });

  it('prunes positions of deleted tables', () => {
    useAppStore.getState().applyParse(parseDbml('Table a { id int }\nTable b { id int }'));
    useAppStore.getState().applyParse(parseDbml('Table a { id int }'));
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
