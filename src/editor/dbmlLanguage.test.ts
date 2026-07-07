import { describe, it, expect } from 'vitest';
import { StringStream } from '@codemirror/language';
import { dbmlTokenizer } from './dbmlLanguage';

type Token = { text: string; style: string | null };

/** Feed multiple lines through one shared tokenizer state, as CodeMirror does. */
function tokenizeLines(lines: string[]): Token[][] {
  const state = dbmlTokenizer.startState!(2);
  return lines.map((line) => {
    const stream = new StringStream(line, 2, 2);
    const out: Token[] = [];
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = dbmlTokenizer.token(stream, state);
      out.push({ text: stream.current(), style: style ?? null });
    }
    return out;
  });
}

function tokenize(line: string): Token[] {
  return tokenizeLines([line])[0];
}

const stylesOf = (line: string, text: string) =>
  tokenize(line).filter((t) => t.text.trim() === text).map((t) => t.style);

const nonBlank = (tokens: Token[]) => tokens.filter((t) => t.text.trim() !== '');

describe('dbml tokenizer', () => {
  it('highlights block keywords', () => {
    expect(stylesOf('Table users {', 'Table')).toEqual(['keyword']);
    expect(stylesOf('Enum status {', 'Enum')).toEqual(['keyword']);
    expect(stylesOf('Ref: a.b > c.d', 'Ref')).toEqual(['keyword']);
  });
  it('highlights the name after a block keyword as a definition', () => {
    expect(stylesOf('Table users {', 'users')).toEqual(['def']);
  });
  it('highlights strings, numbers, comments', () => {
    expect(stylesOf("note: 'hello'", "'hello'")).toEqual(['string']);
    expect(stylesOf('id int [default: 42]', '42')).toEqual(['number']);
    expect(stylesOf('// a comment', '// a comment')).toEqual(['comment']);
  });
  it('highlights settings inside brackets as attributes', () => {
    expect(stylesOf('id integer [pk, increment]', 'pk')).toEqual(['attribute']);
    expect(stylesOf('id integer [pk, increment]', 'increment')).toEqual(['attribute']);
  });
});

describe('dbml tokenizer state across lines', () => {
  it('does not leak the def flag from a note line onto a bare word on the next line', () => {
    const [, line2] = tokenizeLines(["note: 'hello'", 'something']);
    expect(line2.filter((t) => t.text.trim() === 'something').map((t) => t.style)).toEqual([null]);
  });

  it('clears the def flag at the colon after Ref, leaving the path plain', () => {
    const toks = tokenize('Ref: a.b > c.d');
    expect(toks.some((t) => t.style === 'def')).toBe(false);
    expect(stylesOf('Ref: a.b > c.d', 'Ref')).toEqual(['keyword']);
  });

  it('spans block comments across lines and resumes normal tokens after the close', () => {
    const [l1, l2, l3] = tokenizeLines(['/* start', 'still comment', 'end */ Table x {']);
    expect(nonBlank(l1).every((t) => t.style === 'comment')).toBe(true);
    expect(nonBlank(l2).every((t) => t.style === 'comment')).toBe(true);
    expect(l3.filter((t) => t.text.trim() === 'Table').map((t) => t.style)).toEqual(['keyword']);
  });

  it('spans triple-quoted strings across lines until closed', () => {
    const lines = tokenizeLines(["'''", 'some content', "'''"]);
    for (const line of lines) {
      expect(nonBlank(line).every((t) => t.style === 'string')).toBe(true);
    }
  });

  it('handles same-line block comment open+close followed by a keyword', () => {
    const toks = tokenize('/* c */ Table x {');
    expect(toks[0].style).toBe('comment');
    expect(stylesOf('/* c */ Table x {', 'Table')).toEqual(['keyword']);
  });
});
