/** Lives in core (moved from editor/sourceMap in Plan 7) so the normalizer
 *  can classify inline refs; sourceMap re-exports it — one implementation. */
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
