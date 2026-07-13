import { blankNoise } from '../core/parse/blankNoise';
import { buildTableRanges } from './sourceMap';
import { emitIdent } from './tableSettings';
import type { Ref, RefEndpoint } from '../core/model/types';

/** Feature A's pure ref-line machinery — the text half of the bridge's
 *  second consumer. findRefLine LOCATES a standalone `Ref:` line for a
 *  normalized ref; the editorNav wrappers dispatch the actual transactions.
 *  Endpoint-pair matching is unambiguous: dbmlv2 rejects duplicate endpoint
 *  pairs as a parse error (verified on the installed 8.3.1). */

export type RefOperator = '>' | '<' | '-' | '<>';

export const MIRRORED: Record<RefOperator, RefOperator> = { '>': '<', '<': '>', '-': '-', '<>': '<>' };

/** Cardinality of a normalized ref read as `from OP to`. */
export function refOperator(ref: Ref): RefOperator {
  if (ref.from.relation === '*' && ref.to.relation === '1') return '>';
  if (ref.from.relation === '1' && ref.to.relation === '*') return '<';
  if (ref.from.relation === '*') return '<>';
  return '-';
}

export interface RefLineMatch {
  lineFrom: number; // offset of the line's first character
  lineTo: number; // offset AFTER the trailing newline (line end at EOF) — the delete span
  opFrom: number; // operator span — the swap target
  opTo: number;
  operator: RefOperator; // as written on the line
  flipped: boolean; // the textual LEFT endpoint is ref.to (line written in the other direction)
}

const IDENT = String.raw`(?:"[^"\n]+"|[A-Za-z_]\w*)`;
const FIELDS = String.raw`(?:${IDENT}|\(\s*${IDENT}(?:\s*,\s*${IDENT})*\s*\))`;
// endpoint = [schema .] table . fields — captures: table-path, fields
const ENDPOINT = String.raw`((?:${IDENT}[ \t]*\.[ \t]*)?${IDENT})[ \t]*\.[ \t]*(${FIELDS})`;
// The standalone SINGLE-LINE form: `Ref[ name]: <ep> <op> <ep> [settings]?`.
// Runs on blankNoise'd text (strings/comments blanked, quoted identifiers
// preserved) so a `>` inside a note string can't fake an operator and a `]`
// inside a quoted setting can't break the tail. The block form `Ref { … }`
// has no `:` on this line → no match → null → the popover refuses honestly.
// Capture groups: 1 = left table-path, 2 = left fields, 3 = operator,
// 4 = right table-path, 5 = right fields. /d for the operator span indices.
const REF_LINE_RE = new RegExp(
  String.raw`^[ \t]*Ref(?:[ \t]+${IDENT})?[ \t]*:[ \t]*${ENDPOINT}[ \t]*(<>|[<>-])[ \t]*${ENDPOINT}[ \t]*(?:\[[^\]\n]*\])?[ \t]*$`,
  'id',
);

function unquote(tok: string): string {
  return tok.startsWith('"') ? tok.slice(1, -1) : tok;
}

/** "schema.table" | "table" (either token quotable) → CANDIDATE normalizer
 *  identities. An unqualified bare token may also be a table ALIAS — the
 *  parser resolves aliases in ref endpoints (verified: `Ref: … > U.id`
 *  normalizes to `users`), so the text side must resolve them too;
 *  buildTableRanges already extracts aliases. A schema-qualified path is
 *  never an alias. */
function tableCandidates(raw: string, aliasToId: Map<string, string>): string[] {
  const m = new RegExp(String.raw`^(?:(${IDENT})[ \t]*\.[ \t]*)?(${IDENT})$`).exec(raw.trim());
  if (!m) return [raw.trim()];
  const table = unquote(m[2]);
  if (m[1]) return [`${unquote(m[1])}.${table}`];
  const out = [`public.${table}`];
  const viaAlias = aliasToId.get(table);
  if (viaAlias !== undefined && viaAlias !== out[0]) out.push(viaAlias);
  return out;
}

function parseFields(raw: string): string[] {
  const t = raw.trim();
  const inner = t.startsWith('(') ? t.slice(1, -1) : t;
  return inner.split(',').map((f) => unquote(f.trim()));
}

function sameEndpoint(tableIds: string[], fields: string[], ep: RefEndpoint): boolean {
  return (
    tableIds.includes(ep.tableId) &&
    fields.length === ep.fieldNames.length &&
    fields.every((f, i) => f === ep.fieldNames[i])
  );
}

export function findRefLine(source: string, ref: Ref): RefLineMatch | null {
  const blanked = blankNoise(source);
  const aliasToId = new Map(
    buildTableRanges(source)
      .filter((r) => r.alias !== null)
      .map((r) => [r.alias as string, r.tableId] as const),
  );
  let lineFrom = 0;
  for (;;) {
    const nl = blanked.indexOf('\n', lineFrom);
    const lineEnd = nl === -1 ? blanked.length : nl;
    const m = REF_LINE_RE.exec(blanked.slice(lineFrom, lineEnd));
    if (m) {
      const [, t1, f1, op, t2, f2] = m;
      const left = { ids: tableCandidates(t1, aliasToId), fields: parseFields(f1) };
      const right = { ids: tableCandidates(t2, aliasToId), fields: parseFields(f2) };
      const direct = sameEndpoint(left.ids, left.fields, ref.from) && sameEndpoint(right.ids, right.fields, ref.to);
      const flipped = !direct && sameEndpoint(left.ids, left.fields, ref.to) && sameEndpoint(right.ids, right.fields, ref.from);
      if (direct || flipped) {
        const [opStart, opEnd] = m.indices![3]!;
        return {
          lineFrom,
          lineTo: nl === -1 ? lineEnd : lineEnd + 1,
          opFrom: lineFrom + opStart,
          opTo: lineFrom + opEnd,
          operator: op as RefOperator,
          flipped,
        };
      }
    }
    if (nl === -1) return null;
    lineFrom = nl + 1;
  }
}

export interface RefLineEndpoint {
  schemaName: string;
  tableName: string;
  fieldName: string;
}

/** `Ref: a.b > c.d` — the appended standalone line (ref-drag). `>` =
 *  many-to-one source>target, dbdiagram's drag default. Null when a name is
 *  unrepresentable (contains `"` or a newline) — the caller cancels, never
 *  writes a mangled line. `public.` is omitted (normalizer default; the
 *  qualified form also parses — plan Verified facts). */
export function buildRefLine(from: RefLineEndpoint, to: RefLineEndpoint): string | null {
  const fmt = (e: RefLineEndpoint): string | null => {
    const t = emitIdent(e.tableName);
    const f = emitIdent(e.fieldName);
    if (t === null || f === null) return null;
    if (e.schemaName === 'public') return `${t}.${f}`;
    const s = emitIdent(e.schemaName);
    return s === null ? null : `${s}.${t}.${f}`;
  };
  const a = fmt(from);
  const b = fmt(to);
  return a === null || b === null ? null : `Ref: ${a} > ${b}`;
}

/** Display-only summary for the edge popover. */
export function formatRefText(ref: Ref): string {
  const ep = (e: RefEndpoint): string => {
    const table = e.tableId.startsWith('public.') ? e.tableId.slice('public.'.length) : e.tableId;
    const fields = e.fieldNames.length === 1 ? e.fieldNames[0] : `(${e.fieldNames.join(', ')})`;
    return `${table}.${fields}`;
  };
  return `${ep(ref.from)} ${refOperator(ref)} ${ep(ref.to)}`;
}
