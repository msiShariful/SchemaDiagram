import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';
import { parseDbml } from '../core/parse/parseDbml';
import { EMPTY_SCHEMA } from '../core/model/types';

const reset = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false, editorFocusTableId: null,
    parsedSource: null,
  });

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
