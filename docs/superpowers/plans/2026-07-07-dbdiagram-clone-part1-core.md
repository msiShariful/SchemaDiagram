# dbdiagram Clone — Plan 1: Foundation & Core Diagram

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working local-first DBML editor: type DBML on the left, see a live ER diagram on the right, drag tables, pan/zoom, and have everything autosaved to IndexedDB across unlimited diagrams.

**Architecture:** Spec milestones 1–2 of `docs/superpowers/specs/2026-07-07-dbdiagram-clone-design.md`. `@dbml/core` parses DBML in a Web Worker (sync fallback); the canvas always renders the last good parse. A zustand store holds `source` / `schema` / `layout` slices; `core/` is pure TypeScript with zero React imports. Canvas is hand-rolled SVG; pan/zoom/drag bypass React via refs.

**Tech Stack:** React 19, TypeScript (strict), Vite, zustand, @dbml/core, CodeMirror 6, idb, nanoid, vitest, fake-indexeddb.

**Follow-up plans (not here):** Plan 2 editor depth (autocomplete, two-way nav, format), Plan 3 canvas depth (LOD, culling, minimap, snap/guides, groups, notes, auto-layout, theme), Plan 4 interop (SQL/PNG/SVG, snapshots), Plan 5 hardening (Playwright E2E, perf CI).

## Global Constraints

- TypeScript `strict: true`; no `any` except at the `@dbml/core` error boundary (`normalizeErrors`).
- Files under `src/core/` MUST NOT import React, zustand, or anything from `src/app|editor|canvas`.
- The canvas renders the **last good parse**; parse failure never clears `schema` or `positions`.
- Canvas-originated changes write only layout data — never DBML text.
- All geometry derives from constants in `src/core/model/geometry.ts` (deterministic, testable).
- Test runner is vitest (`npm test`); every task ends with all tests green and a commit.
- Working directory: `/Users/sharif/Documents/dbdiagram` (repo root; app lives at root, not a subfolder).
- Node ≥ 20, npm. Do not pin exact dependency versions; install latest.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `src/main.tsx`, `src/app/App.tsx`, `src/styles.css`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test`; `App` shell with `.app-shell/.editor-pane/.canvas-pane` layout that later tasks fill in.

- [ ] **Step 1: Write scaffold files**

`package.json`:
```json
{
  "name": "dbdiagram-clone",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  }
}
```

`.gitignore`:
```
node_modules
dist
*.local
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DBDraft — database diagrams</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/app/App.tsx`:
```tsx
export function App() {
  return (
    <div className="app-shell">
      <header className="toolbar">
        <span className="brand">DBDraft</span>
      </header>
      <main className="workspace">
        <section className="editor-pane">editor</section>
        <div className="divider" />
        <section className="canvas-pane">canvas</section>
      </main>
    </div>
  );
}
```

`src/styles.css`:
```css
:root {
  --bg: #ffffff;
  --bg-panel: #f6f7f9;
  --border: #d9dde3;
  --text: #1f2430;
  --text-dim: #6b7280;
  --accent: #2f6fed;
  --table-header: #3d5a80;
  --edge: #8a93a3;
  --edge-hover: #2f6fed;
  --error: #d33;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { font-family: system-ui, sans-serif; color: var(--text); background: var(--bg); }
.app-shell { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex; align-items: center; gap: 12px; padding: 6px 12px;
  border-bottom: 1px solid var(--border); background: var(--bg-panel);
}
.brand { font-weight: 700; }
.workspace { display: flex; flex: 1; min-height: 0; }
.editor-pane { width: 38%; min-width: 240px; border-right: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; }
.divider { width: 5px; cursor: col-resize; background: transparent; margin-left: -3px; z-index: 5; }
.divider:hover { background: var(--accent); opacity: 0.4; }
.canvas-pane { flex: 1; min-width: 0; position: relative; overflow: hidden; background: #fafbfc; }
```

- [ ] **Step 2: Install dependencies**

```bash
npm install react react-dom zustand @dbml/core idb nanoid codemirror @codemirror/language @codemirror/lint @codemirror/state @codemirror/view
npm install -D typescript vite @vitejs/plugin-react vitest fake-indexeddb @types/react @types/react-dom
```

- [ ] **Step 3: Verify build and test run**

Run: `npm run build` — Expected: succeeds, `dist/` created.
Run: `npm test` — Expected: exits 0 with "No test files found" (passWithNoTests).
Run: `npm run dev` briefly — Expected: page shows toolbar "DBDraft" + two panes.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: scaffold Vite + React + TS app shell"
```

---

### Task 2: Core model types & geometry

**Files:**
- Create: `src/core/model/types.ts`, `src/core/model/geometry.ts`
- Test: `src/core/model/geometry.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - Types: `Schema`, `Table`, `Field`, `Ref`, `RefEndpoint`, `EnumDef`, `TableGroup`, `StickyNote`, `TablePosition`, `Viewport`, `Rect`, `Point`, plus `EMPTY_SCHEMA: Schema`.
  - Geometry: `TABLE_WIDTH = 220`, `HEADER_HEIGHT = 32`, `ROW_HEIGHT = 28`, `tableHeight(fieldCount: number): number`, `fieldRowY(index: number): number`, `getTableRect(table: Table, pos: TablePosition): Rect`.

- [ ] **Step 1: Write the failing test**

`src/core/model/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight, fieldRowY, getTableRect } from './geometry';
import type { Table } from './types';

const table = (fieldCount: number): Table => ({
  id: 'public.users', schemaName: 'public', name: 'users', alias: null,
  headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
  })),
});

