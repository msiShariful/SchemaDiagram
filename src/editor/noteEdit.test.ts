import { describe, it, expect } from 'vitest';
import { buildTableNoteSplice, buildStickyNoteSplice, buildNewNoteBlock, quoteBlockText } from './noteEdit';
import { parseDbml } from '../core/parse/parseDbml';

const apply = (src: string, s: { from: number; to: number; insert: string }) =>
  src.slice(0, s.from) + s.insert + src.slice(s.to);

function tableNoteAfter(src: string, tableId: string, note: string | null): string | null {
  const splice = buildTableNoteSplice(src, tableId, note);
  if (splice === null) throw new Error('refused');
  const out = apply(src, splice);
  const r = parseDbml(out);
  if (!r.ok) throw new Error(`parse failed: ${r.errors[0]?.message}\n${out}`);
  return r.schema.tables.find((t) => t.id === tableId)!.note;
}

function stickyAfter(src: string, name: string, content: string): string {
  const splice = buildStickyNoteSplice(src, name, content);
  if (splice === null) throw new Error('refused');
  const out = apply(src, splice);
  const r = parseDbml(out);
  if (!r.ok) throw new Error(`parse failed: ${r.errors[0]?.message}\n${out}`);
  return r.schema.notes.find((n) => n.name === name)!.content;
}

describe('quoteBlockText', () => {
  it('single/double/triple by content; refuses backslash and embedded triple-quote', () => {
    expect(quoteBlockText('plain')).toBe("'plain'");
    expect(quoteBlockText("it's")).toBe('"it\'s"');
    expect(quoteBlockText('a\nb')).toBe("'''a\nb'''");
    expect(quoteBlockText('mix \' and "')).toBe('\'\'\'mix \' and "\'\'\'');
    expect(quoteBlockText("has ''' inside")).toBe('"has \'\'\' inside"'); // single-line: double quotes carry it
    expect(quoteBlockText("multi\nline with ''' inside")).toBeNull(); // would need the ''' wrapper it contains
    expect(quoteBlockText('back\\slash')).toBeNull();
  });
});

describe('buildTableNoteSplice → real parser', () => {
  it('adds a body Note line to a table without one', () => {
    expect(tableNoteAfter('Table t {\n  id int\n}', 'public.t', 'orders live here')).toBe('orders live here');
  });

  it('replaces an existing single-line and triple-quoted note', () => {
    expect(tableNoteAfter("Table t {\n  id int\n  Note: 'old'\n}", 'public.t', 'new')).toBe('new');
    expect(tableNoteAfter("Table t {\n  id int\n  Note: '''old\nlines'''\n}", 'public.t', 'new')).toBe('new');
  });

  it('writes multi-line notes as triple-quoted', () => {
    expect(tableNoteAfter('Table t {\n  id int\n}', 'public.t', 'line one\nline two')).toBe('line one\nline two');
  });

  it('removes the Note line entirely', () => {
    const src = "Table t {\n  id int\n  Note: 'gone'\n}";
    const out = apply(src, buildTableNoteSplice(src, 'public.t', null)!);
    expect(out).toBe('Table t {\n  id int\n}');
  });

  it('never matches the word Note inside a field string or an indexes block', () => {
    const src = "Table t {\n  label varchar [default: 'Note: fake']\n}";
    expect(tableNoteAfter(src, 'public.t', 'real')).toBe('real');
  });

  it('refuses header-form notes and unknown tables', () => {
    expect(buildTableNoteSplice("Table t [note: 'hdr'] {\n  id int\n}", 'public.t', 'x')).toBeNull();
    expect(buildTableNoteSplice('Table t {\n  id int\n}', 'public.zzz', 'x')).toBeNull();
  });
});

describe('buildStickyNoteSplice → real parser', () => {
  it('replaces single-line, multi-line, and quoted-name note contents', () => {
    expect(stickyAfter("Note memo {\n  'old'\n}", 'memo', 'fresh')).toBe('fresh');
    expect(stickyAfter("Note memo {\n  '''old\nlines'''\n}", 'memo', 'a\nb')).toBe('a\nb');
    expect(stickyAfter('Note "my memo" {\n  \'x\'\n}', 'my memo', 'y')).toBe('y');
  });

  it('targets the right block among several', () => {
    const src = "Note a {\n  'aaa'\n}\n\nNote b {\n  'bbb'\n}";
    const out = apply(src, buildStickyNoteSplice(src, 'b', 'BBB')!);
    const r = parseDbml(out);
    if (!r.ok) throw new Error('parse failed');
    expect(r.schema.notes.find((n) => n.name === 'a')!.content).toBe('aaa');
    expect(r.schema.notes.find((n) => n.name === 'b')!.content).toBe('BBB');
  });

  it('refuses unknown names and unquotable content', () => {
    expect(buildStickyNoteSplice("Note memo {\n  'x'\n}", 'nope', 'y')).toBeNull();
    expect(buildStickyNoteSplice("Note memo {\n  'x'\n}", 'memo', "multi\nline ''' too")).toBeNull();
  });
});

describe('buildNewNoteBlock', () => {
  it('picks a collision-free name and the block parses', () => {
    const { name, block } = buildNewNoteBlock(['note_1', 'memo']);
    expect(name).toBe('note_2');
    const r = parseDbml(`Table t { id int }\n\n${block}`);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.schema.notes.find((n) => n.name === 'note_2')!.content).toContain('Double-click');
  });
});
