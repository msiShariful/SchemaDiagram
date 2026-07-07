import type { Text } from '@codemirror/state';
import type { Diagnostic } from '@codemirror/lint';
import type { ParseError } from '../core/parse/parseDbml';

export function errorToDiagnostic(doc: Text, err: ParseError): Diagnostic {
  const lineNo = Math.min(Math.max(err.line, 1), doc.lines);
  const line = doc.line(lineNo);
  const from = Math.min(line.from + Math.max(err.column - 1, 0), line.to);
  return { from, to: line.to, severity: 'error', message: err.message };
}
