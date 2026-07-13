export interface TableRange {
  tableId: string;
  name: string;
  schemaName: string;
  alias: string | null;
  from: number;
  headerFrom: number;
  headerTo: number;
  to: number;
}

export { blankNoise } from '../core/parse/blankNoise';
import { blankNoise } from '../core/parse/blankNoise';

const HEADER_RE =
  /(^|\n)[ \t]*Table[ \t]+(?:("([^"]+)"|[A-Za-z_]\w*)[ \t]*\.[ \t]*)?("([^"]+)"|[A-Za-z_]\w*)(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?[^\n{]*\{/gi;

function unquote(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}

export function buildTableRanges(source: string): TableRange[] {
  const blanked = blankNoise(source);
  const ranges: TableRange[] = [];
  HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER_RE.exec(blanked)) !== null) {
    const afterNewline = m.index + m[1].length;
    const indent = /^[ \t]*/.exec(blanked.slice(afterNewline))![0].length;
    const headerFrom = afterNewline + indent;
    const braceAt = m.index + m[0].length - 1;
    // walk braces on the blanked text to find the matching close
    let depth = 1;
    let k = braceAt + 1;
    while (k < blanked.length && depth > 0) {
      if (blanked[k] === '{') depth++;
      else if (blanked[k] === '}') depth--;
      k++;
    }
    const schemaName = unquote(m[2]) ?? 'public';
    const name = unquote(m[4]) ?? '';
    const alias = m[6] ?? null;
    ranges.push({
      tableId: `${schemaName}.${name}`,
      name,
      schemaName,
      alias,
      from: headerFrom,
      headerFrom,
      headerTo: braceAt,
      to: k,
    });
    HEADER_RE.lastIndex = braceAt + 1; // allow back-to-back tables
  }
  return ranges;
}

export function tableAtPos(ranges: TableRange[], pos: number): TableRange | null {
  return ranges.find((r) => pos >= r.from && pos < r.to) ?? null;
}

export function rangeForTable(ranges: TableRange[], tableId: string): TableRange | null {
  return ranges.find((r) => r.tableId === tableId) ?? null;
}
