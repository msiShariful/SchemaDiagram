import { describe, it, expect } from 'vitest';
import { buildFieldNoteSplice, quoteNoteText } from './fieldNote';
import { parseDbml } from '../core/parse/parseDbml';

const apply = (src: string, s: { from: number; to: number; insert: string }) =>
  src.slice(0, s.from) + s.insert + src.slice(s.to);

/** Round-trip: splice → real parser → assert the field's note. */
function noteAfter(src: string, tableId: string, field: string, note: string | null): string | null {
  const splice = buildFieldNoteSplice(src, tableId, field, note);
  if (splice === null) throw new Error('refused');
  const out = apply(src, splice);
  const r = parseDbml(out);
  if (!r.ok) throw new Error(`parse failed after splice: ${r.errors[0]?.message}\n${out}`);
  const t = r.schema.tables.find((x) => x.id === tableId)!;
  return t.fields.find((f) => f.name === field)!.note;
}

describe('quoteNoteText', () => {
  it('picks the unused quote and refuses unquotable text', () => {
    expect(quoteNoteText('plain')).toBe("'plain'");
    expect(quoteNoteText("it's here")).toBe('"it\'s here"');
    expect(quoteNoteText('he said "hi"')).toBe('\'he said "hi"\'');
    expect(quoteNoteText('both \' and "')).toBeNull();
    expect(quoteNoteText('two\nlines')).toBeNull();
    expect(quoteNoteText('back\\slash')).toBeNull();
  });
});

describe('buildFieldNoteSplice → real parser round-trips', () => {
  it('adds a bracket to a bare field', () => {
    expect(noteAfter('Table t {\n  id int\n}', 'public.t', 'id', 'the key')).toBe('the key');
  });

  it('adds a bracket before a trailing comment, keeping the comment', () => {
    const src = 'Table t {\n  id int // primary\n}';
    const s = buildFieldNoteSplice(src, 'public.t', 'id', 'k')!;
    const out = apply(src, s);
    expect(out).toContain('// primary');
    expect(noteAfter(src, 'public.t', 'id', 'k')).toBe('k');
  });

  it('appends into an existing settings bracket', () => {
    expect(noteAfter('Table t {\n  id int [pk, not null]\n}', 'public.t', 'id', 'x')).toBe('x');
  });

  it('replaces an existing note wherever it sits', () => {
    expect(noteAfter("Table t {\n  id int [note: 'old', pk]\n}", 'public.t', 'id', 'new')).toBe('new');
    expect(noteAfter("Table t {\n  id int [pk, note: 'old']\n}", 'public.t', 'id', 'new')).toBe('new');
    expect(noteAfter("Table t {\n  id int [note: 'old']\n}", 'public.t', 'id', 'new')).toBe('new');
  });

  it("never matches the word note INSIDE a string value ('note' in another setting)", () => {
    const src = "Table t {\n  id varchar [default: 'note: fake', pk]\n}";
    expect(noteAfter(src, 'public.t', 'id', 'real')).toBe('real');
    const r = parseDbml(apply(src, buildFieldNoteSplice(src, 'public.t', 'id', 'real')!));
    if (!r.ok) throw new Error('parse failed');
    expect(r.schema.tables[0].fields[0].defaultValue).toBe('note: fake');
  });

  it('quoted field names with spaces', () => {
    expect(noteAfter('Table t {\n  "field one" int\n}', 'public.t', 'field one', 'n')).toBe('n');
  });

  it('quoted note values containing the other quote', () => {
    expect(noteAfter('Table t {\n  id int\n}', 'public.t', 'id', "it's fine")).toBe("it's fine");
  });

  it('removes: only setting drops the whole bracket; first/last keep the rest', () => {
    const only = "Table t {\n  id int [note: 'x']\n}";
    const sOnly = buildFieldNoteSplice(only, 'public.t', 'id', null)!;
    expect(apply(only, sOnly)).toBe('Table t {\n  id int\n}');

    const first = "Table t {\n  id int [note: 'x', pk]\n}";
    const outFirst = apply(first, buildFieldNoteSplice(first, 'public.t', 'id', null)!);
    const rFirst = parseDbml(outFirst);
    if (!rFirst.ok) throw new Error(outFirst);
    expect(rFirst.schema.tables[0].fields[0].pk).toBe(true);
    expect(rFirst.schema.tables[0].fields[0].note).toBeNull();

    const last = "Table t {\n  id int [pk, note: 'x']\n}";
    const outLast = apply(last, buildFieldNoteSplice(last, 'public.t', 'id', null)!);
    const rLast = parseDbml(outLast);
    if (!rLast.ok) throw new Error(outLast);
    expect(rLast.schema.tables[0].fields[0].pk).toBe(true);
    expect(rLast.schema.tables[0].fields[0].note).toBeNull();
  });

  it('removing a nonexistent note is a no-op splice', () => {
    const src = 'Table t {\n  id int [pk]\n}';
    const s = buildFieldNoteSplice(src, 'public.t', 'id', null)!;
    expect(apply(src, s)).toBe(src);
  });

  it('ignores lines inside an indexes block and matches only depth-1 fields', () => {
    const src = 'Table t {\n  id int\n  indexes {\n    (id) [unique]\n  }\n}';
    expect(noteAfter(src, 'public.t', 'id', 'k')).toBe('k');
  });

  it('refuses: unknown field, unknown table, unquotable text', () => {
    const src = 'Table t {\n  id int\n}';
    expect(buildFieldNoteSplice(src, 'public.t', 'nope', 'x')).toBeNull();
    expect(buildFieldNoteSplice(src, 'public.zzz', 'id', 'x')).toBeNull();
    expect(buildFieldNoteSplice(src, 'public.t', 'id', 'both \' and "')).toBeNull();
  });

  it('alias tables resolve via buildTableRanges (tableId, not alias)', () => {
    expect(noteAfter('Table orders as O {\n  id int\n}', 'public.orders', 'id', 'n')).toBe('n');
  });
});
