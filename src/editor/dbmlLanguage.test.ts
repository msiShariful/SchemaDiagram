import { describe, it, expect } from 'vitest';
import { StringStream } from '@codemirror/language';
import { dbmlTokenizer } from './dbmlLanguage';

function tokenize(line: string): Array<{ text: string; style: string | null }> {
  const state = dbmlTokenizer.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: Array<{ text: string; style: string | null }> = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = dbmlTokenizer.token(stream, state);
    out.push({ text: stream.current(), style: style ?? null });
  }
  return out;
}
const stylesOf = (line: string, text: string) =>
  tokenize(line).filter((t) => t.text.trim() === text).map((t) => t.style);

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
