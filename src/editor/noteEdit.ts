import { blankNoise } from '../core/parse/blankNoise';
import { buildTableRanges, rangeForTable } from './sourceMap';
import type { SourceSplice } from './fieldNote';

/** Canvas→text bridge, note rewriters (pure; editorNav dispatches).
 *  Same contract as fieldNote/refEdit: ONE splice or a null refusal —
 *  never guess, never mangle. Quote forms probed on the installed
 *  @dbml/core 8.3.1: '…'/"…" are single-line (raw newline = parse error),
 *  '''…''' carries real newlines, for BOTH body `Note:` lines and sticky
 *  `Note name { … }` blocks. */

/** Quote note text for a Note:-line / note-block string. Multi-line (or
 *  both-quotes) text uses '''…'''; text containing ''' or backslashes is
 *  refused (escape behavior not worth guessing — fieldNote precedent). */
export function quoteBlockText(text: string): string | null {
  if (text.includes('\\')) return null;
  const multiline = text.includes('\n');
  const both = text.includes("'") && text.includes('"');
  if (multiline || both) {
    return text.includes("'''") ? null : `'''${text}'''`;
  }
  if (!text.includes("'")) return `'${text}'`;
  return `"${text}"`;
}

/** Extent of the string token starting at source[start] (a quote char).
 *  Returns the end offset AFTER the closing quote, or null (unterminated /
 *  not a quote). Single/double quotes must close on the same line. */
function stringTokenEnd(source: string, start: number): number | null {
  if (source.startsWith("'''", start)) {
    const close = source.indexOf("'''", start + 3);
    return close === -1 ? null : close + 3;
  }
  const q = source[start];
  if (q !== "'" && q !== '"') return null;
  const line = source.indexOf('\n', start + 1);
  const close = source.indexOf(q, start + 1);
  if (close === -1 || (line !== -1 && close > line)) return null;
  return close + 1;
}

/** Set / replace / remove a table's body `Note: '…'` line.
 *  A note living in the HEADER settings bracket (rare) is refused — the
 *  popover surfaces honest copy instead of a second rewrite path. */
export function buildTableNoteSplice(
  source: string,
  tableId: string,
  note: string | null,
): SourceSplice | null {
  const blanked = blankNoise(source);
  const range = rangeForTable(buildTableRanges(source), tableId);
  if (!range) return null;
  const bodyFrom = source.indexOf('{', range.headerTo) + 1;

  // Header-form note? ([note: …] inside the header bracket) — refuse.
  const header = blanked.slice(range.headerFrom, range.headerTo);
  if (/\bnote[ \t]*:/i.test(header)) return null;

  // Find a depth-1 `Note:` line in the body (blanked text: never inside
  // strings/comments; depth tracking skips indexes{} blocks).
  let depth = 0;
  let lineStart = bodyFrom;
  let noteLine: { from: number; colon: number } | null = null;
  for (let i = bodyFrom; i < range.to && noteLine === null; i++) {
    const ch = blanked[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (ch === '\n' || i === range.to - 1) {
      if (depth === 0) {
        const m = /^[ \t]*Note[ \t]*:/i.exec(blanked.slice(lineStart, i));
        if (m) noteLine = { from: lineStart, colon: lineStart + m[0].length };
      }
      lineStart = i + 1;
    }
  }

  if (note !== null) {
    const quoted = quoteBlockText(note);
    if (quoted === null) return null;
    if (noteLine) {
      // replace the existing string token after the colon
      let k = noteLine.colon;
      while (k < range.to && (source[k] === ' ' || source[k] === '\t')) k++;
      const end = stringTokenEnd(source, k);
      if (end === null) return null;
      return { from: noteLine.colon, to: end, insert: ` ${quoted}` };
    }
    // insert a fresh line right after the opening brace, matching the body indent
    const afterBrace = source.indexOf('\n', bodyFrom);
    if (afterBrace === -1 || afterBrace > range.to) return null;
    const nextLine = source.slice(afterBrace + 1, source.indexOf('\n', afterBrace + 1));
    const indent = /^[ \t]*/.exec(nextLine)![0] || '  ';
    return { from: afterBrace + 1, to: afterBrace + 1, insert: `${indent}Note: ${quoted}\n` };
  }

  // Removal: drop the whole Note line (plus its newline)
  if (!noteLine) return { from: 0, to: 0, insert: '' }; // nothing to remove — no-op
  const lineEnd = source.indexOf('\n', noteLine.colon);
  const to = lineEnd === -1 || lineEnd >= range.to ? range.to - 1 : lineEnd + 1;
  return { from: noteLine.from, to, insert: '' };
}

const NOTE_BLOCK_RE = /(^|\n)[ \t]*Note[ \t]+("([^"]+)"|[A-Za-z_]\w*)[ \t]*\{/gi;

/** Replace the content string of a sticky `Note name { '…' }` block. */
export function buildStickyNoteSplice(
  source: string,
  noteName: string,
  content: string,
): SourceSplice | null {
  const quoted = quoteBlockText(content);
  if (quoted === null) return null;
  const blanked = blankNoise(source);
  NOTE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NOTE_BLOCK_RE.exec(blanked)) !== null) {
    const braceAt = m.index + m[0].length - 1;
    // quoted names are blanked to spaces — resolve the real name from the
    // ORIGINAL text over the same span
    const identMatch = /Note[ \t]+("([^"]+)"|[A-Za-z_]\w*)/i.exec(source.slice(m.index, braceAt));
    if (!identMatch) continue;
    const realName = identMatch[2] !== undefined ? identMatch[2] : identMatch[1];
    if (realName !== noteName) continue;
    // find the string token inside the block
    let k = braceAt + 1;
    let depth = 1;
    while (k < source.length && depth > 0) {
      const ch = blanked[k];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (source[k] === "'" || source[k] === '"') {
        // blanked strings are spaces — a quote surviving in ORIGINAL at a
        // blanked-space position is the token opener
        const end = stringTokenEnd(source, k);
        if (end === null) return null;
        return { from: k, to: end, insert: quoted };
      }
      k++;
    }
    return null; // block without a string — refuse
  }
  return null; // note block not found
}

/** A fresh sticky-note block with a collision-free name. */
export function buildNewNoteBlock(existingNames: readonly string[]): { name: string; block: string } {
  const taken = new Set(existingNames);
  let i = 1;
  while (taken.has(`note_${i}`)) i++;
  const name = `note_${i}`;
  return { name, block: `Note ${name} {\n  'Double-click to edit me.'\n}` };
}
