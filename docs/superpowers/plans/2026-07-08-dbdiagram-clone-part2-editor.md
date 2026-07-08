# dbdiagram Clone — Plan 2: Editor Depth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schema-aware autocomplete, a problems panel with click-to-jump, two-way editor↔canvas navigation, and a comment-preserving Format Document command.

**Architecture:** Spec §7 (milestone 3) of `docs/superpowers/specs/2026-07-07-dbdiagram-clone-design.md`. All intelligence is pure, headlessly-tested functions (`sourceMap`, `completion`, `formatDbml`); thin glue wires them into CodeMirror (`editorNav`, `DbmlEditor`) and the canvas. Completion reads the **last good parse** from the store, so suggestions work even while the current text has errors.

**Tech Stack:** Existing Plan-1 stack + `@codemirror/autocomplete` (already a transitive dep of `codemirror`; added as a direct dependency).

## Global Constraints

- TypeScript `strict: true`; no new `any`.
- `src/core/` MUST NOT import React, zustand, or anything from `src/app|editor|canvas`. (`src/editor/` MAY import from `src/app/` — established Plan-1 pattern.)
- Format must never alter anything except whitespace: comments, strings, and token text are byte-preserved. `formatDbmlSource(formatDbmlSource(x)) === formatDbmlSource(x)` (idempotent).
- Completion suggestions come from `store.schema` (last good parse), never from re-parsing on keystroke.
- Canvas-originated actions still write only layout/UI state — double-click navigation calls into the editor, never mutates DBML.
- Test runner vitest (`npm test`); every task ends green + committed. Working dir `/Users/sharif/Documents/dbdiagram`, branch `feature/plan-2-editor`.
- Table identity remains `${schemaName}.${name}` with `public` default — sourceMap and parseDbml MUST agree.

---

### Task 1: Source map — locate table blocks in DBML text

**Files:**
- Create: `src/editor/sourceMap.ts`
- Test: `src/editor/sourceMap.test.ts`

**Interfaces:**
- Produces:
  - `blankNoise(source: string): string` — same length/newlines as input; contents of `//` and `/* */` comments, `'...'`, `` `...` `` and `'''...'''` strings replaced by spaces (double-quoted `"..."` content is PRESERVED — DBML uses it for identifiers).
  - `interface TableRange { tableId: string; name: string; schemaName: string; alias: string | null; from: number; headerFrom: number; headerTo: number; to: number; }`
  - `buildTableRanges(source: string): TableRange[]`
  - `tableAtPos(ranges: TableRange[], pos: number): TableRange | null` (pos in `[from, to)`)
  - `rangeForTable(ranges: TableRange[], tableId: string): TableRange | null`

- [ ] **Step 1: Write the failing test**

`src/editor/sourceMap.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { blankNoise, buildTableRanges, tableAtPos, rangeForTable } from './sourceMap';

describe('blankNoise', () => {
  it('blanks comments and single-quoted strings, preserving length and newlines', () => {
    const src = "Table a { // brace }\n  n text [note: 'x } y']\n}";
    const out = blankNoise(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(3);
    expect(out).not.toContain('brace');
    expect(out).not.toContain('x } y');
    expect(out).toContain('Table a {');
  });
  it('blanks triple-quoted strings spanning lines', () => {
    const src = "Note: '''\n{ not a brace }\n'''\nTable b { }";
    const out = blankNoise(src);
    expect(out).not.toContain('not a brace');
    expect(out).toContain('Table b');
  });
  it('preserves double-quoted identifier content', () => {
    expect(blankNoise('Table "order items" { }')).toContain('order items');
  });
});

describe('buildTableRanges', () => {
  const src = [
    'Table users {',        // 0
    '  id integer [pk]',
    '}',
    '',
    'Table shop.orders as O {',
    "  note text [note: 'has } brace']",
    '  indexes {',
    '    (id)',
    '  }',
    '}',
    '// Table ghost { }',
    'Enum status { active }',
  ].join('\n');

  it('finds tables with ids, aliases, and correct extents', () => {
    const ranges = buildTableRanges(src);
    expect(ranges.map((r) => r.tableId)).toEqual(['public.users', 'shop.orders']);
    const orders = ranges[1];
    expect(orders.alias).toBe('O');
    expect(src.slice(orders.headerFrom, orders.headerTo)).toContain('Table shop.orders as O');
    // extent covers the nested indexes block and closes at the right brace
    expect(src.slice(orders.from, orders.to)).toContain('indexes {');
    expect(src.slice(orders.to - 1, orders.to)).toBe('}');
  });

  it('ignores tables inside comments and is not fooled by braces in strings', () => {
    const ranges = buildTableRanges(src);
    expect(ranges.find((r) => r.name === 'ghost')).toBeUndefined();
    expect(ranges).toHaveLength(2);
  });

  it('maps a cursor position to its enclosing table', () => {
    const ranges = buildTableRanges(src);
    const insideUsers = src.indexOf('id integer');
    expect(tableAtPos(ranges, insideUsers)?.tableId).toBe('public.users');
    expect(tableAtPos(ranges, src.indexOf('Enum'))).toBeNull();
  });

  it('looks up a range by tableId', () => {
    const ranges = buildTableRanges(src);
    expect(rangeForTable(ranges, 'shop.orders')?.alias).toBe('O');
    expect(rangeForTable(ranges, 'public.nope')).toBeNull();
  });

  it('supports double-quoted table names', () => {
    const ranges = buildTableRanges('Table "order items" {\n  id int\n}');
    expect(ranges[0].tableId).toBe('public.order items');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/sourceMap.test.ts` — Expected: FAIL (cannot resolve `./sourceMap`).

