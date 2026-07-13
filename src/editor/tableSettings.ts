import { blankNoise } from './sourceMap';

/** Feature B's pure header-line rewriter — the text half of the canvas→text
 *  bridge. Input is the header segment sourceMap delimits (from the `Table`
 *  keyword up to, NOT including, the `{`). Output is the rewritten header,
 *  or null when the shape isn't one we can rewrite safely — the caller then
 *  makes NO edit (never a mangled one). */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;

// Header anatomy (single line by construction — sourceMap's HEADER_RE only
// matches headers whose `{` is on the same line):
//   Table <schema.>? <name> ( as <alias>)? [settings]?
// Anchored ^…$ so anything unexpected (a comment mid-header, stray tokens
// after the bracket) fails the match and we refuse to edit.
// The bracket group is greedy to the LAST `]` on the line, so a `]` inside a
// quoted setting value ([note: 'a]b']) is captured whole — pinned by test.
const PARTS_RE =
  /^(Table[ \t]+)((?:"[^"\n]+"|[A-Za-z_]\w*)[ \t]*\.[ \t]*)?("[^"\n]+"|[A-Za-z_]\w*)((?:[ \t]+as[ \t]+[A-Za-z_]\w*)?)(?:[ \t]*(\[[^\n]*\]))?$/i;

export interface TableHeaderEdit {
  name?: string;
  headerColor?: string | null; // null removes the setting
}

interface ColorSpan {
  keyFrom: number;
  valueFrom: number;
  valueTo: number;
}

/** Locate `headerColor: <value>` inside a settings bracket's INNER text.
 *  Scans blankNoise'd text (quoted strings blanked) so a note containing the
 *  literal words "headerColor:" can never false-match. */
function findColorSpan(inner: string): ColorSpan | null {
  const blanked = blankNoise(inner);
  const m = /(^|[,\s])headerColor[ \t]*:[ \t]*/i.exec(blanked);
  if (!m) return null;
  const keyFrom = m.index + m[1].length;
  const valueFrom = m.index + m[0].length;
  const comma = blanked.indexOf(',', valueFrom);
  let valueTo = comma === -1 ? inner.length : comma;
  while (valueTo > valueFrom && /[ \t]/.test(blanked[valueTo - 1])) valueTo--;
  return { keyFrom, valueFrom, valueTo };
}

function upsertColor(bracket: string | undefined, color: string): string {
  if (!bracket) return `[headerColor: ${color}]`;
  const inner = bracket.slice(1, -1);
  const span = findColorSpan(inner);
  if (span) return `[${inner.slice(0, span.valueFrom)}${color}${inner.slice(span.valueTo)}]`;
  if (inner.trim() === '') return `[headerColor: ${color}]`;
  return `[${inner.trimEnd()}, headerColor: ${color}]`;
}

function removeColor(bracket: string | undefined): string | undefined {
  if (!bracket) return undefined;
  const inner = bracket.slice(1, -1);
  const span = findColorSpan(inner);
  if (!span) return bracket; // not set — bracket unchanged
  const blanked = blankNoise(inner);
  let from = span.keyFrom;
  let to = span.valueTo;
  // Consume ONE separating comma — the trailing one when another entry
  // follows ("headerColor: x, rest"), else the leading one ("rest,
  // headerColor: x") — plus the spaces after it, so removing a MIDDLE entry
  // never leaves a double space.
  const after = /^[ \t]*,[ \t]*/.exec(blanked.slice(to));
  if (after) {
    to += after[0].length;
  } else {
    const before = blanked.slice(0, from);
    const comma = before.lastIndexOf(',');
    if (comma !== -1 && before.slice(comma + 1).trim() === '') from = comma;
  }
  const rest = (inner.slice(0, from) + inner.slice(to)).trim();
  return rest === '' ? undefined : `[${rest}]`;
}

/** Bare identifier when possible, double-quoted otherwise; null when the
 *  name can't be represented on a header line at all. */
function emitName(name: string): string | null {
  if (IDENT_RE.test(name)) return name;
  if (name === '' || name.includes('"') || name.includes('\n')) return null;
  return `"${name}"`;
}

export function rewriteTableHeader(header: string, edit: TableHeaderEdit): string | null {
  const m = PARTS_RE.exec(header.trimEnd());
  if (m === null) return null; // shape we don't understand — refuse, never mangle
  const [, kw, schemaPart = '', nameTok, aliasPart, bracket] = m;

  let name = nameTok;
  if (edit.name !== undefined) {
    const emitted = emitName(edit.name.trim());
    if (emitted === null) return null;
    name = emitted;
  }

  let settings: string | undefined = bracket;
  if (edit.headerColor !== undefined) {
    if (edit.headerColor === null) settings = removeColor(bracket);
    else if (HEX_COLOR_RE.test(edit.headerColor)) settings = upsertColor(bracket, edit.headerColor);
    else return null;
  }

  return `${kw}${schemaPart}${name}${aliasPart}${settings ? ` ${settings}` : ''}`;
}
