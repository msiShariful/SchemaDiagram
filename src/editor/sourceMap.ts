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

/** Replace comment and string contents with spaces (length-preserving; newlines kept).
 *  Double-quoted content is preserved because DBML uses "..." for identifiers. */
export function blankNoise(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const rest2 = source.slice(i, i + 2);
    const rest3 = source.slice(i, i + 3);
    if (rest2 === '//') {
      const end = source.indexOf('\n', i);
      const to = end === -1 ? source.length : end;
      blank(i, to);
      i = to;
    } else if (rest2 === '/*') {
      const end = source.indexOf('*/', i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to);
      i = to;
    } else if (rest3 === "'''") {
      const end = source.indexOf("'''", i + 3);
      const to = end === -1 ? source.length : end + 3;
      blank(i, to);
      i = to;
    } else if (source[i] === "'" || source[i] === '`') {
      const q = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== q && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        j++;
      }
      const to = Math.min(j + 1, source.length);
      blank(i, to);
      i = to;
    } else if (source[i] === '"') {
      let j = i + 1; // skip over, preserving content (identifier)
      while (j < source.length && source[j] !== '"' && source[j] !== '\n') j++;
      i = Math.min(j + 1, source.length);
    } else {
      i++;
    }
  }
  return out.join('');
}

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
