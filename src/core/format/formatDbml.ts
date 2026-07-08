/** Whitespace-only DBML formatter. Never alters non-whitespace content. */

/** Strip string/comment content from ONE line for brace counting; returns
 *  the scrubbed line plus updated multi-line state. */
function scrubLine(
  line: string,
  state: { inTriple: boolean; inBlockComment: boolean },
): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.inTriple) {
      const end = line.indexOf("'''", i);
      if (end === -1) return out;
      state.inTriple = false;
      i = end + 3;
      continue;
    }
    if (state.inBlockComment) {
      const end = line.indexOf('*/', i);
      if (end === -1) return out;
      state.inBlockComment = false;
      i = end + 2;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '//') return out;
    if (two === '/*') { state.inBlockComment = true; i += 2; continue; }
    if (line.slice(i, i + 3) === "'''") { state.inTriple = true; i += 3; continue; }
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === '\\') j++;
        j++;
      }
      i = Math.min(j + 1, line.length);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Apply brace/bracket depth changes from a scrubbed (string/comment-free) line. */
function countDepth(scrubbed: string, depth: number): number {
  for (const ch of scrubbed) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
  }
  return depth;
}

export function formatDbmlSource(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  const state = { inTriple: false, inBlockComment: false };
  let depth = 0;
  let blankRun = 0;

  for (const raw of lines) {
    if (state.inTriple || state.inBlockComment) {
      // verbatim passthrough; scrub to detect the closer, and count any
      // depth changes in the code tail after a same-line `*/` or `'''`
      const tail = scrubLine(raw, state);
      out.push(raw);
      depth = countDepth(tail, depth);
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
      blankRun++;
      if (blankRun === 1) out.push('');
      continue;
    }
    blankRun = 0;

    const scrubbed = scrubLine(trimmed, state);

    let lineDepth = depth;
    if (/^[}\]]/.test(scrubbed || trimmed)) lineDepth = Math.max(0, depth - 1);

    let content = trimmed;
    if (/\{$/.test(scrubbed) && !/ \{$/.test(content)) {
      content = content.replace(/\s*\{$/, ' {');
    }
    out.push('  '.repeat(lineDepth) + content);

    depth = countDepth(scrubbed, depth);
  }
  // drop a trailing blank line introduced by collapsing, keep original final-newline shape
  while (out.length > 1 && out[out.length - 1] === '' && !source.endsWith('\n')) out.pop();
  return out.join('\n');
}
