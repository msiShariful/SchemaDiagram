import { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { buildTableRanges, rangeForTable } from './sourceMap';
import { formatDbmlSource } from '../core/format/formatDbml';
import { useAppStore } from '../app/store';
import { rewriteTableHeader, type TableHeaderEdit } from './tableSettings';
import { findRefLine, MIRRORED, type RefOperator } from './refEdit';
import type { Ref } from '../core/model/types';

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
  // `stale` only says the LAST parse failed — a parse of NEWER text may still
  // be inside the 300 ms debounce. Formatting is allowed only when the last
  // successful parse was of exactly this text.
  if (s.parsedSource !== current) return false;
  const formatted = formatDbmlSource(current);
  if (formatted !== current) {
    view.dispatch({ changes: { from: 0, to: current.length, insert: formatted } });
  }
  return true;
}

/** Canvas→text bridge (Feature B) — the sanctioned way for canvas-origin UI
 *  to change DBML, alongside applyFormat/revealTable: ONE CodeMirror
 *  transaction, so undo lives in editor history and the parse pipeline
 *  re-renders the result. Never touches store schema state.
 *  Renaming deliberately does NOT rewrite refs: dangling refs surface as
 *  ordinary parse errors (stale badge + problems panel), exactly as if the
 *  user had typed the rename. */
export function applyTableSettings(tableId: string, edit: TableHeaderEdit): boolean {
  const view = currentView;
  if (!view) return false;
  const doc = view.state.doc.toString();
  const range = rangeForTable(buildTableRanges(doc), tableId);
  if (!range) return false;
  const header = doc.slice(range.headerFrom, range.headerTo);
  const rewritten = rewriteTableHeader(header, edit);
  if (rewritten === null) return false; // unsafe shape — refuse, make no edit
  if (rewritten === header.trimEnd()) return true; // no-op: nothing to dispatch
  view.dispatch({
    changes: { from: range.headerFrom, to: range.headerTo, insert: `${rewritten} ` },
    userEvent: 'canvas.settings',
  });
  return true;
}

/** Feature A (canvas→text bridge, second consumer): append a standalone Ref
 *  line at the end of the document. ONE transaction; editor history owns
 *  undo; the parse pipeline renders the new edge ~300 ms later. */
export function appendRefLine(line: string): boolean {
  const view = currentView;
  if (!view) return false;
  const len = view.state.doc.length;
  const prefix = len === 0 || view.state.doc.sliceString(len - 1, len) === '\n' ? '' : '\n';
  view.dispatch({
    changes: { from: len, insert: `${prefix}${line}\n` },
    userEvent: 'canvas.ref',
  });
  return true;
}

/** Rewrite a standalone ref's cardinality operator in place, preserving the
 *  rest of the line (name, settings, spacing) byte-for-byte. False when the
 *  line can't be located (inline/block-form ref) — the popover surfaces it. */
export function applyRefOperator(ref: Ref, op: RefOperator): boolean {
  const view = currentView;
  if (!view) return false;
  const m = findRefLine(view.state.doc.toString(), ref);
  if (!m) return false;
  const written = m.flipped ? MIRRORED[op] : op;
  if (written === m.operator) return true; // no-op: nothing to dispatch
  view.dispatch({
    changes: { from: m.opFrom, to: m.opTo, insert: written },
    userEvent: 'canvas.ref',
  });
  return true;
}

/** Delete a standalone ref's whole line (incl. its trailing newline). */
export function deleteRefLine(ref: Ref): boolean {
  const view = currentView;
  if (!view) return false;
  const m = findRefLine(view.state.doc.toString(), ref);
  if (!m) return false;
  view.dispatch({ changes: { from: m.lineFrom, to: m.lineTo }, userEvent: 'canvas.ref' });
  return true;
}
