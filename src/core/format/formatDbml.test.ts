import { describe, it, expect } from 'vitest';
import { formatDbmlSource } from './formatDbml';

describe('formatDbmlSource', () => {
  it('normalizes indentation by block depth', () => {
    const src = 'Table users{\nid integer [pk]\n      name varchar\n indexes {\n(id)\n }\n}';
    expect(formatDbmlSource(src)).toBe(
      'Table users {\n  id integer [pk]\n  name varchar\n  indexes {\n    (id)\n  }\n}',
    );
  });
  it('preserves comments with correct indentation', () => {
    const src = 'Table t {\n// keep me\nid int\n}';
    expect(formatDbmlSource(src)).toBe('Table t {\n  // keep me\n  id int\n}');
  });
  it('passes triple-quoted bodies through verbatim (no reindent, braces ignored)', () => {
    const src = "Table t {\n  Note: '''\n   { weird }  \n  '''\n  id int\n}";
    const out = formatDbmlSource(src);
    expect(out).toContain('   { weird }  ');
    expect(out.endsWith('}')).toBe(true);
    expect(out).toContain('  id int');
  });
  it('collapses runs of blank lines to one and strips trailing whitespace', () => {
    const src = 'Table a {\n  id int   \n}\n\n\n\nTable b {\n  id int\n}';
    expect(formatDbmlSource(src)).toBe('Table a {\n  id int\n}\n\nTable b {\n  id int\n}');
  });
  it('is idempotent', () => {
    const src = 'Table users{\nid integer\n}\n\n\nRef: a.b > c.d';
    const once = formatDbmlSource(src);
    expect(formatDbmlSource(once)).toBe(once);
  });
  it('never changes non-whitespace content', () => {
    const src = "Table t {\n  s varchar [default: 'a  {  b']\n}";
    const strip = (s: string) => s.replace(/[ \t]+/g, '');
    expect(strip(formatDbmlSource(src))).toBe(strip(src));
  });
  it('counts depth in the tail after a same-line block-comment closer', () => {
    const src = 'Table t {\n  id int\n  /* note\n*/ settings {\nx\n}\n}';
    const expected = 'Table t {\n  id int\n  /* note\n*/ settings {\n    x\n  }\n}';
    expect(formatDbmlSource(src)).toBe(expected);
    expect(formatDbmlSource(expected)).toBe(expected);
  });
  it('indents multi-line bracket settings and dedents the closing ]', () => {
    const src = 'Table t {\nid int [\npk,\nincrement\n]\n}';
    const expected = 'Table t {\n  id int [\n    pk,\n    increment\n  ]\n}';
    expect(formatDbmlSource(src)).toBe(expected);
    expect(formatDbmlSource(expected)).toBe(expected);
  });
  it('counts a brace after a same-line triple-quote closer', () => {
    const src = "Table t {\n  Note: '''\nbody\n''' }\nTable u {\n  id int\n}";
    const out = formatDbmlSource(src);
    const lines = out.split('\n');
    const idx = lines.indexOf('Table u {');
    expect(idx).toBeGreaterThan(-1); // flush left, depth back to 0
    expect(lines[idx + 1]).toBe('  id int');
  });
});
