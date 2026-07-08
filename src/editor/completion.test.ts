import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { detectContext, createDbmlCompletion } from './completion';
import { parseDbml } from '../core/parse/parseDbml';
import type { Schema } from '../core/model/types';

const SCHEMA_SRC = `
Table users {
  id integer [pk]
  name varchar
}
Table posts as P {
  id integer [pk]
  author_id integer
}
Enum status { active \n archived }
Ref: posts.author_id > users.id
`;
const schema: Schema = (() => {
  const r = parseDbml(SCHEMA_SRC);
  if (!r.ok) throw new Error('fixture parse failed');
  return r.schema;
})();

/** doc contains a single '|' marking the cursor */
function ctxAt(docWithCursor: string) {
  const pos = docWithCursor.indexOf('|');
  const doc = docWithCursor.replace('|', '');
  return { doc, pos };
}
function labels(docWithCursor: string, explicit = true): string[] {
  const { doc, pos } = ctxAt(docWithCursor);
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const result = createDbmlCompletion(() => schema)(new CompletionContext(state, pos, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

describe('detectContext', () => {
  it('detects settings inside brackets', () => {
    const { doc, pos } = ctxAt('Table t {\n  id integer [p|\n}');
    expect(detectContext(doc, pos).kind).toBe('settings');
  });
  it('detects table targets after Ref:', () => {
    const { doc, pos } = ctxAt('Ref: |');
    expect(detectContext(doc, pos).kind).toBe('table-target');
  });
  it('detects table targets after relation operators', () => {
    const { doc, pos } = ctxAt('Ref: posts.author_id > |');
    expect(detectContext(doc, pos).kind).toBe('table-target');
  });
  it('detects column-of-table after a dot', () => {
    const { doc, pos } = ctxAt('Ref: posts.|');
    const c = detectContext(doc, pos);
    expect(c.kind).toBe('column-of-table');
    expect(c.tableName).toBe('posts');
  });
  it('detects field-type at the second token of a table-body line', () => {
    const { doc, pos } = ctxAt('Table t {\n  title va|\n}');
    expect(detectContext(doc, pos).kind).toBe('field-type');
  });
  it('detects table-body on an empty line inside a table', () => {
    const { doc, pos } = ctxAt('Table t {\n  |\n}');
    expect(detectContext(doc, pos).kind).toBe('table-body');
  });
  it('detects top-level outside blocks', () => {
    const { doc, pos } = ctxAt('Table t {\n  id int\n}\n|');
    expect(detectContext(doc, pos).kind).toBe('top-level');
  });
  it('detects table targets inside TableGroup bodies', () => {
    const { doc, pos } = ctxAt('TableGroup core {\n  |\n}');
    expect(detectContext(doc, pos).kind).toBe('table-target');
  });
  it('returns none in the field-name position', () => {
    const { doc, pos } = ctxAt('Table t {\n  ti|\n}');
    expect(detectContext(doc, pos).kind).toBe('none');
  });
});

describe('createDbmlCompletion', () => {
  it('offers setting keywords inside brackets', () => {
    const ls = labels('Table t {\n  id integer [|]\n}');
    expect(ls).toContain('pk');
    expect(ls).toContain('not null');
    expect(ls).toContain('increment');
  });
  it('offers table names (and aliases) after Ref:', () => {
    const ls = labels('Ref: |');
    expect(ls).toContain('users');
    expect(ls).toContain('posts');
    expect(ls).toContain('P');
  });
  it('offers columns after table-dot, resolving aliases', () => {
    expect(labels('Ref: posts.|')).toEqual(expect.arrayContaining(['id', 'author_id']));
    expect(labels('Ref: P.|')).toEqual(expect.arrayContaining(['id', 'author_id']));
    expect(labels('Ref: users.|')).toEqual(expect.arrayContaining(['id', 'name']));
  });
  it('offers column types plus enum names in the type position', () => {
    const ls = labels('Table t {\n  col |\n}');
    expect(ls).toContain('varchar');
    expect(ls).toContain('timestamp');
    expect(ls).toContain('status'); // enum
  });
  it('offers block snippets at top level', () => {
    const ls = labels('|');
    expect(ls).toEqual(expect.arrayContaining(['Table', 'Ref', 'Enum', 'TableGroup']));
  });
  it('offers indexes/Note snippets in a table body', () => {
    const ls = labels('Table t {\n  |\n}');
    expect(ls).toEqual(expect.arrayContaining(['indexes', 'Note']));
  });
  it('returns nothing in the field-name position when not explicit', () => {
    expect(labels('Table t {\n  ti|\n}', false)).toEqual([]);
  });
});