- [ ] **Step 3: Implement**

`src/editor/sourceMap.ts`:
```ts
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
```

Note on `headerFrom`: it must point at the `Table` keyword. The expression above computes it as `m.index + m[1].length` plus any leading indentation consumed by `[ \t]*`; if the test's `slice(headerFrom, headerTo)` assertion fails off-by-whitespace, simplify to `headerFrom = m.index + m[1].length` and let the slice include leading spaces — the test only asserts `toContain`, which tolerates that. Do not weaken the tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/sourceMap.test.ts` — Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/sourceMap.ts src/editor/sourceMap.test.ts && git commit -m "feat: dbml source map — locate table blocks in text"
```

---

### Task 2: Store — editor focus table

**Files:**
- Modify: `src/app/store.ts`
- Test: modify `src/app/store.test.ts` (append tests)

**Interfaces:**
- Produces: `editorFocusTableId: string | null` state (initial `null`) + `setEditorFocusTable(id: string | null): void`; `loadDiagram` resets it to `null`.

- [ ] **Step 1: Write the failing test** — append to `src/app/store.test.ts` (extend the existing `reset` helper's `setState` object with `editorFocusTableId: null`):

```ts
describe('editor focus table', () => {
  beforeEach(reset);
  it('sets and clears the focused table', () => {
    useAppStore.getState().setEditorFocusTable('public.users');
    expect(useAppStore.getState().editorFocusTableId).toBe('public.users');
    useAppStore.getState().setEditorFocusTable(null);
    expect(useAppStore.getState().editorFocusTableId).toBeNull();
  });
  it('loadDiagram clears the focused table', () => {
    useAppStore.getState().setEditorFocusTable('public.users');
    useAppStore.getState().loadDiagram({
      id: 'd9', name: 'X', dbml: 'Table x { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().editorFocusTableId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/app/store.test.ts` — Expected: FAIL (property/action missing).

- [ ] **Step 3: Implement** — in `src/app/store.ts`: add `editorFocusTableId: string | null` to `AppState` with initial value `null`; add action `setEditorFocusTable: (editorFocusTableId) => set({ editorFocusTableId }),`; add `editorFocusTableId: null,` to the `set({...})` inside `loadDiagram`.

- [ ] **Step 4: Verify pass** — `npx vitest run src/app` — Expected: all app tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/store.ts src/app/store.test.ts && git commit -m "feat: editorFocusTableId store state"
```

---

### Task 3: Completion — context detection + schema-aware source (pure)

**Files:**
- Create: `src/editor/completion.ts`
- Test: `src/editor/completion.test.ts`
- Modify: `package.json` (add direct dep)

**Interfaces:**
- Consumes: `blankNoise` (Task 1), `Schema` (core types), store NOT imported (schema injected).
- Produces:
  - `type DbmlContextKind = 'settings' | 'column-of-table' | 'table-target' | 'field-type' | 'table-body' | 'top-level' | 'none'`
  - `interface DbmlContext { kind: DbmlContextKind; tableName?: string; schemaName?: string }`
  - `detectContext(text: string, pos: number): DbmlContext`
  - `createDbmlCompletion(getSchema: () => Schema): (ctx: CompletionContext) => CompletionResult | null`
  - `COLUMN_TYPES: string[]`, `SETTING_OPTIONS: string[]`

- [ ] **Step 1: Install the direct dependency**

```bash
npm install @codemirror/autocomplete
```

- [ ] **Step 2: Write the failing test**

`src/editor/completion.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { detectContext, createDbmlCompletion } from './completion';
import { parseDbml } from '../core/parse/parseDbml';
import type { Schema } from '../core/model/types';

const SCHEMA_SRC = `
Table users {
  id integer [pk]
  name varchar
}
Table posts as P {
  id integer [pk]
  author_id integer
}
Enum status { active \n archived }
Ref: posts.author_id > users.id
`;
const schema: Schema = (() => {
  const r = parseDbml(SCHEMA_SRC);
  if (!r.ok) throw new Error('fixture parse failed');
  return r.schema;
})();

/** doc contains a single '|' marking the cursor */
function ctxAt(docWithCursor: string) {
  const pos = docWithCursor.indexOf('|');
  const doc = docWithCursor.replace('|', '');
  return { doc, pos };
}
function labels(docWithCursor: string, explicit = true): string[] {
  const { doc, pos } = ctxAt(docWithCursor);
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const result = createDbmlCompletion(() => schema)(new CompletionContext(state, pos, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

describe('detectContext', () => {
  it('detects settings inside brackets', () => {
    const { doc, pos } = ctxAt('Table t {\n  id integer [p|\n}');
    expect(detectContext(doc, pos).kind).toBe('settings');
  });
  it('detects table targets after Ref:', () => {
    const { doc, pos } = ctxAt('Ref: |');
    expect(detectContext(doc, pos).kind).toBe('table-target');
  });
  it('detects table targets after relation operators', () => {
    const { doc, pos } = ctxAt('Ref: posts.author_id > |');
    expect(detectContext(doc, pos).kind).toBe('table-target');
  });
  it('detects column-of-table after a dot', () => {
    const { doc, pos } = ctxAt('Ref: posts.|');
    const c = detectContext(doc, pos);
    expect(c.kind).toBe('column-of-table');
    expect(c.tableName).toBe('posts');
  });
  it('detects field-type at the second token of a table-body line', () => {
    const { doc, pos } = ctxAt('Table t {\n  title va|\n}');
    expect(detectContext(doc, pos).kind).toBe('field-type');
  });
  it('detects table-body on an empty line inside a table', () => {
    const { doc, pos } = ctxAt('Table t {\n  |\n}');
    expect(detectContext(doc, pos).kind).toBe('table-body');
  });
  it('detects top-level outside blocks', () => {
    const { doc, pos } = ctxAt('Table t {\n  id int\n}\n|');
    expect(detectContext(doc, pos).kind).toBe('top-level');
  });
  it('detects table targets inside TableGroup bodies', () => {
    const { doc, pos } = ctxAt('TableGroup core {\n  |\n}');
    expect(detectContext(doc, pos).kind).toBe('table-target');
  });
  it('returns none in the field-name position', () => {
    const { doc, pos } = ctxAt('Table t {\n  ti|\n}');
    expect(detectContext(doc, pos).kind).toBe('none');
  });
});

describe('createDbmlCompletion', () => {
  it('offers setting keywords inside brackets', () => {
    const ls = labels('Table t {\n  id integer [|]\n}');
    expect(ls).toContain('pk');
    expect(ls).toContain('not null');
    expect(ls).toContain('increment');
  });
  it('offers table names (and aliases) after Ref:', () => {
    const ls = labels('Ref: |');
    expect(ls).toContain('users');
    expect(ls).toContain('posts');
    expect(ls).toContain('P');
  });
  it('offers columns after table-dot, resolving aliases', () => {
    expect(labels('Ref: posts.|')).toEqual(expect.arrayContaining(['id', 'author_id']));
    expect(labels('Ref: P.|')).toEqual(expect.arrayContaining(['id', 'author_id']));
    expect(labels('Ref: users.|')).toEqual(expect.arrayContaining(['id', 'name']));
  });
  it('offers column types plus enum names in the type position', () => {
    const ls = labels('Table t {\n  col |\n}');
    expect(ls).toContain('varchar');
    expect(ls).toContain('timestamp');
    expect(ls).toContain('status'); // enum
  });
  it('offers block snippets at top level', () => {
    const ls = labels('|');
    expect(ls).toEqual(expect.arrayContaining(['Table', 'Ref', 'Enum', 'TableGroup']));
  });
  it('offers indexes/Note snippets in a table body', () => {
    const ls = labels('Table t {\n  |\n}');
    expect(ls).toEqual(expect.arrayContaining(['indexes', 'Note']));
  });
  it('returns nothing in the field-name position when not explicit', () => {
    expect(labels('Table t {\n  ti|\n}', false)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/editor/completion.test.ts` — Expected: FAIL (cannot resolve `./completion`).

- [ ] **Step 4: Implement**

`src/editor/completion.ts`:
```ts
import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Schema, Table } from '../core/model/types';
import { blankNoise } from './sourceMap';

export const COLUMN_TYPES = [
  'int', 'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'varchar', 'char', 'text',
  'boolean', 'bool',
  'timestamp', 'timestamptz', 'datetime', 'date', 'time',
  'decimal', 'numeric', 'float', 'double', 'real',
  'json', 'jsonb', 'uuid', 'blob', 'bytea',
];

export const SETTING_OPTIONS = [
  'pk', 'primary key', 'unique', 'not null', 'null', 'increment',
  'default: ', 'note: ', 'ref: ',
];

export type DbmlContextKind =
  | 'settings' | 'column-of-table' | 'table-target' | 'field-type'
  | 'table-body' | 'top-level' | 'none';

export interface DbmlContext {
  kind: DbmlContextKind;
  tableName?: string;
  schemaName?: string;
}

const BLOCK_OPENER_RE = /(table|enum|tablegroup|indexes|project|note|ref)\s*(?:"[^"]*"|[\w.]+)?\s*(?:as\s+\w+\s*)?(?:\[[^\]]*\]\s*)?\{$/i;

/** Which block keyword encloses `pos`? Returns lowercase keyword or null (top level). */
function enclosingBlock(blanked: string, pos: number): string | null {
  const stack: string[] = [];
  for (let i = 0; i < pos; i++) {
    const ch = blanked[i];
    if (ch === '{') {
      const before = blanked.slice(Math.max(0, i - 80), i + 1).trimEnd();
      const m = BLOCK_OPENER_RE.exec(before);
      stack.push(m ? m[1].toLowerCase() : '?');
    } else if (ch === '}') {
      stack.pop();
    }
  }
  return stack.length ? stack[stack.length - 1] : null;
}

export function detectContext(text: string, pos: number): DbmlContext {
  const blanked = blankNoise(text);
  const lineStart = blanked.lastIndexOf('\n', pos - 1) + 1;
  const linePrefix = blanked.slice(lineStart, pos);

  // settings: unclosed '[' on this line before the cursor
  const opens = (linePrefix.match(/\[/g) ?? []).length;
  const closes = (linePrefix.match(/\]/g) ?? []).length;
  if (opens > closes) return { kind: 'settings' };

  // column-of-table: word(.word)? '.' partial-word at cursor
  const dotMatch = /(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\.\w*$/.exec(linePrefix);
  if (dotMatch) {
    return { kind: 'column-of-table', tableName: dotMatch[2], schemaName: dotMatch[1] };
  }

  const block = enclosingBlock(blanked, pos);
  const trimmed = linePrefix.trimStart();

  // Ref targets: "Ref:", "Ref name:", or after a relation operator
  if (/^ref\b[^:]*:\s*[\w."]*$/i.test(trimmed)) return { kind: 'table-target' };
  if (/[<>-]\s*[\w."]*$/.test(trimmed) && (block === 'ref' || /^ref\b/i.test(trimmed) || block === null))
    return { kind: 'table-target' };
  if (block === 'ref') return { kind: 'table-target' };
  if (block === 'tablegroup') return { kind: 'table-target' };

  if (block === 'table') {
    // field-type: exactly one word already typed, then whitespace, then (partial) cursor word
    if (/^[A-Za-z_"][\w"]*\s+[\w()]*$/.test(trimmed)) return { kind: 'field-type' };
    if (trimmed === '') return { kind: 'table-body' };
    return { kind: 'none' }; // field-name position or beyond
  }
  if (block === null) {
    if (/^[\w]*$/.test(trimmed)) return { kind: 'top-level' };
    return { kind: 'none' };
  }
  return { kind: 'none' }; // enum/indexes/project/unknown bodies
}

function tableCompletions(schema: Schema): Completion[] {
  const out: Completion[] = [];
  for (const t of schema.tables) {
    out.push({
      label: t.name,
      type: 'class',
      detail: t.schemaName !== 'public' ? t.schemaName : undefined,
      apply: t.schemaName === 'public' ? t.name : `${t.schemaName}.${t.name}`,
    });
    if (t.alias) out.push({ label: t.alias, type: 'class', detail: `alias of ${t.name}` });
  }
  return out;
}

function resolveTable(schema: Schema, ctx: DbmlContext): Table | undefined {
  return schema.tables.find((t) => {
    if (ctx.schemaName) return t.schemaName === ctx.schemaName && t.name === ctx.tableName;
    return t.name === ctx.tableName || t.alias === ctx.tableName;
  });
}

const TOP_SNIPPETS: Completion[] = [
  snippetCompletion('Table ${name} {\n  id integer [pk]\n  ${}\n}', { label: 'Table', type: 'keyword', detail: 'block' }),
  snippetCompletion('Ref: ${from_table}.${from_column} > ${to_table}.${to_column}', { label: 'Ref', type: 'keyword', detail: 'relationship' }),
  snippetCompletion('Enum ${name} {\n  ${value}\n}', { label: 'Enum', type: 'keyword', detail: 'block' }),
  snippetCompletion('TableGroup ${name} {\n  ${}\n}', { label: 'TableGroup', type: 'keyword', detail: 'block' }),
  snippetCompletion("Note ${name} {\n  '${content}'\n}", { label: 'Note', type: 'keyword', detail: 'sticky note' }),
];

const TABLE_BODY_SNIPPETS: Completion[] = [
  snippetCompletion('indexes {\n  (${columns})\n}', { label: 'indexes', type: 'keyword', detail: 'block' }),
  snippetCompletion("Note: '${text}'", { label: 'Note', type: 'keyword', detail: 'table note' }),
];

export function createDbmlCompletion(getSchema: () => Schema) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w]*/);
    const from = word ? word.from : context.pos;
    if (!context.explicit && word && word.from === word.to) return null;

    const dctx = detectContext(context.state.doc.toString(), context.pos);
    const schema = getSchema();

    switch (dctx.kind) {
      case 'settings':
        return { from, options: SETTING_OPTIONS.map((s) => ({ label: s, type: 'keyword' })) };
      case 'table-target':
        return { from, options: tableCompletions(schema) };
      case 'column-of-table': {
        const table = resolveTable(schema, dctx);
        if (!table) return null;
        return { from, options: table.fields.map((f) => ({ label: f.name, type: 'property', detail: f.type })) };
      }
      case 'field-type': {
        const types: Completion[] = COLUMN_TYPES.map((t) => ({ label: t, type: 'type' }));
        const enums: Completion[] = schema.enums.map((e) => ({ label: e.name, type: 'enum', detail: 'enum' }));
        return { from, options: [...types, ...enums] };
      }
      case 'top-level':
        return { from, options: TOP_SNIPPETS };
      case 'table-body':
        return { from, options: TABLE_BODY_SNIPPETS };
      case 'none':
        return null;
    }
  };
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run src/editor/completion.test.ts` — Expected: PASS (16 tests). If a `detectContext` case disagrees with an assertion, fix the detection logic, not the test.

- [ ] **Step 6: Full suite + commit**

```bash
npx vitest run && git add -A && git commit -m "feat: schema-aware dbml completion source"
```

---

### Task 4: Format document (pure, comment-preserving)

**Files:**
- Create: `src/core/format/formatDbml.ts`
- Test: `src/core/format/formatDbml.test.ts`

**Interfaces:**
- Produces: `formatDbmlSource(source: string): string` — whitespace-only normalization: 2-space indentation by block depth, trailing-whitespace strip, blank-run collapse to one line, exactly one space before a trailing `{`. Triple-quoted string bodies and block-comment interiors are passed through verbatim. Idempotent.

- [ ] **Step 1: Write the failing test**

`src/core/format/formatDbml.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatDbmlSource } from './formatDbml';

describe('formatDbmlSource', () => {
  it('normalizes indentation by block depth', () => {
    const src = 'Table users{\nid integer [pk]\n      name varchar\n indexes {\n(id)\n }\n}';
    expect(formatDbmlSource(src)).toBe(
      'Table users {\n  id integer [pk]\n  name varchar\n  indexes {\n    (id)\n  }\n}',
    );
  });
  it('preserves comments with correct indentation', () => {
    const src = 'Table t {\n// keep me\nid int\n}';
    expect(formatDbmlSource(src)).toBe('Table t {\n  // keep me\n  id int\n}');
  });
  it('passes triple-quoted bodies through verbatim (no reindent, braces ignored)', () => {
    const src = "Table t {\n  Note: '''\n   { weird }  \n  '''\n  id int\n}";
    const out = formatDbmlSource(src);
    expect(out).toContain('   { weird }  ');
    expect(out.endsWith('}')).toBe(true);
    expect(out).toContain('  id int');
  });
  it('collapses runs of blank lines to one and strips trailing whitespace', () => {
    const src = 'Table a {\n  id int   \n}\n\n\n\nTable b {\n  id int\n}';
    expect(formatDbmlSource(src)).toBe('Table a {\n  id int\n}\n\nTable b {\n  id int\n}');
  });
  it('is idempotent', () => {
    const src = 'Table users{\nid integer\n}\n\n\nRef: a.b > c.d';
    const once = formatDbmlSource(src);
    expect(formatDbmlSource(once)).toBe(once);
  });
  it('never changes non-whitespace content', () => {
    const src = "Table t {\n  s varchar [default: 'a  {  b']\n}";
    const strip = (s: string) => s.replace(/[ \t]+/g, '');
    expect(strip(formatDbmlSource(src))).toBe(strip(src));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/core/format` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/core/format/formatDbml.ts`:
```ts
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

export function formatDbmlSource(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  const state = { inTriple: false, inBlockComment: false };
  let depth = 0;
  let blankRun = 0;

  for (const raw of lines) {
    if (state.inTriple || state.inBlockComment) {
      // verbatim passthrough; scrub only to detect the closer
      scrubLine(raw, state);
      out.push(raw);
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

    for (const ch of scrubbed) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  // drop a trailing blank line introduced by collapsing, keep original final-newline shape
  while (out.length > 1 && out[out.length - 1] === '' && !source.endsWith('\n')) out.pop();
  return out.join('\n');
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/core/format` — Expected: PASS (6 tests). The space-before-brace and closer-dedent cases are the fiddly ones; iterate on the implementation until green without weakening tests.

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && git add src/core/format && git commit -m "feat: whitespace-only dbml formatter"
```

---

### Task 5: Editor navigation module

**Files:**
- Create: `src/editor/editorNav.ts`
- Test: `src/editor/editorNav.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: `buildTableRanges`, `rangeForTable` (Task 1), `formatDbmlSource` (Task 4), `useAppStore` (app).
- Produces:
  - `registerEditorView(view: EditorView | null): void`
  - `posFromLineCol(doc: Text, line: number, column: number): number` (pure; clamps out-of-range)
  - `revealRange(from: number, to: number): void` — selects + scrolls to center + focuses
  - `revealPosition(line: number, column: number): void`
  - `revealTable(tableId: string): void` — selects the table's header
  - `applyFormat(): boolean` — formats the registered view's doc via a single dispatched change (undoable); returns false and does nothing when `stale`/errors present or no view.

- [ ] **Step 1: Write the failing test (pure part)**

`src/editor/editorNav.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { posFromLineCol } from './editorNav';

describe('posFromLineCol', () => {
  const doc = Text.of(['Table users {', '  id integer', '}']);
  it('maps 1-based line/column to an offset', () => {
    expect(posFromLineCol(doc, 2, 3)).toBe(doc.line(2).from + 2);
  });
  it('clamps line and column into range', () => {
    expect(posFromLineCol(doc, 99, 1)).toBe(doc.line(3).from);
    expect(posFromLineCol(doc, 2, 999)).toBe(doc.line(2).to);
    expect(posFromLineCol(doc, 0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/editor/editorNav.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/editor/editorNav.ts`:
```ts
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
```

- [ ] **Step 4: Verify pass + typecheck** — `npx vitest run src/editor && npx tsc --noEmit` — Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/editorNav.ts src/editor/editorNav.test.ts && git commit -m "feat: editor navigation module (reveal, format entry point)"
```

---

### Task 6: Wire the editor — autocomplete, format keybinding, cursor→canvas focus

**Files:**
- Modify: `src/editor/DbmlEditor.tsx`

**Interfaces:**
- Consumes: `createDbmlCompletion` (Task 3), `registerEditorView`/`applyFormat` (Task 5), `buildTableRanges`/`tableAtPos` (Task 1), `setEditorFocusTable` (Task 2).
- Produces: the editor now (a) autocompletes via the language-data route (basicSetup's `autocompletion()` picks it up), (b) formats on Mod-Shift-f, (c) registers itself with editorNav, (d) tracks the cursor's enclosing table into `store.editorFocusTableId` (150 ms debounce).

- [ ] **Step 1: Implement** — in `src/editor/DbmlEditor.tsx`:

Add imports:
```tsx
import { keymap } from '@codemirror/view';
import { createDbmlCompletion } from './completion';
import { registerEditorView, applyFormat } from './editorNav';
import { buildTableRanges, tableAtPos } from './sourceMap';
```

Inside the mount effect, extend the `extensions` array (after `dbmlLanguage`):
```tsx
dbmlLanguage.data.of({
  autocomplete: createDbmlCompletion(() => useAppStore.getState().schema),
}),
keymap.of([{ key: 'Mod-Shift-f', run: () => applyFormat() }]),
```

Add cursor tracking — inside the same mount effect, before `return`:
```tsx
let focusTimer: ReturnType<typeof setTimeout> | null = null;
const trackFocus = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged) return;
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    const pos = view.state.selection.main.head;
    const range = tableAtPos(buildTableRanges(view.state.doc.toString()), pos);
    useAppStore.getState().setEditorFocusTable(range?.tableId ?? null);
  }, 150);
});
```
Register `trackFocus` in the extensions array, call `registerEditorView(view)` right after the view is created, and in the cleanup add `registerEditorView(null)` and `if (focusTimer) clearTimeout(focusTimer)`.

Note the ordering constraint: `trackFocus` references `view`, which is assigned by `new EditorView({...})` — declare the listener as a `const` BEFORE constructing the view only if it does not dereference `view` at definition time (it dereferences inside the callback, which runs post-construction — safe). Compose the extensions array inline in the `EditorView` constructor as Plan 1 does.

- [ ] **Step 2: Verify** — `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean.

- [ ] **Step 3: Manual verify (dev server)**

1. Type `Table t {` newline `  id ` — completion popup offers types (`integer`, …) and any enums; accept with Enter/Tab.
2. In `Ref: ` position, Ctrl-Space offers table names; typing `posts.` offers its columns.
3. Inside `[` brackets: setting keywords offered.
4. Mod-Shift-f (Cmd-Shift-f on macOS) reindents a messy but valid doc; with a syntax error present it does nothing.
5. Clicking into different table bodies highlights nothing on canvas YET (Task 8 renders it) — confirm no console errors while moving the cursor.

- [ ] **Step 4: Commit**

```bash
git add src/editor/DbmlEditor.tsx && git commit -m "feat: wire autocomplete, format keybinding, cursor table tracking"
```

---

### Task 7: Problems panel + Format button

**Files:**
- Create: `src/app/ProblemsPanel.tsx`
- Modify: `src/app/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `useAppStore` errors/stale, `revealPosition` + `applyFormat` (Task 5).
- Produces: `<ProblemsPanel />` — renders nothing when no errors; otherwise a slim bar `⚠ N problem(s) ▸/▾` that toggles a scrollable list; clicking an entry jumps the editor to its line/col. App toolbar gains a `Format` button disabled while `stale || errors.length > 0`.

- [ ] **Step 1: Implement**

`src/app/ProblemsPanel.tsx`:
```tsx
import { useState } from 'react';
import { useAppStore } from './store';
import { revealPosition } from '../editor/editorNav';

export function ProblemsPanel() {
  const errors = useAppStore((s) => s.errors);
  const [open, setOpen] = useState(true);
  if (errors.length === 0) return null;
  return (
    <div className="problems-panel">
      <button className="problems-header" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {errors.length} problem{errors.length > 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="problems-list">
          {errors.map((e, i) => (
            <li key={`${e.line}:${e.column}:${i}`}>
              <button onClick={() => revealPosition(e.line, e.column)}>
                <span className="problem-loc">{e.line}:{e.column}</span> {e.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

In `src/app/App.tsx`: import `{ ProblemsPanel }` and `{ applyFormat }` (from `../editor/editorNav`); add to the toolbar (after `<DiagramManager />`):
```tsx
<button
  className="format-button"
  disabled={stale || errors.length > 0}
  title="Format document (Ctrl/Cmd-Shift-F)"
  onClick={() => applyFormat()}
>
  Format
</button>
```
Mount `<ProblemsPanel />` between `<SplitPane …/>` and the `<footer className="statusbar">`.

Append to `src/styles.css`:
```css
.format-button:disabled { opacity: 0.45; cursor: not-allowed; }
.problems-panel { border-top: 1px solid var(--border); background: #fff6f6; font-size: 12px; }
.problems-header { display: block; width: 100%; text-align: left; border: none; background: none; padding: 4px 12px; cursor: pointer; color: var(--error); font-weight: 600; }
.problems-list { list-style: none; margin: 0; padding: 0 0 4px; max-height: 110px; overflow-y: auto; }
.problems-list button { border: none; background: none; cursor: pointer; padding: 2px 16px; width: 100%; text-align: left; }
.problems-list button:hover { background: #ffecec; }
.problem-loc { color: var(--text-dim); font-family: ui-monospace, monospace; margin-right: 6px; }
```

- [ ] **Step 2: Verify** — `npx vitest run && npm run build` — green/clean. Manual: break the syntax → panel appears with positioned entries; clicking one moves the editor cursor there; fixing the code removes the panel; Format button disables during errors and reformats when clean (undo restores in one Ctrl-Z).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: problems panel with click-to-jump, format button"
```

---

### Task 8: Canvas side of two-way navigation

**Files:**
- Modify: `src/canvas/TableNode.tsx`, `src/canvas/DiagramCanvas.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `editorFocusTableId` (Task 2), `revealTable` (Task 5).
- Produces: `TableNode` props gain `focused: boolean` and `onOpenInEditor: (id: string) => void`; a focused table gets class `table-node focused` (accent outline); double-clicking a table calls `onOpenInEditor(table.id)` → `revealTable`.

- [ ] **Step 1: Implement**

`src/canvas/TableNode.tsx`: add to `Props`: `focused: boolean;` and `onOpenInEditor: (id: string) => void;`. On the root `<g>`: `className={`table-node${focused ? ' focused' : ''}`}` and `onDoubleClick={() => onOpenInEditor(table.id)}`.

`src/canvas/DiagramCanvas.tsx`: add
```tsx
import { revealTable } from '../editor/editorNav';
```
read `const editorFocusTableId = useAppStore((s) => s.editorFocusTableId);` and pass to each node:
```tsx
focused={t.id === editorFocusTableId}
onOpenInEditor={revealTable}
```
(`revealTable` is a module-level function — referentially stable, memo-safe.)

Append to `src/styles.css`:
```css
.table-node.focused .table-body { stroke: var(--accent); stroke-width: 2; }
```

- [ ] **Step 2: Verify** — `npx vitest run && npx tsc --noEmit && npm run build` — green/clean. Manual: caret inside `Table posts {...}` code → the posts node gets a blue outline ~150 ms later; caret outside any table clears it; double-click a table on canvas → editor scrolls to and selects its `Table …` header, focused.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: two-way editor-canvas navigation (focus highlight, double-click reveal)"
```

---

### Task 9: Integration pass

**Files:** none new.

- [ ] **Step 1: Full verification**

Run: `npx vitest run` — Expected: all tests pass (~85+).
Run: `npm run build` — Expected: clean; main-chunk gzip size within a few kB of Plan 1's 194 kB (autocomplete is small; the parser stays out of the main chunk).

- [ ] **Step 2: Constraint audit**

```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output.

- [ ] **Step 3: Browser walkthrough**

Dev server: completion in all five contexts; format round-trip with comments intact; problems panel jump; cursor↔canvas focus both directions; then regression sweep: drag/pan/zoom, diagram switch, reload-restore.

- [ ] **Step 4: Commit + tag**

```bash
git add -A && git commit -m "chore: plan 2 complete — editor depth" --allow-empty
git tag plan-2-complete
```
