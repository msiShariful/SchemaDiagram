import { blankNoise } from '../core/parse/blankNoise';
import { buildTableRanges, rangeForTable } from './sourceMap';

/** Canvas→text bridge, field-note rewriter (pure; editorNav dispatches).
 *  Computes ONE splice against the source or refuses with null — the same
 *  contract as rewriteTableHeader/findRefLine: never guess, never mangle.
 *  Refusals: field line not found (alias'd/exotic layouts the scanner can't
 *  prove), settings bracket spanning lines, unquotable note text. */

export interface SourceSplice {
  from: number;
  to: number;
  insert: string;
}

/** Quote a note value for an inline setting. Single-line only; picks the
 *  quote the text doesn't use; refuses text using both (or backslashes —
 *  escape behavior differs across dbml parsers, not worth guessing). */
export function quoteNoteText(text: string): string | null {
  if (text.includes('\n') || text.includes('\\')) return null;
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  return null;
}

interface FieldLine {
  lineFrom: number; // absolute offset of line start
  lineText: string; // original
  blanked: string; // blankNoise'd, same length
}

/** Locate the field's source line inside its table body (depth-1 lines only
 *  — never inside an indexes{} block). Matches the leading identifier
 *  (quoted or bare) against the PARSED field name. */
function findFieldLine(source: string, blankedSource: string, tableId: string, fieldName: string): FieldLine | null {
  const range = rangeForTable(buildTableRanges(source), tableId);
  if (!range) return null;
  const bodyFrom = source.indexOf('{', range.headerTo) + 1;
  let depth = 0;
  let lineStart = bodyFrom;
  for (let i = bodyFrom; i < range.to; i++) {
    const ch = blankedSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (ch === '\n' || i === range.to - 1) {
      if (depth === 0) {
        const lineText = source.slice(lineStart, i);
        const m = /^[ \t]*("([^"]+)"|[A-Za-z_]\w*)[ \t]+\S/.exec(lineText);
        if (m) {
          const ident = m[2] !== undefined ? m[2] : m[1];
          if (ident === fieldName) {
            return { lineFrom: lineStart, lineText, blanked: blankedSource.slice(lineStart, i) };
          }
        }
      }
      lineStart = i + 1;
    }
  }
  return null;
}

/** The splice that sets (note !== null) or removes (note === null) the
 *  field's inline [note: …]. Null = refused, make no edit. */
export function buildFieldNoteSplice(
  source: string,
  tableId: string,
  fieldName: string,
  note: string | null,
): SourceSplice | null {
  const blankedSource = blankNoise(source);
  const line = findFieldLine(source, blankedSource, tableId, fieldName);
  if (!line) return null;
  const { lineFrom, lineText, blanked } = line;

  const openRel = blanked.indexOf('[');
  let closeRel = -1;
  if (openRel !== -1) {
    closeRel = blanked.indexOf(']', openRel + 1);
    if (closeRel === -1) return null; // settings span lines — refuse
  }

  // Locate an existing note token inside the bracket (blanked text: string
  // contents are spaces, so this never matches inside a value).
  let noteKeyRel = -1;
  if (openRel !== -1) {
    const m = /\bnote[ \t]*:/i.exec(blanked.slice(openRel, closeRel));
    if (m) noteKeyRel = openRel + m.index;
  }

  if (note !== null) {
    const quoted = quoteNoteText(note);
    if (quoted === null) return null;
    if (noteKeyRel !== -1) {
      // replace the existing value: after the colon up to the next
      // bracket-level comma (or the close bracket)
      const colonRel = blanked.indexOf(':', noteKeyRel);
      let valEndRel = closeRel;
      const comma = blanked.indexOf(',', colonRel + 1);
      if (comma !== -1 && comma < closeRel) valEndRel = comma;
      return { from: lineFrom + colonRel + 1, to: lineFrom + valEndRel, insert: ` ${quoted}` };
    }
    if (openRel !== -1) {
      // append into the existing bracket
      const empty = blanked.slice(openRel + 1, closeRel).trim() === '';
      return { from: lineFrom + closeRel, to: lineFrom + closeRel, insert: empty ? `note: ${quoted}` : `, note: ${quoted}` };
    }
    // no bracket: add one at the end of the CODE — a trailing comment is all
    // spaces in the blanked line, so trimEnd on the blanked text lands
    // before it and the comment survives untouched
    const end = blanked.trimEnd().length;
    return { from: lineFrom + end, to: lineFrom + end, insert: ` [note: ${quoted}]` };
  }

  // Removal
  if (noteKeyRel === -1) return { from: lineFrom, to: lineFrom, insert: '' }; // nothing to remove: no-op splice
  const colonRel = blanked.indexOf(':', noteKeyRel);
  let valEndRel = closeRel;
  const comma = blanked.indexOf(',', colonRel + 1);
  if (comma !== -1 && comma < closeRel) valEndRel = comma;
  // segment boundaries at bracket level
  const before = blanked.slice(openRel + 1, noteKeyRel);
  const prevComma = before.lastIndexOf(',');
  const others = (prevComma !== -1 ? before.slice(0, prevComma) : before).trim() !== '' || (valEndRel !== closeRel);
  if (!others) {
    // note was the only setting — drop the whole bracket (and the space run before it)
    let cut = openRel;
    while (cut > 0 && (lineText[cut - 1] === ' ' || lineText[cut - 1] === '\t')) cut--;
    return { from: lineFrom + cut, to: lineFrom + closeRel + 1, insert: '' };
  }
  if (valEndRel !== closeRel) {
    // a setting follows: remove "note: '…'," plus following spaces
    let after = valEndRel + 1;
    while (after < closeRel && blanked[after] === ' ') after++;
    return { from: lineFrom + noteKeyRel, to: lineFrom + after, insert: '' };
  }
  // note is last: remove ", note: '…'" back through the preceding comma
  const cutFrom = prevComma !== -1 ? openRel + 1 + prevComma : openRel + 1;
  return { from: lineFrom + cutFrom, to: lineFrom + closeRel, insert: '' };
}
