import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { posFromLineCol } from './editorNav';

describe('posFromLineCol', () => {
  const doc = Text.of(['Table users {', '  id integer', '}']);
  it('maps 1-based line/column to an offset', () => {
    expect(posFromLineCol(doc, 2, 3)).toBe(doc.line(2).from + 2);
  });
  it('clamps line and column into range', () => {
    expect(posFromLineCol(doc, 99, 1)).toBe(doc.line(3).from);
    expect(posFromLineCol(doc, 2, 999)).toBe(doc.line(2).to);
    expect(posFromLineCol(doc, 0, 0)).toBe(0);
  });
});