describe('geometry', () => {
  it('computes table height from field count', () => {
    expect(tableHeight(0)).toBe(HEADER_HEIGHT);
    expect(tableHeight(3)).toBe(HEADER_HEIGHT + 3 * ROW_HEIGHT);
  });
  it('centers field rows vertically', () => {
    expect(fieldRowY(0)).toBe(HEADER_HEIGHT + ROW_HEIGHT / 2);
    expect(fieldRowY(2)).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT + ROW_HEIGHT / 2);
  });
  it('builds table rect from position', () => {
    expect(getTableRect(table(2), { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: TABLE_WIDTH, h: tableHeight(2) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/model` — Expected: FAIL (cannot resolve `./geometry`).

- [ ] **Step 3: Implement**

`src/core/model/types.ts`:
```ts
export interface Field {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  increment: boolean;
  defaultValue: string | null;
  note: string | null;
  isEnum: boolean;
}

export interface Table {
  id: string; // `${schemaName}.${name}`
  schemaName: string;
  name: string;
  alias: string | null;
  headerColor: string | null;
  note: string | null;
  fields: Field[];
}

export type Relation = '1' | '*';

export interface RefEndpoint {
  tableId: string;
  fieldNames: string[];
  relation: Relation;
}

export interface Ref {
  id: string;
  from: RefEndpoint;
  to: RefEndpoint;
}

export interface EnumDef {
  id: string; // `${schemaName}.${name}`
  name: string;
  values: string[];
}

export interface TableGroup {
  id: string;
  name: string;
  tableIds: string[];
  color: string | null;
}

export interface StickyNote {
  id: string;
  name: string;
  content: string;
}

export interface Schema {
  tables: Table[];
  refs: Ref[];
  enums: EnumDef[];
  groups: TableGroup[];
  notes: StickyNote[];
}

export const EMPTY_SCHEMA: Schema = { tables: [], refs: [], enums: [], groups: [], notes: [] };

export interface TablePosition { x: number; y: number; }
export interface Viewport { x: number; y: number; zoom: number; }
export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }
```

`src/core/model/geometry.ts`:
```ts
import type { Table, TablePosition, Rect } from './types';

export const TABLE_WIDTH = 220;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 28;

export function tableHeight(fieldCount: number): number {
  return HEADER_HEIGHT + fieldCount * ROW_HEIGHT;
}

export function fieldRowY(index: number): number {
  return HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function getTableRect(table: Table, pos: TablePosition): Rect {
  return { x: pos.x, y: pos.y, w: TABLE_WIDTH, h: tableHeight(table.fields.length) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/model` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "feat: core model types and geometry constants"
```

---

### Task 3: DBML parse wrapper (`@dbml/core` → normalized Schema)

**Files:**
- Create: `src/core/parse/parseDbml.ts`
- Test: `src/core/parse/parseDbml.test.ts`

**Interfaces:**
- Consumes: `Schema`, `Table`, `Field`, `Ref`, `EnumDef` from Task 2.
- Produces:
  - `interface ParseError { message: string; line: number; column: number; }`
  - `type ParseResult = { ok: true; schema: Schema } | { ok: false; errors: ParseError[] }`
  - `parseDbml(source: string): ParseResult`

**Note for implementer:** the normalizer walks `@dbml/core`'s parsed `Database` object. If a test fails because a property name differs in the installed version (e.g. `field.type.type_name`), `console.dir` the parsed object, adjust the *normalizer only*, and keep our `Schema` shape unchanged — our types are the contract, theirs are not.

- [ ] **Step 1: Write the failing test**

`src/core/parse/parseDbml.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDbml } from './parseDbml';

const SAMPLE = `
Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
  role user_role [default: 'member']
}
Table posts {
  id integer [pk]
  user_id integer [not null, note: 'author']
}
Enum user_role { admin \n member }
Ref: posts.user_id > users.id
`;

describe('parseDbml', () => {
  it('normalizes tables, fields, and ids', () => {
    const r = parseDbml(SAMPLE);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.schema.tables.map((t) => t.id).sort()).toEqual(['public.posts', 'public.users']);
    const users = r.schema.tables.find((t) => t.id === 'public.users')!;
    expect(users.fields.map((f) => f.name)).toEqual(['id', 'username', 'role']);
    expect(users.fields[0]).toMatchObject({ pk: true, increment: true });
    expect(users.fields[1]).toMatchObject({ notNull: true, unique: true });
    expect(users.fields[2].isEnum).toBe(true);
    expect(users.fields[2].defaultValue).toBe('member');
    const posts = r.schema.tables.find((t) => t.id === 'public.posts')!;
    expect(posts.fields[1].note).toBe('author');
  });

  it('normalizes refs with endpoints and relations', () => {
    const r = parseDbml(SAMPLE);
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.refs).toHaveLength(1);
    const ref = r.schema.refs[0];
    const endpoints = [ref.from, ref.to];
    const many = endpoints.find((e) => e.relation === '*')!;
    const one = endpoints.find((e) => e.relation === '1')!;
    expect(many.tableId).toBe('public.posts');
    expect(many.fieldNames).toEqual(['user_id']);
    expect(one.tableId).toBe('public.users');
  });

  it('normalizes enums', () => {
    const r = parseDbml(SAMPLE);
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.enums).toEqual([{ id: 'public.user_role', name: 'user_role', values: ['admin', 'member'] }]);
  });

  it('supports multiple schemas in table ids', () => {
    const r = parseDbml('Table shop.orders { id int [pk] }');
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.tables[0].id).toBe('shop.orders');
  });

  it('returns positioned errors for invalid source', () => {
    const r = parseDbml('Table users {\n  id integer [pk\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].line).toBeGreaterThanOrEqual(1);
    expect(r.errors[0].message).toBeTruthy();
  });

  it('parses empty source to an empty schema', () => {
    const r = parseDbml('');
    if (!r.ok) throw new Error('expected ok');
    expect(r.schema.tables).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/parse` — Expected: FAIL (cannot resolve `./parseDbml`).

- [ ] **Step 3: Implement**

`src/core/parse/parseDbml.ts`:
```ts
import { Parser } from '@dbml/core';
import type { Schema, Table, Field, Ref, RefEndpoint, EnumDef, Relation } from '../model/types';

export interface ParseError { message: string; line: number; column: number; }
export type ParseResult = { ok: true; schema: Schema } | { ok: false; errors: ParseError[] };

export function parseDbml(source: string): ParseResult {
  try {
    const db = new Parser().parse(source, 'dbml');
    return { ok: true, schema: normalizeDatabase(db) };
  } catch (e) {
    return { ok: false, errors: normalizeErrors(e) };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeDatabase(db: any): Schema {
  const tables: Table[] = [];
  const refs: Ref[] = [];
  const enums: EnumDef[] = [];
  const enumNames = new Set<string>();

  for (const schema of db.schemas ?? []) {
    const schemaName: string = schema.name ?? 'public';
    for (const en of schema.enums ?? []) {
      enums.push({
        id: `${schemaName}.${en.name}`,
        name: en.name,
        values: (en.values ?? []).map((v: any) => v.name),
      });
      enumNames.add(en.name);
    }
  }

  for (const schema of db.schemas ?? []) {
    const schemaName: string = schema.name ?? 'public';
    for (const t of schema.tables ?? []) {
      const fields: Field[] = (t.fields ?? []).map((f: any) => ({
        name: f.name,
        type: f.type?.type_name ?? String(f.type ?? ''),
        pk: !!f.pk,
        unique: !!f.unique,
        notNull: !!f.not_null,
        increment: !!f.increment,
        defaultValue: f.dbdefault != null ? String(f.dbdefault.value) : null,
        note: f.note ? String(f.note) : null,
        isEnum: enumNames.has(f.type?.type_name ?? ''),
      }));
      tables.push({
        id: `${schemaName}.${t.name}`,
        schemaName,
        name: t.name,
        alias: t.alias ?? null,
        headerColor: t.headerColor ?? null,
        note: t.note ? String(t.note) : null,
        fields,
      });
    }
    for (const r of schema.refs ?? []) {
      const eps = (r.endpoints ?? []).map((ep: any): RefEndpoint => ({
        tableId: `${ep.schemaName ?? schemaName}.${ep.tableName}`,
        fieldNames: ep.fieldNames ?? [],
        relation: (ep.relation === '1' ? '1' : '*') as Relation,
      }));
      if (eps.length === 2) {
        refs.push({ id: `ref-${refs.length}-${eps[0].tableId}-${eps[1].tableId}`, from: eps[0], to: eps[1] });
      }
    }
  }
  return { tables, refs, enums, groups: [], notes: [] }; // groups/notes normalized in Plan 3 (canvas depth)
}

function normalizeErrors(e: unknown): ParseError[] {
  const err = e as { diags?: Array<{ message?: string; location?: { start?: { line?: number; column?: number } } }>; message?: string };
  if (Array.isArray(err?.diags) && err.diags.length > 0) {
    return err.diags.map((d) => ({
      message: d.message ?? 'Syntax error',
      line: d.location?.start?.line ?? 1,
      column: d.location?.start?.column ?? 1,
    }));
  }
  return [{ message: err?.message ?? 'Unknown parse error', line: 1, column: 1 }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/parse` — Expected: PASS (6 tests). If a property-name assertion fails, follow the implementer note above.

- [ ] **Step 5: Commit**

```bash
git add src/core/parse && git commit -m "feat: dbml parse wrapper with normalized schema and errors"
```

---

### Task 4: Position reconciliation (rename heuristic + pruning)

**Files:**
- Create: `src/core/model/reconcile.ts`
- Test: `src/core/model/reconcile.test.ts`

**Interfaces:**
- Consumes: `Schema`, `TablePosition` (Task 2).
- Produces: `reconcilePositions(prev: Schema, next: Schema, positions: Record<string, TablePosition>): Record<string, TablePosition>` — returns positions for `next`'s tables only (pruned), transferring a removed table's position to an added table with the identical field-name signature (rename detection). Does NOT place brand-new tables (Task 5 does).

- [ ] **Step 1: Write the failing test**

`src/core/model/reconcile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { reconcilePositions } from './reconcile';
import type { Schema, Table } from './types';

const mkTable = (name: string, fieldNames: string[]): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: fieldNames.map((n) => ({
    name: n, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
  })),
});
const mkSchema = (tables: Table[]): Schema => ({ tables, refs: [], enums: [], groups: [], notes: [] });

describe('reconcilePositions', () => {
  it('keeps positions of surviving tables and prunes deleted ones', () => {
    const prev = mkSchema([mkTable('a', ['id']), mkTable('b', ['id'])]);
    const next = mkSchema([mkTable('a', ['id'])]);
    const out = reconcilePositions(prev, next, { 'public.a': { x: 1, y: 2 }, 'public.b': { x: 3, y: 4 } });
    expect(out).toEqual({ 'public.a': { x: 1, y: 2 } });
  });

  it('transfers position across a rename (same field signature)', () => {
    const prev = mkSchema([mkTable('users', ['id', 'email'])]);
    const next = mkSchema([mkTable('members', ['id', 'email'])]);
    const out = reconcilePositions(prev, next, { 'public.users': { x: 100, y: 50 } });
    expect(out['public.members']).toEqual({ x: 100, y: 50 });
    expect(out['public.users']).toBeUndefined();
  });

  it('does not transfer when signatures differ', () => {
    const prev = mkSchema([mkTable('users', ['id', 'email'])]);
    const next = mkSchema([mkTable('members', ['id', 'name'])]);
    const out = reconcilePositions(prev, next, { 'public.users': { x: 100, y: 50 } });
    expect(out['public.members']).toBeUndefined();
  });

  it('transfers at most once per removed table', () => {
    const prev = mkSchema([mkTable('users', ['id'])]);
    const next = mkSchema([mkTable('members', ['id']), mkTable('people', ['id'])]);
    const out = reconcilePositions(prev, next, { 'public.users': { x: 9, y: 9 } });
    const transferred = ['public.members', 'public.people'].filter((id) => out[id]);
    expect(transferred).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/model/reconcile.test.ts` — Expected: FAIL (cannot resolve `./reconcile`).

- [ ] **Step 3: Implement**

`src/core/model/reconcile.ts`:
```ts
import type { Schema, Table, TablePosition } from './types';

function signature(t: Table): string {
  return `${t.schemaName}|${[...t.fields.map((f) => f.name)].sort().join(',')}`;
}

export function reconcilePositions(
  prev: Schema,
  next: Schema,
  positions: Record<string, TablePosition>,
): Record<string, TablePosition> {
  const nextIds = new Set(next.tables.map((t) => t.id));
  const out: Record<string, TablePosition> = {};
  for (const id of Object.keys(positions)) {
    if (nextIds.has(id)) out[id] = positions[id];
  }

  const removed = prev.tables.filter((t) => !nextIds.has(t.id) && positions[t.id]);
  const added = next.tables.filter((t) => !out[t.id]);
  const removedBySig = new Map<string, Table[]>();
  for (const t of removed) {
    const sig = signature(t);
    removedBySig.set(sig, [...(removedBySig.get(sig) ?? []), t]);
  }
  for (const t of added) {
    const candidates = removedBySig.get(signature(t));
    const match = candidates?.shift();
    if (match) out[t.id] = positions[match.id];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/model/reconcile.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/model && git commit -m "feat: position reconciliation with rename heuristic"
```

---

### Task 5: Incremental placement of new tables

**Files:**
- Create: `src/core/layout/placement.ts`
- Test: `src/core/layout/placement.test.ts`

**Interfaces:**
- Consumes: `Schema`, `TablePosition`, `Rect` (Task 2), `getTableRect`, `TABLE_WIDTH` (Task 2).
- Produces: `placeNewTables(schema: Schema, positions: Record<string, TablePosition>): Record<string, TablePosition>` — positions for tables missing from `positions`, chosen next to a ref-connected placed table when possible, else first free grid-scan spot. Never overlaps placed rects (40px margin). Deterministic.

- [ ] **Step 1: Write the failing test**

`src/core/layout/placement.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { placeNewTables } from './placement';
import { getTableRect } from '../model/geometry';
import type { Schema, Table, Rect } from '../model/types';

const mkTable = (name: string, fieldCount = 3): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
  })),
});
const ref = (a: string, b: string) => ({
  id: `r-${a}-${b}`,
  from: { tableId: `public.${a}`, fieldNames: ['f0'], relation: '*' as const },
  to: { tableId: `public.${b}`, fieldNames: ['f0'], relation: '1' as const },
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeNewTables', () => {
  it('places all unplaced tables without overlap', () => {
    const tables = Array.from({ length: 12 }, (_, i) => mkTable(`t${i}`));
    const schema: Schema = { tables, refs: [], enums: [], groups: [], notes: [] };
    const placed = placeNewTables(schema, {});
    expect(Object.keys(placed)).toHaveLength(12);
    const rects = tables.map((t) => getTableRect(t, placed[t.id]));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(overlaps(rects[i], rects[j])).toBe(false);
  });

  it('is deterministic', () => {
    const schema: Schema = { tables: [mkTable('a'), mkTable('b')], refs: [], enums: [], groups: [], notes: [] };
    expect(placeNewTables(schema, {})).toEqual(placeNewTables(schema, {}));
  });

  it('does not move already-placed tables', () => {
    const schema: Schema = { tables: [mkTable('a'), mkTable('b')], refs: [], enums: [], groups: [], notes: [] };
    const placed = placeNewTables(schema, { 'public.a': { x: 500, y: 500 } });
    expect(placed['public.a']).toBeUndefined(); // only NEW positions returned
    expect(placed['public.b']).toBeDefined();
  });

  it('places a ref-connected table near its placed neighbor', () => {
    const schema: Schema = {
      tables: [mkTable('users'), mkTable('posts')],
      refs: [ref('posts', 'users')], enums: [], groups: [], notes: [],
    };
    const placed = placeNewTables(schema, { 'public.users': { x: 1000, y: 1000 } });
    const p = placed['public.posts'];
    const dist = Math.hypot(p.x - 1000, p.y - 1000);
    expect(dist).toBeLessThan(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/layout` — Expected: FAIL (cannot resolve `./placement`).

- [ ] **Step 3: Implement**

`src/core/layout/placement.ts`:
```ts
import type { Schema, Table, TablePosition, Rect } from '../model/types';
import { getTableRect, TABLE_WIDTH } from '../model/geometry';

const MARGIN = 40;
const GAP = 60;
const ORIGIN = 60;
const SCAN_STEP = 20;

function collides(candidate: Rect, placed: Rect[]): boolean {
  return placed.some(
    (r) =>
      candidate.x < r.x + r.w + MARGIN &&
      r.x < candidate.x + candidate.w + MARGIN &&
      candidate.y < r.y + r.h + MARGIN &&
      r.y < candidate.y + candidate.h + MARGIN,
  );
}

function neighborCandidates(n: Rect, h: number): TablePosition[] {
  const out: TablePosition[] = [];
  for (let k = 1; k <= 4; k++) {
    const gap = GAP * k;
    out.push({ x: n.x + n.w + gap, y: n.y });          // right
    out.push({ x: n.x, y: n.y + n.h + gap });          // below
    out.push({ x: n.x - gap - TABLE_WIDTH, y: n.y });  // left
    out.push({ x: n.x, y: n.y - gap - h });            // above
  }
  return out;
}

function gridScan(w: number, h: number, placed: Rect[]): TablePosition {
  for (let y = ORIGIN; y < 100_000; y += SCAN_STEP) {
    for (let x = ORIGIN; x < ORIGIN + 3000; x += SCAN_STEP) {
      if (!collides({ x, y, w, h }, placed)) return { x, y };
    }
  }
  return { x: ORIGIN, y: ORIGIN };
}

export function placeNewTables(
  schema: Schema,
  positions: Record<string, TablePosition>,
): Record<string, TablePosition> {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const allPositions: Record<string, TablePosition> = { ...positions };
  const placedRects: Rect[] = schema.tables
    .filter((t) => allPositions[t.id])
    .map((t) => getTableRect(t, allPositions[t.id]));
  const out: Record<string, TablePosition> = {};

  const neighborsOf = (table: Table): Table[] =>
    schema.refs
      .filter((r) => r.from.tableId === table.id || r.to.tableId === table.id)
      .map((r) => (r.from.tableId === table.id ? r.to.tableId : r.from.tableId))
      .filter((id) => allPositions[id])
      .map((id) => byId.get(id))
      .filter((t): t is Table => !!t);

  for (const table of schema.tables) {
    if (allPositions[table.id]) continue;
    const rect = getTableRect(table, { x: 0, y: 0 });
    let chosen: TablePosition | null = null;
    for (const n of neighborsOf(table)) {
      const nRect = getTableRect(n, allPositions[n.id]);
      for (const c of neighborCandidates(nRect, rect.h)) {
        if (!collides({ ...c, w: rect.w, h: rect.h }, placedRects)) { chosen = c; break; }
      }
      if (chosen) break;
    }
    chosen ??= gridScan(rect.w, rect.h, placedRects);
    out[table.id] = chosen;
    allPositions[table.id] = chosen;
    placedRects.push({ ...chosen, w: rect.w, h: rect.h });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/layout` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/layout && git commit -m "feat: incremental placement for new tables"
```

---

### Task 6: App store (zustand)

**Files:**
- Create: `src/app/store.ts`
- Test: `src/app/store.test.ts`

**Interfaces:**
- Consumes: `parseDbml`/`ParseResult`/`ParseError` (Task 3), `reconcilePositions` (Task 4), `placeNewTables` (Task 5), model types (Task 2), `DiagramRecord` shape (defined here, reused verbatim by Task 12).
- Produces: `useAppStore` (zustand hook, created with `subscribeWithSelector`) with state
  `{ diagramId: string | null; diagramName: string; source: string; schema: Schema; errors: ParseError[]; stale: boolean; positions: Record<string, TablePosition>; viewport: Viewport; hoveredTableId: string | null; storageUnavailable: boolean }`
  and actions
  `setSource(source: string)`, `applyParse(result: ParseResult)`, `moveTable(id: string, pos: TablePosition)`, `setViewport(v: Viewport)`, `setHoveredTable(id: string | null)`, `setDiagramName(name: string)`, `setStorageUnavailable(v: boolean)`, `loadDiagram(rec: DiagramRecord)`.
- Also produces: `interface DiagramRecord { id: string; name: string; dbml: string; positions: Record<string, TablePosition>; viewport: Viewport; updatedAt: number; }` exported from `src/app/store.ts`.

- [ ] **Step 1: Write the failing test**

`src/app/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';
import { parseDbml } from '../core/parse/parseDbml';
import { EMPTY_SCHEMA } from '../core/model/types';

const reset = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false,
  });

describe('useAppStore', () => {
  beforeEach(reset);

  it('applyParse success places new tables and clears stale', () => {
    const s = useAppStore.getState();
    s.applyParse(parseDbml('Table a { id int }\nTable b { id int }'));
    const st = useAppStore.getState();
    expect(st.schema.tables).toHaveLength(2);
    expect(st.positions['public.a']).toBeDefined();
    expect(st.positions['public.b']).toBeDefined();
    expect(st.stale).toBe(false);
    expect(st.errors).toEqual([]);
  });

  it('applyParse failure keeps last good schema and sets stale', () => {
    useAppStore.getState().applyParse(parseDbml('Table a { id int }'));
    const goodSchema = useAppStore.getState().schema;
    useAppStore.getState().applyParse(parseDbml('Table a {'));
    const st = useAppStore.getState();
    expect(st.schema).toBe(goodSchema);
    expect(st.stale).toBe(true);
    expect(st.errors.length).toBeGreaterThan(0);
  });

  it('keeps a moved table where the user put it across edits', () => {
    useAppStore.getState().applyParse(parseDbml('Table a { id int }'));
    useAppStore.getState().moveTable('public.a', { x: 777, y: 333 });
    useAppStore.getState().applyParse(parseDbml('Table a { id int }\nTable b { id int }'));
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 777, y: 333 });
  });

  it('prunes positions of deleted tables', () => {
    useAppStore.getState().applyParse(parseDbml('Table a { id int }\nTable b { id int }'));
    useAppStore.getState().applyParse(parseDbml('Table a { id int }'));
    expect(useAppStore.getState().positions['public.b']).toBeUndefined();
  });

  it('loadDiagram replaces content and marks stale until reparse', () => {
    useAppStore.getState().loadDiagram({
      id: 'd1', name: 'Shop', dbml: 'Table x { id int }',
      positions: { 'public.x': { x: 5, y: 6 } }, viewport: { x: 1, y: 2, zoom: 1.5 }, updatedAt: 123,
    });
    const st = useAppStore.getState();
    expect(st.diagramId).toBe('d1');
    expect(st.source).toBe('Table x { id int }');
    expect(st.positions['public.x']).toEqual({ x: 5, y: 6 });
    expect(st.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/store.test.ts` — Expected: FAIL (cannot resolve `./store`).

- [ ] **Step 3: Implement**

`src/app/store.ts`:
```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Schema, TablePosition, Viewport } from '../core/model/types';
import { EMPTY_SCHEMA } from '../core/model/types';
import type { ParseError, ParseResult } from '../core/parse/parseDbml';
import { reconcilePositions } from '../core/model/reconcile';
import { placeNewTables } from '../core/layout/placement';

export interface DiagramRecord {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
  updatedAt: number;
}

interface AppState {
  diagramId: string | null;
  diagramName: string;
  source: string;
  schema: Schema;
  errors: ParseError[];
  stale: boolean;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
  hoveredTableId: string | null;
  storageUnavailable: boolean;
  setSource(source: string): void;
  applyParse(result: ParseResult): void;
  moveTable(id: string, pos: TablePosition): void;
  setViewport(v: Viewport): void;
  setHoveredTable(id: string | null): void;
  setDiagramName(name: string): void;
  setStorageUnavailable(v: boolean): void;
  loadDiagram(rec: DiagramRecord): void;
}

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    diagramId: null,
    diagramName: 'Untitled',
    source: '',
    schema: EMPTY_SCHEMA,
    errors: [],
    stale: false,
    positions: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null,
    storageUnavailable: false,

    setSource: (source) => set({ source }),

    applyParse: (result) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      set({ schema: result.schema, positions: { ...kept, ...placed }, errors: [], stale: false });
    },

    moveTable: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),
    setViewport: (viewport) => set({ viewport }),
    setHoveredTable: (hoveredTableId) => set({ hoveredTableId }),
    setDiagramName: (diagramName) => set({ diagramName }),
    setStorageUnavailable: (storageUnavailable) => set({ storageUnavailable }),

    loadDiagram: (rec) =>
      set({
        diagramId: rec.id,
        diagramName: rec.name,
        source: rec.dbml,
        positions: rec.positions,
        viewport: rec.viewport,
        schema: EMPTY_SCHEMA,
        errors: [],
        stale: true, // until the parse pipeline catches up
        hoveredTableId: null,
      }),
  })),
);
```

Note: `loadDiagram` resets `schema` to empty but keeps `positions` from the record — when the pipeline re-parses the loaded source, `reconcilePositions(EMPTY, next, positions)` keeps every stored position (ids match) and prunes stale ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/store.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app && git commit -m "feat: zustand app store with parse reconciliation"
```

---

### Task 7: Parse pipeline (debounce + latest-wins + worker with sync fallback)

**Files:**
- Create: `src/core/parse/pipeline.ts`, `src/core/parse/parser.worker.ts`, `src/core/parse/workerParse.ts`, `src/app/useParsePipeline.ts`
- Test: `src/core/parse/pipeline.test.ts`

**Interfaces:**
- Consumes: `parseDbml`, `ParseResult` (Task 3), `useAppStore` (Task 6).
- Produces:
  - `createParsePipeline(opts: { parse: (source: string) => Promise<ParseResult>; onResult: (r: ParseResult) => void; debounceMs?: number }): { push(source: string): void; dispose(): void }` — debounces, only latest result is delivered (stale async results dropped).
  - `createWorkerParse(): (source: string) => Promise<ParseResult>` — Web Worker adapter; falls back to in-thread `parseDbml` if `Worker` is unavailable or errors.
  - `useParsePipeline(): void` — React hook wiring store.source → pipeline → `applyParse`.

- [ ] **Step 1: Write the failing test**

`src/core/parse/pipeline.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createParsePipeline } from './pipeline';
import type { ParseResult } from './parseDbml';

const okResult = (tag: string): ParseResult => ({
  ok: true,
  schema: { tables: [], refs: [], enums: [], groups: [], notes: [{ id: tag, name: tag, content: '' }] },
});

describe('createParsePipeline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid pushes into one parse', async () => {
    const parse = vi.fn(async (s: string) => okResult(s));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 300 });
    p.push('a'); p.push('ab'); p.push('abc');
    await vi.advanceTimersByTimeAsync(299);
    expect(parse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith('abc');
    expect(onResult).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it('drops stale results when a newer parse finishes first', async () => {
    const resolvers: Array<(r: ParseResult) => void> = [];
    const parse = vi.fn((s: string) => new Promise<ParseResult>((res) => resolvers.push((r) => res(r ?? okResult(s)))));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });
    p.push('first');
    await vi.advanceTimersByTimeAsync(10);
    p.push('second');
    await vi.advanceTimersByTimeAsync(10);
    expect(parse).toHaveBeenCalledTimes(2);
    resolvers[1](okResult('second')); // newer finishes first
    await vi.runAllTimersAsync();
    resolvers[0](okResult('first')); // stale finishes late
    await vi.runAllTimersAsync();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect((onResult.mock.calls[0][0] as ParseResult & { ok: true }).schema.notes[0].id).toBe('second');
    p.dispose();
  });

  it('delivers nothing after dispose', async () => {
    const parse = vi.fn(async (s: string) => okResult(s));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });
    p.push('a');
    p.dispose();
    await vi.runAllTimersAsync();
    expect(onResult).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/parse/pipeline.test.ts` — Expected: FAIL (cannot resolve `./pipeline`).

- [ ] **Step 3: Implement**

`src/core/parse/pipeline.ts`:
```ts
import type { ParseResult } from './parseDbml';

export interface ParsePipeline {
  push(source: string): void;
  dispose(): void;
}

export function createParsePipeline(opts: {
  parse: (source: string) => Promise<ParseResult>;
  onResult: (r: ParseResult) => void;
  debounceMs?: number;
}): ParsePipeline {
  const debounceMs = opts.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let disposed = false;

  return {
    push(source: string) {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const mySeq = ++seq;
        void opts.parse(source).then((result) => {
          if (!disposed && mySeq === seq) opts.onResult(result);
        });
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
```

`src/core/parse/parser.worker.ts`:
```ts
import { parseDbml } from './parseDbml';

self.onmessage = (e: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = e.data;
  (self as unknown as Worker).postMessage({ id, result: parseDbml(source) });
};
```

`src/core/parse/workerParse.ts`:
```ts
import { parseDbml, type ParseResult } from './parseDbml';

export function createWorkerParse(): (source: string) => Promise<ParseResult> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return async (source) => parseDbml(source); // no Worker support → in-thread
  }
  let nextId = 0;
  const pending = new Map<number, { source: string; resolve: (r: ParseResult) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; result: ParseResult }>) => {
    pending.get(e.data.id)?.resolve(e.data.result);
    pending.delete(e.data.id);
  };
  worker.onerror = () => {
    // Worker died: answer everything in-flight on the main thread instead.
    for (const [id, p] of pending) {
      p.resolve(parseDbml(p.source));
      pending.delete(id);
    }
  };
  return (source) =>
    new Promise<ParseResult>((resolve) => {
      const id = nextId++;
      pending.set(id, { source, resolve });
      worker.postMessage({ id, source });
    });
}
```

`src/app/useParsePipeline.ts`:
```tsx
import { useEffect } from 'react';
import { useAppStore } from './store';
import { createParsePipeline } from '../core/parse/pipeline';
import { createWorkerParse } from '../core/parse/workerParse';

export function useParsePipeline(): void {
  useEffect(() => {
    const pipeline = createParsePipeline({
      parse: createWorkerParse(),
      onResult: (r) => useAppStore.getState().applyParse(r),
      debounceMs: 300,
    });
    pipeline.push(useAppStore.getState().source);
    const unsub = useAppStore.subscribe(
      (s) => s.source,
      (source) => pipeline.push(source),
    );
    return () => {
      unsub();
      pipeline.dispose();
    };
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/parse` — Expected: PASS (pipeline 3 tests + parseDbml 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/parse src/app/useParsePipeline.ts && git commit -m "feat: debounced latest-wins parse pipeline with worker + sync fallback"
```

---

### Task 8: DBML syntax highlighting + editor component

**Files:**
- Create: `src/editor/dbmlLanguage.ts`, `src/editor/diagnostics.ts`, `src/editor/DbmlEditor.tsx`
- Test: `src/editor/dbmlLanguage.test.ts`, `src/editor/diagnostics.test.ts`

**Interfaces:**
- Consumes: `useAppStore` (Task 6), `ParseError` (Task 3).
- Produces:
  - `dbmlLanguage: LanguageSupport`-compatible extension (a `StreamLanguage`) exported as `dbmlLanguage`.
  - `errorToDiagnostic(doc: Text, err: ParseError): Diagnostic` in `diagnostics.ts`.
  - `<DbmlEditor />` React component: CodeMirror 6 editor bound to `store.source`, pushes edits via `setSource`, renders squiggles from `store.errors`, replaces its doc when `source` changes externally (diagram switch).

- [ ] **Step 1: Write the failing tests**

`src/editor/dbmlLanguage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { StringStream } from '@codemirror/language';
import { dbmlTokenizer } from './dbmlLanguage';

function tokenize(line: string): Array<{ text: string; style: string | null }> {
  const state = dbmlTokenizer.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: Array<{ text: string; style: string | null }> = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = dbmlTokenizer.token(stream, state);
    out.push({ text: stream.current(), style: style ?? null });
  }
  return out;
}
const stylesOf = (line: string, text: string) =>
  tokenize(line).filter((t) => t.text.trim() === text).map((t) => t.style);

describe('dbml tokenizer', () => {
  it('highlights block keywords', () => {
    expect(stylesOf('Table users {', 'Table')).toEqual(['keyword']);
    expect(stylesOf('Enum status {', 'Enum')).toEqual(['keyword']);
    expect(stylesOf('Ref: a.b > c.d', 'Ref')).toEqual(['keyword']);
  });
  it('highlights the name after a block keyword as a definition', () => {
    expect(stylesOf('Table users {', 'users')).toEqual(['def']);
  });
  it('highlights strings, numbers, comments', () => {
    expect(stylesOf("note: 'hello'", "'hello'")).toEqual(['string']);
    expect(stylesOf('id int [default: 42]', '42')).toEqual(['number']);
    expect(stylesOf('// a comment', '// a comment')).toEqual(['comment']);
  });
  it('highlights settings inside brackets as attributes', () => {
    expect(stylesOf('id integer [pk, increment]', 'pk')).toEqual(['attribute']);
    expect(stylesOf('id integer [pk, increment]', 'increment')).toEqual(['attribute']);
  });
});
```

`src/editor/diagnostics.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { errorToDiagnostic } from './diagnostics';

describe('errorToDiagnostic', () => {
  const doc = Text.of(['Table users {', '  id integer', '}']);
  it('maps line/column to doc offsets', () => {
    const d = errorToDiagnostic(doc, { message: 'boom', line: 2, column: 3 });
    expect(d.from).toBe(doc.line(2).from + 2);
    expect(d.to).toBe(doc.line(2).to);
    expect(d.severity).toBe('error');
  });
  it('clamps out-of-range lines and columns', () => {
    const d = errorToDiagnostic(doc, { message: 'boom', line: 99, column: 99 });
    expect(d.from).toBeLessThanOrEqual(doc.length);
    expect(d.to).toBeLessThanOrEqual(doc.length);
    expect(d.from).toBeLessThanOrEqual(d.to);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/editor` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/editor/dbmlLanguage.ts`:
```ts
import { StreamLanguage, type StreamParser } from '@codemirror/language';

interface DbmlState {
  inSettings: boolean;
  inBlockComment: boolean;
  inTripleString: boolean;
  afterBlockKeyword: boolean;
}

const BLOCK_KEYWORDS = /^(Table|Ref|Enum|TableGroup|Project|Note|indexes)\b/i;
const INLINE_KEYWORDS = /^(as|note)\b/i;

export const dbmlTokenizer: StreamParser<DbmlState> = {
  startState: () => ({
    inSettings: false,
    inBlockComment: false,
    inTripleString: false,
    afterBlockKeyword: false,
  }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (state.inTripleString) {
      if (stream.match(/^.*?'''/)) state.inTripleString = false;
      else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) { state.inBlockComment = true; return 'comment'; }
    if (stream.match("'''")) { state.inTripleString = true; return 'string'; }
    if (stream.match(/^'(?:[^'\\]|\\.)*'/) || stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^`[^`]*`/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match('[')) { state.inSettings = true; return 'bracket'; }
    if (stream.match(']')) { state.inSettings = false; return 'bracket'; }
    if (state.afterBlockKeyword && stream.match(/^[\w.]+/)) {
      state.afterBlockKeyword = false;
      return 'def';
    }
    if (!state.inSettings && stream.match(BLOCK_KEYWORDS)) {
      state.afterBlockKeyword = true;
      return 'keyword';
    }
    if (!state.inSettings && stream.match(INLINE_KEYWORDS)) return 'keyword';
    if (state.inSettings && stream.match(/^[\w]+/)) return 'attribute';
    if (stream.match(/^[\w]+/)) return null;
    stream.next();
    return null;
  },
};

export const dbmlLanguage = StreamLanguage.define(dbmlTokenizer);
```

`src/editor/diagnostics.ts`:
```ts
import type { Text } from '@codemirror/state';
import type { Diagnostic } from '@codemirror/lint';
import type { ParseError } from '../core/parse/parseDbml';

export function errorToDiagnostic(doc: Text, err: ParseError): Diagnostic {
  const lineNo = Math.min(Math.max(err.line, 1), doc.lines);
  const line = doc.line(lineNo);
  const from = Math.min(line.from + Math.max(err.column - 1, 0), line.to);
  return { from, to: line.to, severity: 'error', message: err.message };
}
```

`src/editor/DbmlEditor.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { setDiagnostics } from '@codemirror/lint';
import { dbmlLanguage } from './dbmlLanguage';
import { errorToDiagnostic } from './diagnostics';
import { useAppStore } from '../app/store';

export function DbmlEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const view = new EditorView({
      doc: useAppStore.getState().source,
      parent: hostRef.current!,
      extensions: [
        basicSetup,
        dbmlLanguage,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace' } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            useAppStore.getState().setSource(update.state.doc.toString());
          }
        }),
      ],
    });
    viewRef.current = view;

    const unsubErrors = useAppStore.subscribe(
      (s) => s.errors,
      (errors) => {
        const diags = errors.map((e) => errorToDiagnostic(view.state.doc, e));
        view.dispatch(setDiagnostics(view.state, diags));
      },
    );
    const unsubSource = useAppStore.subscribe(
      (s) => s.source,
      (source) => {
        // External replacement (diagram switch). Skip if the view already has this text.
        if (view.state.doc.toString() !== source) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
        }
      },
    );
    return () => {
      unsubErrors();
      unsubSource();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor` — Expected: PASS (6 tests). If `StringStream`'s constructor arity differs in the installed @codemirror/language version, check its exported type and adjust only the test helper.

- [ ] **Step 5: Commit**

```bash
git add src/editor && git commit -m "feat: dbml syntax highlighting, diagnostics mapping, editor component"
```

---

### Task 9: Edge specs & orthogonal routing (pure geometry)

**Files:**
- Create: `src/core/layout/edges.ts`, `src/core/layout/routing.ts`
- Test: `src/core/layout/edges.test.ts`, `src/core/layout/routing.test.ts`

**Interfaces:**
- Consumes: `Schema`, `Rect`, `Point`, `Relation` (Task 2).
- Produces:
  - `interface EdgeSpec { id: string; fromTableId: string; fromFieldIndex: number; fromRelation: Relation; toTableId: string; toFieldIndex: number; toRelation: Relation; }`
  - `buildEdgeSpecs(schema: Schema): EdgeSpec[]` — resolves ref endpoints to field indexes (first named field; index 0 if not found; refs to unknown tables skipped).
  - `routeEdge(fromRect: Rect, fromY: number, toRect: Rect, toY: number): Point[]` — orthogonal polyline from a point on `fromRect`'s edge to a point on `toRect`'s edge.
  - `pointsToPath(points: Point[]): string` — SVG path string.

- [ ] **Step 1: Write the failing tests**

`src/core/layout/edges.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildEdgeSpecs } from './edges';
import { parseDbml } from '../parse/parseDbml';

