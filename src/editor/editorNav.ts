import { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { buildTableRanges, rangeForTable } from './sourceMap';
import { formatDbmlSource } from '../core/format/formatDbml';
import { useAppStore } from '../app/store';

let currentView: EditorView | null = null;

export function registerEditorView(view: EditorView | null): void {
  currentView = view;
}

export function posFromLineCol(doc: Text, line: number, column: number): number {
  const lineNo = Math.min(Math.max(line, 1), doc.lines);
  const l = doc.line(lineNo);
  return Math.min(l.from + Math.max(column - 1, 0), l.to);
}

export function revealRange(from: number, to: number): void {
  const view = currentView;
  if (!view) return;
  const max = view.state.doc.length;
  const a = Math.min(from, max);
  const b = Math.min(to, max);
  view.dispatch({
    selection: { anchor: a, head: b },
    effects: EditorView.scrollIntoView(a, { y: 'center' }),
  });
  view.focus();
}

export function revealPosition(line: number, column: number): void {
  const view = currentView;
  if (!view) return;
  const pos = posFromLineCol(view.state.doc, line, column);
  revealRange(pos, pos);
}

export function revealTable(tableId: string): void {
  const view = currentView;
  if (!view) return;
  const range = rangeForTable(buildTableRanges(view.state.doc.toString()), tableId);
  if (range) revealRange(range.headerFrom, range.headerTo);
}

export function applyFormat(): boolean {
  const view = currentView;
  if (!view) return false;
  const s = useAppStore.getState();
  if (s.stale || s.errors.length > 0) return false;
  const current = view.state.doc.toString();
  const formatted = formatDbmlSource(current);
  if (formatted !== current) {
    view.dispatch({ changes: { from: 0, to: current.length, insert: formatted } });
  }
  return true;
}
