import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { errorToDiagnostic } from './diagnostics';

describe('errorToDiagnostic', () => {
  const doc = Text.of(['Table users {', '  id integer', '}']);
  it('maps line/column to doc offsets', () => {
    const d = errorToDiagnostic(doc, { message: 'boom', line: 2, column: 3 });
    expect(d.from).toBe(doc.line(2).from + 2);
    expect(d.to).toBe(doc.line(2).to);
    expect(d.severity).toBe('error');
  });
  it('clamps out-of-range lines and columns', () => {
    const d = errorToDiagnostic(doc, { message: 'boom', line: 99, column: 99 });
    expect(d.from).toBeLessThanOrEqual(doc.length);
    expect(d.to).toBeLessThanOrEqual(doc.length);
    expect(d.from).toBeLessThanOrEqual(d.to);
  });
});