describe('buildEdgeSpecs', () => {
  it('resolves field indexes for both endpoints', () => {
    const r = parseDbml(`
Table users { id int [pk] \n name varchar }
Table posts { id int [pk] \n author_id int }
Ref: posts.author_id > users.id
`);
    if (!r.ok) throw new Error('parse failed');
    const specs = buildEdgeSpecs(r.schema);
    expect(specs).toHaveLength(1);
    const s = specs[0];
    const many = s.fromRelation === '*' ? { t: s.fromTableId, i: s.fromFieldIndex } : { t: s.toTableId, i: s.toFieldIndex };
    const one = s.fromRelation === '1' ? { t: s.fromTableId, i: s.fromFieldIndex } : { t: s.toTableId, i: s.toFieldIndex };
    expect(many).toEqual({ t: 'public.posts', i: 1 });
    expect(one).toEqual({ t: 'public.users', i: 0 });
  });

  it('skips refs pointing at unknown tables', () => {
    const r = parseDbml('Table a { id int }');
    if (!r.ok) throw new Error('parse failed');
    const specs = buildEdgeSpecs({
      ...r.schema,
      refs: [{ id: 'x', from: { tableId: 'public.ghost', fieldNames: ['id'], relation: '*' }, to: { tableId: 'public.a', fieldNames: ['id'], relation: '1' } }],
    });
    expect(specs).toEqual([]);
  });
});
```

`src/core/layout/routing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { routeEdge, pointsToPath } from './routing';
import type { Rect } from '../model/types';

const rect = (x: number, y: number, w = 220, h = 116): Rect => ({ x, y, w, h });
const isOrthogonal = (pts: Array<{ x: number; y: number }>) =>
  pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y);

describe('routeEdge', () => {
  it('routes right → left when target is to the right', () => {
    const a = rect(0, 0);
    const b = rect(600, 0);
    const pts = routeEdge(a, 60, b, 90);
    expect(pts[0]).toEqual({ x: 220, y: 60 });           // exits a's right edge
    expect(pts[pts.length - 1]).toEqual({ x: 600, y: 90 }); // enters b's left edge
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('routes left → right when target is to the left', () => {
    const a = rect(600, 0);
    const b = rect(0, 0);
    const pts = routeEdge(a, 60, b, 90);
    expect(pts[0]).toEqual({ x: 600, y: 60 });
    expect(pts[pts.length - 1]).toEqual({ x: 220, y: 90 });
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('U-routes on the right when tables overlap horizontally', () => {
    const a = rect(0, 0);
    const b = rect(40, 300);
    const pts = routeEdge(a, 60, b, 360);
    expect(pts[0]).toEqual({ x: 220, y: 60 });
    expect(pts[pts.length - 1]).toEqual({ x: 260, y: 360 });
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(260);
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('serializes to an SVG path', () => {
    expect(pointsToPath([{ x: 1, y: 2 }, { x: 3, y: 2 }])).toBe('M 1 2 L 3 2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/layout/edges.test.ts src/core/layout/routing.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/core/layout/edges.ts`:
```ts
import type { Schema, Table, Relation } from '../model/types';

export interface EdgeSpec {
  id: string;
  fromTableId: string;
  fromFieldIndex: number;
  fromRelation: Relation;
  toTableId: string;
  toFieldIndex: number;
  toRelation: Relation;
}

export function buildEdgeSpecs(schema: Schema): EdgeSpec[] {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const specs: EdgeSpec[] = [];
  for (const ref of schema.refs) {
    const fromTable = byId.get(ref.from.tableId);
    const toTable = byId.get(ref.to.tableId);
    if (!fromTable || !toTable) continue;
    const fieldIndex = (table: Table, names: string[]) => {
      const i = table.fields.findIndex((f) => f.name === names[0]);
      return i >= 0 ? i : 0;
    };
    specs.push({
      id: ref.id,
      fromTableId: ref.from.tableId,
      fromFieldIndex: fieldIndex(fromTable, ref.from.fieldNames),
      fromRelation: ref.from.relation,
      toTableId: ref.to.tableId,
      toFieldIndex: fieldIndex(toTable, ref.to.fieldNames),
      toRelation: ref.to.relation,
    });
  }
  return specs;
}
```

`src/core/layout/routing.ts`:
```ts
import type { Rect, Point } from '../model/types';

const STUB = 24;

export function routeEdge(fromRect: Rect, fromY: number, toRect: Rect, toY: number): Point[] {
  const aRight = fromRect.x + fromRect.w;
  const bRight = toRect.x + toRect.w;

  if (toRect.x - aRight >= STUB * 2) {
    const midX = (aRight + toRect.x) / 2;
    return [
      { x: aRight, y: fromY },
      { x: midX, y: fromY },
      { x: midX, y: toY },
      { x: toRect.x, y: toY },
    ];
  }
  if (fromRect.x - bRight >= STUB * 2) {
    const midX = (bRight + fromRect.x) / 2;
    return [
      { x: fromRect.x, y: fromY },
      { x: midX, y: fromY },
      { x: midX, y: toY },
      { x: bRight, y: toY },
    ];
  }
  const xOut = Math.max(aRight, bRight) + STUB;
  return [
    { x: aRight, y: fromY },
    { x: xOut, y: fromY },
    { x: xOut, y: toY },
    { x: bRight, y: toY },
  ];
}

export function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/layout` — Expected: PASS (edges 2, routing 4, placement 4).

- [ ] **Step 5: Commit**

```bash
git add src/core/layout && git commit -m "feat: edge specs and orthogonal routing geometry"
```

---

### Task 10: Canvas — viewport pan/zoom, table nodes, drag

**Files:**
- Create: `src/canvas/DiagramCanvas.tsx`, `src/canvas/TableNode.tsx`, `src/canvas/viewport.ts`
- Modify: `src/app/App.tsx` (mount canvas + editor + pipeline), `src/styles.css` (canvas styles)
- Test: `src/canvas/viewport.test.ts`

**Interfaces:**
- Consumes: `useAppStore` (Task 6), geometry (Task 2), `useParsePipeline` (Task 7), `DbmlEditor` (Task 8).
- Produces:
  - `zoomAt(vp: Viewport, cursor: Point, deltaY: number): Viewport` and `clampZoom(z: number): number` in `viewport.ts` (pure, tested).
  - `<DiagramCanvas />`: SVG canvas — background drag pans, wheel zooms to cursor, tables render and drag; commits `viewport`/`positions` to store on gesture end only. Exposes `onTableLiveMove` prop used by Task 11's edge layer: `onTableLiveMove?: (id: string, pos: TablePosition) => void` invoked every drag frame, plus renders `children` inside the scene group (edge layer slots in beneath tables).
  - `<TableNode table pos onLiveMove onHover />`: memoized; drag via pointer capture writes its own `transform` directly and calls `onLiveMove`; commits `moveTable` on pointerup; hover calls `setHoveredTable`.

- [ ] **Step 1: Write the failing test (pure viewport math)**

`src/canvas/viewport.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { zoomAt, clampZoom } from './viewport';

describe('viewport math', () => {
  it('clamps zoom to [0.1, 2.5]', () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(9)).toBe(2.5);
    expect(clampZoom(1)).toBe(1);
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const vp = { x: 100, y: 50, zoom: 1 };
    const cursor = { x: 400, y: 300 };
    const worldBefore = { x: (cursor.x - vp.x) / vp.zoom, y: (cursor.y - vp.y) / vp.zoom };
    const next = zoomAt(vp, cursor, -100); // zoom in
    const worldAfter = { x: (cursor.x - next.x) / next.zoom, y: (cursor.y - next.y) / next.zoom };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(next.zoom).toBeGreaterThan(vp.zoom);
  });

  it('zooms out on positive deltaY', () => {
    const next = zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 100);
    expect(next.zoom).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/canvas` — Expected: FAIL (cannot resolve `./viewport`).

- [ ] **Step 3: Implement viewport math, canvas, table node, and wire the app**

`src/canvas/viewport.ts`:
```ts
import type { Viewport, Point } from '../core/model/types';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function zoomAt(vp: Viewport, cursor: Point, deltaY: number): Viewport {
  const zoom = clampZoom(vp.zoom * Math.exp(-deltaY * 0.0015));
  const scale = zoom / vp.zoom;
  return {
    zoom,
    x: cursor.x - (cursor.x - vp.x) * scale,
    y: cursor.y - (cursor.y - vp.y) * scale,
  };
}
```

`src/canvas/TableNode.tsx`:
```tsx
import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';

interface Props {
  table: Table;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  onLiveMove: (id: string, pos: TablePosition) => void;
  onCommitMove: (id: string, pos: TablePosition) => void;
  onHover: (id: string | null) => void;
}

export const TableNode = memo(function TableNode({ table, pos, zoomRef, onLiveMove, onCommitMove, onHover }: Props) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number; live: TablePosition } | null>(null);
  const h = tableHeight(table.fields.length);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, live: pos };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    const zoom = zoomRef.current ?? 1;
    const live = {
      x: drag.current.origX + (e.clientX - drag.current.startX) / zoom,
      y: drag.current.origY + (e.clientY - drag.current.startY) / zoom,
    };
    drag.current.live = live;
    gRef.current?.setAttribute('transform', `translate(${live.x}, ${live.y})`);
    onLiveMove(table.id, live);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { live } = drag.current;
    drag.current = null;
    onCommitMove(table.id, live);
  };

  return (
    <g
      ref={gRef}
      transform={`translate(${pos.x}, ${pos.y})`}
      className="table-node"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => onHover(table.id)}
      onPointerLeave={() => onHover(null)}
    >
      <rect width={TABLE_WIDTH} height={h} rx={6} className="table-body" />
      <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} className="table-header" fill={table.headerColor ?? undefined} />
      <text x={10} y={HEADER_HEIGHT / 2} dominantBaseline="central" className="table-title">
        {table.name}
      </text>
      {table.fields.map((f, i) => (
        <g key={f.name} transform={`translate(0, ${HEADER_HEIGHT + i * ROW_HEIGHT})`}>
          <line x1={0} y1={0} x2={TABLE_WIDTH} y2={0} className="row-line" />
          <text x={10} y={ROW_HEIGHT / 2} dominantBaseline="central" className={`field-name${f.pk ? ' pk' : ''}`}>
            {f.pk ? '🔑 ' : ''}{f.name}
          </text>
          <text x={TABLE_WIDTH - 10} y={ROW_HEIGHT / 2} dominantBaseline="central" textAnchor="end" className="field-type">
            {f.type}
          </text>
        </g>
      ))}
    </g>
  );
});
```

`src/canvas/DiagramCanvas.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { useAppStore } from '../app/store';
import { TableNode } from './TableNode';
import { zoomAt } from './viewport';
import type { TablePosition, Viewport } from '../core/model/types';

interface Props {
  onTableLiveMove?: (id: string, pos: TablePosition) => void;
  children?: ReactNode; // edge layer renders under tables
}

export function DiagramCanvas({ onTableLiveMove, children }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const vpRef = useRef<Viewport>(useAppStore.getState().viewport);
  const zoomRef = useRef<number>(vpRef.current.zoom);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const moveTable = useAppStore((s) => s.moveTable);
  const setHoveredTable = useAppStore((s) => s.setHoveredTable);

  const applyTransform = () => {
    const { x, y, zoom } = vpRef.current;
    zoomRef.current = zoom;
    sceneRef.current?.setAttribute('transform', `translate(${x}, ${y}) scale(${zoom})`);
  };

  useEffect(() => {
    // sync when viewport changes externally (diagram load, zoom-to-fit)
    return useAppStore.subscribe(
      (s) => s.viewport,
      (vp) => { vpRef.current = vp; applyTransform(); },
      { fireImmediately: true },
    );
  }, []);

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      vpRef.current = zoomAt(vpRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY);
      applyTransform();
      useAppStore.getState().setViewport(vpRef.current);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || e.target !== svgRef.current) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: vpRef.current.x, origY: vpRef.current.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panRef.current) return;
    vpRef.current = {
      ...vpRef.current,
      x: panRef.current.origX + (e.clientX - panRef.current.startX),
      y: panRef.current.origY + (e.clientY - panRef.current.startY),
    };
    applyTransform();
  };
  const onPointerUp = () => {
    if (!panRef.current) return;
    panRef.current = null;
    useAppStore.getState().setViewport(vpRef.current);
  };

  return (
    <svg
      ref={svgRef}
      className="diagram-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <g ref={sceneRef}>
        {children}
        {schema.tables.map((t) =>
          positions[t.id] ? (
            <TableNode
              key={t.id}
              table={t}
              pos={positions[t.id]}
              zoomRef={zoomRef}
              onLiveMove={(id, pos) => onTableLiveMove?.(id, pos)}
              onCommitMove={moveTable}
              onHover={setHoveredTable}
            />
          ) : null,
        )}
      </g>
    </svg>
  );
}
```

`src/app/App.tsx` (replace):
```tsx
import { DbmlEditor } from '../editor/DbmlEditor';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { useParsePipeline } from './useParsePipeline';
import { useAppStore } from './store';

export function App() {
  useParsePipeline();
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <span className="brand">DBDraft</span>
        {stale && <span className="badge stale">diagram out of date</span>}
      </header>
      <main className="workspace">
        <section className="editor-pane">
          <DbmlEditor />
        </section>
        <div className="divider" />
        <section className="canvas-pane">
          <DiagramCanvas />
        </section>
      </main>
      <footer className="statusbar">
        <span className={errors.length ? 'status-errors' : 'status-ok'}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : '✓ parsed'}
        </span>
        <span className="status-dim">{tableCount} tables</span>
      </footer>
    </div>
  );
}
```

Append to `src/styles.css`:
```css
.diagram-canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.table-node { cursor: grab; }
.table-body { fill: #fff; stroke: var(--border); }
.table-header { fill: var(--table-header); }
.table-title { fill: #fff; font-size: 13px; font-weight: 600; }
.field-name { font-size: 12px; fill: var(--text); }
.field-name.pk { font-weight: 600; }
.field-type { font-size: 11px; fill: var(--text-dim); }
.row-line { stroke: var(--border); }
.statusbar {
  display: flex; gap: 16px; padding: 3px 12px; font-size: 12px;
  border-top: 1px solid var(--border); background: var(--bg-panel);
}
.status-ok { color: #2e7d32; }
.status-errors { color: var(--error); }
.status-dim { color: var(--text-dim); }
.badge.stale { font-size: 11px; color: #92600a; background: #fdf0d5; padding: 2px 8px; border-radius: 10px; }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run` — Expected: all tests PASS.
Run: `npm run build` — Expected: succeeds.

- [ ] **Step 5: Manual verify in dev server**

Run `npm run dev`, open the app, and confirm:
1. Typing `Table users { id int [pk] }` in the editor → a table appears within ~0.5s.
2. Adding a second table places it without overlapping the first.
3. Wheel zooms toward the cursor; dragging empty space pans; dragging a table moves it.
4. Breaking the syntax (delete `}`) → status bar shows errors + "diagram out of date" badge, diagram still shows last good state; fixing it clears both.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: SVG canvas with pan/zoom, draggable table nodes, live parse wiring"
```

---

### Task 11: Edge layer with live re-routing and hover highlight

**Files:**
- Create: `src/canvas/EdgeLayer.tsx`
- Modify: `src/canvas/DiagramCanvas.tsx` (slot in edge layer + forward live moves), `src/styles.css`

**Interfaces:**
- Consumes: `buildEdgeSpecs`, `routeEdge`, `pointsToPath` (Task 9), `getTableRect`, `fieldRowY` (Task 2), `useAppStore` (Task 6), `DiagramCanvas` `children` + `onTableLiveMove` (Task 10).
- Produces: `EdgeLayer` (forwardRef) with `export interface EdgeLayerHandle { updateTablePosition(id: string, pos: TablePosition): void; }` — re-routes only the moved table's edges via direct `setAttribute('d', …)` during drag.

- [ ] **Step 1: Implement**

`src/canvas/EdgeLayer.tsx`:
```tsx
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { buildEdgeSpecs, type EdgeSpec } from '../core/layout/edges';
import { routeEdge, pointsToPath } from '../core/layout/routing';
import { getTableRect, fieldRowY } from '../core/model/geometry';
import type { Table, TablePosition } from '../core/model/types';

export interface EdgeLayerHandle {
  updateTablePosition(id: string, pos: TablePosition): void;
}

function edgePath(
  spec: EdgeSpec,
  positions: Record<string, TablePosition>,
  tablesById: Map<string, Table>,
): { d: string; label1: { x: number; y: number; text: string }; label2: { x: number; y: number; text: string } } | null {
  const fromTable = tablesById.get(spec.fromTableId);
  const toTable = tablesById.get(spec.toTableId);
  const fromPos = positions[spec.fromTableId];
  const toPos = positions[spec.toTableId];
  if (!fromTable || !toTable || !fromPos || !toPos) return null;
  const fromRect = getTableRect(fromTable, fromPos);
  const toRect = getTableRect(toTable, toPos);
  const pts = routeEdge(fromRect, fromPos.y + fieldRowY(spec.fromFieldIndex), toRect, toPos.y + fieldRowY(spec.toFieldIndex));
  const lblOffset = (p0: { x: number; y: number }, p1: { x: number; y: number }) => ({
    x: p0.x + Math.sign(p1.x - p0.x) * 10,
    y: p0.y - 5,
  });
  return {
    d: pointsToPath(pts),
    label1: { ...lblOffset(pts[0], pts[1]), text: spec.fromRelation },
    label2: { ...lblOffset(pts[pts.length - 1], pts[pts.length - 2]), text: spec.toRelation },
  };
}

export const EdgeLayer = forwardRef<EdgeLayerHandle>(function EdgeLayer(_props, ref) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const hoveredTableId = useAppStore((s) => s.hoveredTableId);
  const pathRefs = useRef(new Map<string, SVGPathElement>());

  const specs = useMemo(() => buildEdgeSpecs(schema), [schema]);
  const tablesById = useMemo(() => new Map(schema.tables.map((t) => [t.id, t])), [schema]);
  const specsByTable = useMemo(() => {
    const m = new Map<string, EdgeSpec[]>();
    for (const s of specs) {
      m.set(s.fromTableId, [...(m.get(s.fromTableId) ?? []), s]);
      m.set(s.toTableId, [...(m.get(s.toTableId) ?? []), s]);
    }
    return m;
  }, [specs]);

  useImperativeHandle(ref, () => ({
    updateTablePosition(id, pos) {
      const live = { ...positions, [id]: pos };
      for (const spec of specsByTable.get(id) ?? []) {
        const p = edgePath(spec, live, tablesById);
        if (p) pathRefs.current.get(spec.id)?.setAttribute('d', p.d);
      }
    },
  }), [positions, specsByTable, tablesById]);

  return (
    <g className="edge-layer">
      {specs.map((spec) => {
        const p = edgePath(spec, positions, tablesById);
        if (!p) return null;
        const hot = hoveredTableId === spec.fromTableId || hoveredTableId === spec.toTableId;
        return (
          <g key={spec.id} className={`edge${hot ? ' hot' : ''}`}>
            <path
              d={p.d}
              ref={(el) => { if (el) pathRefs.current.set(spec.id, el); else pathRefs.current.delete(spec.id); }}
            />
            <text x={p.label1.x} y={p.label1.y} className="edge-label">{p.label1.text}</text>
            <text x={p.label2.x} y={p.label2.y} className="edge-label">{p.label2.text}</text>
          </g>
        );
      })}
    </g>
  );
});
```

- [ ] **Step 2: Wire into DiagramCanvas**

In `src/canvas/DiagramCanvas.tsx`, add:
```tsx
import { EdgeLayer, type EdgeLayerHandle } from './EdgeLayer';
```
Inside the component add `const edgeLayerRef = useRef<EdgeLayerHandle>(null);`, replace `{children}` in the scene `<g>` with `<EdgeLayer ref={edgeLayerRef} />`, remove the `children`/`onTableLiveMove` props from `Props` (the edge layer is now internal), and pass `onLiveMove={(id, pos) => edgeLayerRef.current?.updateTablePosition(id, pos)}` to `TableNode`.

Append to `src/styles.css`:
```css
.edge path { fill: none; stroke: var(--edge); stroke-width: 1.5; }
.edge.hot path { stroke: var(--edge-hover); stroke-width: 2.5; }
.edge-label { font-size: 10px; fill: var(--text-dim); }
.edge.hot .edge-label { fill: var(--edge-hover); }
```

- [ ] **Step 3: Verify (tests, typecheck, manual)**

Run: `npx vitest run && npm run build` — Expected: PASS / build OK.
Manual (`npm run dev`) with the two-table + ref sample:
1. An orthogonal line connects `posts.user_id` row to `users.id` row with `*` and `1` labels.
2. Dragging either table re-routes the edge smoothly during the drag.
3. Hovering a table highlights its edges in blue.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: edge layer with field-anchored routing, live drag re-route, hover highlight"
```

---

### Task 12: IndexedDB persistence repository

**Files:**
- Create: `src/core/persist/repository.ts`
- Test: `src/core/persist/repository.test.ts`

**Interfaces:**
- Consumes: `DiagramRecord` (Task 6 — import type from `src/app/store.ts` is FORBIDDEN in core; instead move nothing: `repository.ts` declares the same shape locally as `PersistedDiagram` structurally identical to `DiagramRecord`, so core stays React-free).
- Produces:
  - `interface PersistedDiagram { id: string; name: string; dbml: string; positions: Record<string, TablePosition>; viewport: Viewport; updatedAt: number; }`
  - `listDiagrams(): Promise<PersistedDiagram[]>` (sorted by `updatedAt` desc)
  - `getDiagram(id: string): Promise<PersistedDiagram | undefined>`
  - `putDiagram(rec: PersistedDiagram): Promise<void>`
  - `deleteDiagram(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/core/persist/repository.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { listDiagrams, getDiagram, putDiagram, deleteDiagram, __resetForTests } from './repository';
import type { PersistedDiagram } from './repository';

const rec = (id: string, updatedAt: number): PersistedDiagram => ({
  id, name: `d-${id}`, dbml: 'Table a { id int }',
  positions: { 'public.a': { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt,
});

describe('repository', () => {
  beforeEach(async () => { await __resetForTests(); });

  it('puts and gets a diagram round-trip', async () => {
    await putDiagram(rec('one', 100));
    const got = await getDiagram('one');
    expect(got).toEqual(rec('one', 100));
  });

  it('lists diagrams newest first', async () => {
    await putDiagram(rec('old', 100));
    await putDiagram(rec('new', 200));
    const all = await listDiagrams();
    expect(all.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('deletes a diagram', async () => {
    await putDiagram(rec('x', 1));
    await deleteDiagram('x');
    expect(await getDiagram('x')).toBeUndefined();
    expect(await listDiagrams()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/persist` — Expected: FAIL (cannot resolve `./repository`).

- [ ] **Step 3: Implement**

`src/core/persist/repository.ts`:
```ts
import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { TablePosition, Viewport } from '../model/types';

export interface PersistedDiagram {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
  updatedAt: number;
}

const DB_NAME = 'dbdraft';
const STORE = 'diagrams';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export async function listDiagrams(): Promise<PersistedDiagram[]> {
  const all = (await (await db()).getAll(STORE)) as PersistedDiagram[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDiagram(id: string): Promise<PersistedDiagram | undefined> {
  return (await (await db()).get(STORE, id)) as PersistedDiagram | undefined;
}

export async function putDiagram(rec: PersistedDiagram): Promise<void> {
  await (await db()).put(STORE, rec);
}

export async function deleteDiagram(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

export async function __resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB(DB_NAME);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/persist` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/persist && git commit -m "feat: IndexedDB diagram repository"
```

---

### Task 13: Bootstrap, autosave, and diagram manager UI

**Files:**
- Create: `src/app/usePersistence.ts`, `src/app/starter.ts`, `src/app/DiagramManager.tsx`
- Modify: `src/app/App.tsx` (mount hook + manager + storage banner), `src/styles.css`
- Test: `src/app/starter.test.ts`

**Interfaces:**
- Consumes: repository (Task 12), `useAppStore` + `DiagramRecord` (Task 6), `parseDbml` (Task 3), `nanoid`.
- Produces:
  - `STARTER_DBML: string` and `createStarterDiagram(): DiagramRecord` in `starter.ts`.
  - `usePersistence(): void` — on mount: load newest diagram or create starter; subscribes to `[source, positions, viewport, diagramName]` and autosaves 1s debounced; storage failures → `setStorageUnavailable(true)`, app keeps running in-memory.
  - `switchDiagram(id: string): Promise<void>`, `createDiagram(): Promise<void>`, `duplicateDiagram(): Promise<void>`, `removeDiagram(id: string): Promise<void>`, `renameDiagram(name: string): void` exported from `usePersistence.ts` (module-level actions used by `DiagramManager`).
  - `<DiagramManager />` — toolbar dropdown: list (newest first), open, new, duplicate, rename (inline input), delete (two-click confirm, no `window.confirm`).

- [ ] **Step 1: Write the failing test**

`src/app/starter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { STARTER_DBML, createStarterDiagram } from './starter';
import { parseDbml } from '../core/parse/parseDbml';

describe('starter content', () => {
  it('starter DBML parses cleanly with tables, refs, and enums', () => {
    const r = parseDbml(STARTER_DBML);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.schema.tables.length).toBeGreaterThanOrEqual(3);
    expect(r.schema.refs.length).toBeGreaterThanOrEqual(3);
    expect(r.schema.enums.length).toBeGreaterThanOrEqual(1);
  });
  it('creates unique diagram records', () => {
    const a = createStarterDiagram();
    const b = createStarterDiagram();
    expect(a.id).not.toBe(b.id);
    expect(a.dbml).toBe(STARTER_DBML);
    expect(a.name).toBe('Untitled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/starter.test.ts` — Expected: FAIL (cannot resolve `./starter`).

- [ ] **Step 3: Implement**

`src/app/starter.ts`:
```ts
import { nanoid } from 'nanoid';
import type { DiagramRecord } from './store';

export const STARTER_DBML = `Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
  role user_role [not null, default: 'member']
  created_at timestamp [default: \`now()\`]
}

Table posts {
  id integer [pk, increment]
  user_id integer [not null]
  title varchar [not null]
  body text [note: 'markdown supported']
  status post_status
  created_at timestamp
}

Table comments {
  id integer [pk, increment]
  post_id integer [not null]
  user_id integer [not null]
  body text
}

Enum user_role {
  admin
  member
}

Enum post_status {
  draft
  published
  archived
}

Ref: posts.user_id > users.id
Ref: comments.post_id > posts.id
Ref: comments.user_id > users.id
`;

export function createStarterDiagram(): DiagramRecord {
  return {
    id: nanoid(),
    name: 'Untitled',
    dbml: STARTER_DBML,
    positions: {},
    viewport: { x: 40, y: 40, zoom: 1 },
    updatedAt: Date.now(),
  };
}
```

`src/app/usePersistence.ts`:
```ts
import { useEffect } from 'react';
import { useAppStore, type DiagramRecord } from './store';
import { listDiagrams, getDiagram, putDiagram, deleteDiagram } from '../core/persist/repository';
import { createStarterDiagram } from './starter';
import { nanoid } from 'nanoid';

function currentRecord(): DiagramRecord | null {
  const s = useAppStore.getState();
  if (!s.diagramId) return null;
  return {
    id: s.diagramId, name: s.diagramName, dbml: s.source,
    positions: s.positions, viewport: s.viewport, updatedAt: Date.now(),
  };
}

async function saveCurrent(): Promise<void> {
  const rec = currentRecord();
  if (!rec) return;
  try {
    await putDiagram(rec);
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
  }
}

export async function switchDiagram(id: string): Promise<void> {
  await saveCurrent();
  const rec = await getDiagram(id);
  if (rec) useAppStore.getState().loadDiagram(rec);
}

export async function createDiagram(): Promise<void> {
  await saveCurrent();
  const rec = createStarterDiagram();
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

export async function duplicateDiagram(): Promise<void> {
  const cur = currentRecord();
  if (!cur) return;
  const copy: DiagramRecord = { ...cur, id: nanoid(), name: `${cur.name} copy`, updatedAt: Date.now() };
  try { await putDiagram(copy); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(copy);
}

export async function removeDiagram(id: string): Promise<void> {
  try { await deleteDiagram(id); } catch { /* removal failing is non-fatal */ }
  if (useAppStore.getState().diagramId === id) {
    const rest = await listDiagrams();
    if (rest.length > 0) useAppStore.getState().loadDiagram(rest[0]);
    else await createDiagram();
  }
}

export function renameDiagram(name: string): void {
  useAppStore.getState().setDiagramName(name.trim() || 'Untitled');
}

export function usePersistence(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listDiagrams();
        if (cancelled) return;
        if (all.length > 0) {
          useAppStore.getState().loadDiagram(all[0]);
        } else {
          const rec = createStarterDiagram();
          await putDiagram(rec);
          useAppStore.getState().loadDiagram(rec);
        }
      } catch {
        useAppStore.getState().setStorageUnavailable(true);
        useAppStore.getState().loadDiagram(createStarterDiagram());
      }
    })();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAppStore.subscribe(
      (s) => [s.source, s.positions, s.viewport, s.diagramName] as const,
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void saveCurrent(), 1000);
      },
      { equalityFn: (a, b) => a.every((v, i) => Object.is(v, b[i])) },
    );
    return () => {
      cancelled = true;
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
```

`src/app/DiagramManager.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listDiagrams } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import { switchDiagram, createDiagram, duplicateDiagram, removeDiagram, renameDiagram } from './usePersistence';

export function DiagramManager() {
  const diagramId = useAppStore((s) => s.diagramId);
  const diagramName = useAppStore((s) => s.diagramName);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PersistedDiagram[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    if (open) void listDiagrams().then(setItems).catch(() => setItems([]));
  }, [open, diagramId]);

  return (
    <div className="diagram-manager">
      {editingName ? (
        <input
          className="name-input"
          autoFocus
          defaultValue={diagramName}
          onBlur={(e) => { renameDiagram(e.target.value); setEditingName(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      ) : (
        <button className="name-button" onClick={() => setEditingName(true)} title="Rename">
          {diagramName} ✎
        </button>
      )}
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} diagrams</button>
      <button onClick={() => void createDiagram()}>+ new</button>
      <button onClick={() => void duplicateDiagram()}>duplicate</button>
      {open && (
        <ul className="diagram-list">
          {items.map((d) => (
            <li key={d.id} className={d.id === diagramId ? 'current' : ''}>
              <button className="open-button" onClick={() => { void switchDiagram(d.id); setOpen(false); }}>
                {d.name}
              </button>
              <span className="when">{new Date(d.updatedAt).toLocaleString()}</span>
              {confirmingId === d.id ? (
                <>
                  <button className="danger" onClick={() => { void removeDiagram(d.id); setConfirmingId(null); }}>confirm ✓</button>
                  <button onClick={() => setConfirmingId(null)}>✕</button>
                </>
              ) : (
                <button onClick={() => setConfirmingId(d.id)}>delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Modify `src/app/App.tsx` — add imports and mount:
```tsx
import { DiagramManager } from './DiagramManager';
import { usePersistence } from './usePersistence';
```
Inside `App()`, call `usePersistence();` right after `useParsePipeline();`, add `const storageUnavailable = useAppStore((s) => s.storageUnavailable);`, put `<DiagramManager />` in the toolbar after the brand, and before `<main>` add:
```tsx
{storageUnavailable && (
  <div className="banner-warning">
    Browser storage is unavailable — your work is NOT being saved. Keep this tab open.
  </div>
)}
```

Append to `src/styles.css`:
```css
.diagram-manager { display: flex; align-items: center; gap: 6px; position: relative; }
.diagram-manager button { font-size: 12px; padding: 3px 8px; border: 1px solid var(--border); background: #fff; border-radius: 4px; cursor: pointer; }
.diagram-manager .name-button { font-weight: 600; }
.diagram-manager .name-input { font-size: 12px; padding: 3px 6px; }
.diagram-list {
  position: absolute; top: 30px; left: 0; z-index: 20; min-width: 340px;
  background: #fff; border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); list-style: none; margin: 0; padding: 4px;
}
.diagram-list li { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; }
.diagram-list li.current { background: #eef3fe; }
.diagram-list .open-button { flex: 1; text-align: left; border: none; background: none; font-weight: 500; }
.diagram-list .when { font-size: 10px; color: var(--text-dim); }
.diagram-list .danger { color: var(--error); }
.banner-warning { background: #fdecea; color: #a33; padding: 6px 12px; font-size: 13px; }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run && npm run build` — Expected: all PASS, build OK.

- [ ] **Step 5: Manual verify in dev server**

1. First load shows the starter blog schema (3 tables, edges, no overlaps).
2. Edit the DBML, drag a table, reload the page → text, positions, and viewport restored.
3. "+ new" creates a fresh diagram; the dropdown lists both; switching preserves each one's content and layout.
4. Rename via ✎, duplicate, and delete (two-click) all behave; deleting the current diagram falls back to another.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: persistence bootstrap, autosave, diagram manager"
```

---

### Task 14: Split-pane resize, zoom controls, zoom-to-fit — integration polish

**Files:**
- Create: `src/app/SplitPane.tsx`, `src/canvas/fitView.ts`
- Modify: `src/app/App.tsx`, `src/canvas/DiagramCanvas.tsx` (zoom control buttons), `src/styles.css`
- Test: `src/canvas/fitView.test.ts`

**Interfaces:**
- Consumes: geometry (Task 2), `useAppStore` (Task 6), `clampZoom` (Task 10).
- Produces:
  - `fitViewport(rects: Rect[], viewW: number, viewH: number, padding?: number): Viewport` (pure, tested).
  - `<SplitPane left right />` — draggable divider, ratio persisted to `localStorage` key `dbdraft.split`.
  - Zoom control cluster on the canvas (`+`, `−`, `fit`, percentage readout).

- [ ] **Step 1: Write the failing test**

`src/canvas/fitView.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fitViewport } from './fitView';

describe('fitViewport', () => {
  it('fits content bounds inside the view with padding', () => {
    const vp = fitViewport([{ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 200, w: 100, h: 100 }], 800, 600, 40);
    // content bounds: 0,0 → 400,300; check corners map inside view
    const sx = (wx: number) => wx * vp.zoom + vp.x;
    const sy = (wy: number) => wy * vp.zoom + vp.y;
    expect(sx(0)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(sy(0)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(sx(400)).toBeLessThanOrEqual(800 - 40 + 1e-6);
    expect(sy(300)).toBeLessThanOrEqual(600 - 40 + 1e-6);
  });
  it('returns identity-ish default for empty content', () => {
    expect(fitViewport([], 800, 600)).toEqual({ x: 0, y: 0, zoom: 1 });
  });
  it('never zooms in past 1 for tiny content', () => {
    const vp = fitViewport([{ x: 0, y: 0, w: 10, h: 10 }], 800, 600, 40);
    expect(vp.zoom).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/canvas/fitView.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/canvas/fitView.ts`:
```ts
import type { Rect, Viewport } from '../core/model/types';
import { clampZoom } from './viewport';

export function fitViewport(rects: Rect[], viewW: number, viewH: number, padding = 40): Viewport {
  if (rects.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const w = maxX - minX;
  const h = maxY - minY;
  const zoom = clampZoom(Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h, 1));
  return {
    zoom,
    x: (viewW - w * zoom) / 2 - minX * zoom,
    y: (viewH - h * zoom) / 2 - minY * zoom,
  };
}
```

`src/app/SplitPane.tsx`:
```tsx
import { useRef, type ReactNode } from 'react';

const KEY = 'dbdraft.split';

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const initial = Number(localStorage.getItem(KEY)) || 38;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const pct = Math.min(80, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
      leftRef.current!.style.width = `${pct}%`;
    };
    const onUp = () => {
      const w = leftRef.current!.style.width;
      if (w) localStorage.setItem(KEY, String(parseFloat(w)));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <main className="workspace" ref={containerRef}>
      <section className="editor-pane" ref={leftRef} style={{ width: `${initial}%` }}>{left}</section>
      <div className="divider" onPointerDown={onPointerDown} />
      <section className="canvas-pane">{right}</section>
    </main>
  );
}
```

In `src/canvas/DiagramCanvas.tsx` add a zoom control cluster. Add imports:
```tsx
import { fitViewport } from './fitView';
import { getTableRect } from '../core/model/geometry';
import { useState } from 'react';
```
Add inside the component: `const [zoomPct, setZoomPct] = useState(Math.round(vpRef.current.zoom * 100));` — update it wherever `applyTransform()` commits (call `setZoomPct(Math.round(vpRef.current.zoom * 100))` inside the viewport subscribe callback and at the end of `onWheel`/`onPointerUp`). Add these handlers:
```tsx
const zoomBy = (factor: number) => {
  const svg = svgRef.current!;
  const rect = svg.getBoundingClientRect();
  vpRef.current = zoomAt(vpRef.current, { x: rect.width / 2, y: rect.height / 2 }, -Math.log(factor) / 0.0015);
  applyTransform();
  useAppStore.getState().setViewport(vpRef.current);
};
const fit = () => {
  const { schema, positions } = useAppStore.getState();
  const rects = schema.tables.filter((t) => positions[t.id]).map((t) => getTableRect(t, positions[t.id]));
  const rect = svgRef.current!.getBoundingClientRect();
  useAppStore.getState().setViewport(fitViewport(rects, rect.width, rect.height));
};
```
Change the component's return to wrap the svg:
```tsx
return (
  <div className="canvas-wrap">
    <svg …unchanged… </svg>
    <div className="zoom-controls">
      <button onClick={() => zoomBy(1.2)}>+</button>
      <button onClick={() => zoomBy(1 / 1.2)}>−</button>
      <button onClick={fit}>fit</button>
      <span>{zoomPct}%</span>
    </div>
  </div>
);
```

In `src/app/App.tsx`, replace the `<main className="workspace">…</main>` block with:
```tsx
<SplitPane left={<DbmlEditor />} right={<DiagramCanvas />} />
```
(adding `import { SplitPane } from './SplitPane';` and removing the now-unused pane markup).

Append to `src/styles.css`:
```css
.canvas-wrap { position: absolute; inset: 0; }
.zoom-controls {
  position: absolute; right: 12px; bottom: 12px; display: flex; gap: 4px; align-items: center;
  background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 12px;
}
.zoom-controls button { border: none; background: none; font-size: 14px; cursor: pointer; padding: 2px 6px; }
```

- [ ] **Step 4: Run all tests + build**

Run: `npx vitest run && npm run build` — Expected: all PASS, build OK.

- [ ] **Step 5: Manual verify (full walkthrough)**

`npm run dev`, then:
1. Divider drags and the ratio survives reload.
2. `+`/`−`/`fit` buttons work; `fit` frames all tables; percentage readout updates on wheel zoom too.
3. Full regression of Task 10/11/13 manual checks still passes (type → render, drag, persistence, manager).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: split pane, zoom controls, zoom-to-fit"
```

---

### Task 15: Final review pass

**Files:** none new — verification and cleanup only.

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run` — Expected: ~34 tests, all PASS.
Run: `npm run build` — Expected: clean build, no TS errors.

- [ ] **Step 2: Constraint audit**

Run: `grep -rn "from 'react'\|from 'zustand'\|from \"react\"\|../app/\|../editor/\|../canvas/" src/core/ || true`
Expected: no output (core stays framework-free). If any hits, fix and re-run.

- [ ] **Step 3: Commit any fixes and tag**

```bash
git add -A && git commit -m "chore: plan 1 complete — core editor + diagram + persistence" --allow-empty
git tag plan-1-complete
```
