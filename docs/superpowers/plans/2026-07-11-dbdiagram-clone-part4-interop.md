# dbdiagram Clone — Plan 4: Interop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQL import/export for PostgreSQL, MySQL and SQL Server, open/paste `.dbml`, PNG (2x) / SVG / project-file export, a per-diagram snapshot ring buffer with a History panel, and a working "download your work" escape hatch in the storage-unavailable banner — milestone 5 (spec §11.5, §3 Import/Export/Persistence rows, §8, §9).

**Architecture:** Conversion is a pure facade in `src/core/convert/` that lazy-loads the already-installed `@dbml/core` (so the ~2.7 MB parser chunk never enters the main bundle); snapshots are a second object store in the existing `dbdraft` IndexedDB (version bump 1 → 2) owned by `src/core/persist/repository.ts`. Everything that touches the DOM — blob downloads, SVG scene serialization, canvas rasterization — lives in `src/app/export/`, with its pure sub-parts (bounds union, `var()` resolution, filename sanitizing) factored out and unit-tested in node. Import always creates a **new** diagram through the same flush-then-invalidate autosave discipline `createDiagram` uses.

**Tech Stack:** Existing Plan 1–2 stack only. `@dbml/core` `^8.3.1` (lockfile-pinned to 8.3.1), `idb`, `nanoid`, plus platform APIs (`Blob`, `URL.createObjectURL`, `XMLSerializer`, `<canvas>.toBlob`). **No new dependencies.**

## Verified @dbml/core 8.3.1 API (checked against the installed package's `types/`, do not trust memory)

- `importer.import(str: string, format: ImportFormat, options?: ImportOptions): string` — SQL DDL in, **DBML text out**. `ImportFormat` includes `'postgres' | 'mysql' | 'mssql'` (the v2 ANTLR dialect parsers; `postgresLegacy`/`mssqlLegacy` are the old peg ones — never use them).
- `exporter.export(str: string, format: ExportFormat, options?: ExportOptions): string` — **DBML text in**, DDL out. `ExportFormat = 'dbml' | 'mysql' | 'postgres' | 'json' | 'mssql' | 'oracle'`. Verified in the 8.3.1 bundle: it internally runs `new Parser().parse(str, 'dbmlv2')` then `ModelExporter.export(db.normalize(), format)` — the **same `'dbmlv2'` grammar our own `parseDbml` uses**, so any text the canvas renders exports cleanly (single-line DBML included; empirically confirmed).
- `ModelExporter.export(model: Database | NormalizedModel, format: ExportFormat, options?: ExportOptions): string` and `Parser.parse(str: string, format: ParseFormat): Database` exist too, but the two string facades above are all this plan needs.
- Failures throw `CompilerError { diags: CompilerDiagnostic[] }` with `diags[i] = { message, location: { start: { line, column } } }` — the exact shape `parseDbml`'s error normalizer already handles. (`CompilerError.message` is `undefined`; ANTLR import errors may report a 0-based column — both are display-only in the import dialog, no clamping needed.)

## Global Constraints

- TypeScript `strict: true`; no new `any` (the `@dbml/core` object boundary in `parseDbml.ts` remains the only allowed exception).
- `src/core/` MUST NOT import React, zustand, or anything from `src/app|editor|canvas`. Placement rule for this plan: the convert facade (`src/core/convert/`) and the snapshot repository (`src/core/persist/`) are **core**; anything touching the DOM (`Blob` downloads, `XMLSerializer`, `getComputedStyle`, `<canvas>`) lives in **`src/app/export/`**. Audit stays: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` returns nothing.
- **@dbml/core pin:** stay on `^8.3.x` with the `'dbmlv2'` parse format; npm's `latest` is a 9.x prerelease — never bump. The lockfile resolves to exactly 8.3.1.
- **Bundle budget:** `@dbml/core` must never enter the main chunk. The only *static* `from '@dbml/core'` import in `src/` stays `src/core/parse/parseDbml.ts` (reachable from the main thread only via dynamic import; statically only from the worker chunk). The convert facade loads it with `import('@dbml/core')`. Main chunk must stay ≤ ~210 kB gzip (Plan 2 baseline: 197.8 kB); Task 10 verifies.
- **Last good parse:** untouched. Import/export never mutate parse state; a failed SQL import shows the importer's message (with line context) inside the dialog and leaves the current diagram completely alone.
- **Import always creates a new diagram** (fresh `nanoid` id) — never overwrites the current one. It follows `createDiagram`'s exact discipline: `await saveCurrent()` (flush) → `invalidatePendingAutosave()` (synchronous, before the switch-tied awaits) → `putDiagram(new)` → `loadDiagram(new)`.
- **Persistence safety:** every repository call is try/caught → `setStorageUnavailable(true)` + in-memory operation, never an unhandled rejection. Snapshot writes are best-effort: they run only **after** `putDiagram` has succeeded, and every snapshot failure is swallowed — history must never break, abort, or reorder the diagram save itself.
- **Snapshot trigger rule (exact):** every successful diagram write in `saveCurrent` (autosave fire, switch/duplicate/rename flush) produces a snapshot *candidate*; it is kept iff (a) the parse state is clean (`!stale && errors.length === 0`) and (b) its `dbml` differs from the newest stored snapshot for that diagram. Layout-only saves (drag/pan) therefore never snapshot, and the 1 s debounce keeps keystrokes out. Ring size 20. Restore is non-destructive: it checkpoints the pre-restore state first.
- Export must work while storage is unavailable — DBML/SQL/PNG/SVG/project exports read only the in-memory store, never the repository.
- Tests: vitest **node** environment, no DOM. Pure logic (convert facade with real `@dbml/core` round-trips per dialect, project-file validation, snapshot ring buffer against `fake-indexeddb`, `var()` resolution, bounds union, filename sanitizing) gets unit tests. DOM-dependent steps (serialization, rasterization, downloads, dialogs) are browser-verified via `npm run build` + a manual checklist.
- Working dir `/Users/sharif/Documents/dbdiagram`, branch `feature/plan-4-interop` (created from `main` in Task 1). If `node_modules` is missing, restore it with `npm install` (lockfile-driven) — do not add or bump any dependency.
- Commands exactly as in CLAUDE.md: `npm test`, `npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`.

---

### Task 1: Convert facade — SQL import/export over lazily loaded @dbml/core

**Files:**
- Create: `src/core/parse/errors.ts`
- Create: `src/core/convert/convert.ts`
- Modify: `src/core/parse/parseDbml.ts` (extract the error normalizer; behavior unchanged)
- Test: `src/core/convert/convert.test.ts`

**Interfaces:**
- Consumes: `@dbml/core` 8.3.1 `importer.import(str, format)` / `exporter.export(str, format)` (see the verified-API section), `parseDbml` (tests only).
- Produces:
  - `interface ParseError { message: string; line: number; column: number }` (moved to `errors.ts`; still re-exported from `parseDbml.ts` so `store.ts`/`diagnostics.ts` imports keep working)
  - `normalizeParseErrors(e: unknown): ParseError[]`
  - `type SqlDialect = 'postgres' | 'mysql' | 'mssql'`
  - `type ConvertResult = { ok: true; text: string } | { ok: false; errors: ParseError[] }`
  - `importSql(sql: string, dialect: SqlDialect): Promise<ConvertResult>`
  - `exportSql(dbml: string, dialect: SqlDialect): Promise<ConvertResult>`

- [ ] **Step 0: Branch (and restore node_modules if missing)**

```bash
cd /Users/sharif/Documents/dbdiagram && git checkout -b feature/plan-4-interop
# only if node_modules is absent:
npm install
```

- [ ] **Step 1: Write the failing test**

`src/core/convert/convert.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { importSql, exportSql } from './convert';
import { parseDbml } from '../parse/parseDbml';

const DBML = `Table users {
  id integer [pk]
  email varchar [not null]
}

Table posts {
  id integer [pk]
  user_id integer
}

Ref: posts.user_id > users.id
`;

describe('exportSql', () => {
  it.each(['postgres', 'mysql', 'mssql'] as const)('emits CREATE TABLE DDL for %s', async (d) => {
    const r = await exportSql(DBML, d);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.text).toContain('CREATE TABLE');
    expect(r.text).toContain('users');
    expect(r.text).toContain('posts');
  });

  it('handles single-line DBML (dbmlv2 grammar, not the legacy peg parser)', async () => {
    const r = await exportSql('Table a { id int }', 'postgres');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.text).toContain('CREATE TABLE');
  });

  it('reports errors with line info for broken DBML, without throwing', async () => {
    const r = await exportSql('Table broken {', 'postgres');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message.length).toBeGreaterThan(0);
    expect(r.errors[0].line).toBeGreaterThanOrEqual(1);
  });
});

describe('importSql', () => {
  it('converts postgres DDL to DBML', async () => {
    const sql =
      'CREATE TABLE users (id integer PRIMARY KEY, email varchar(255) NOT NULL UNIQUE);';
    const r = await importSql(sql, 'postgres');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.text).toContain('Table "users"');
    expect(r.text).toContain('[pk]');
  });

  it('round-trips DBML → SQL → DBML per dialect', async () => {
    for (const d of ['postgres', 'mysql', 'mssql'] as const) {
      const sql = await exportSql(DBML, d);
      if (!sql.ok) throw new Error(`export ${d} failed: ${sql.errors[0]?.message}`);
      const back = await importSql(sql.text, d);
      if (!back.ok) throw new Error(`import ${d} failed: ${back.errors[0]?.message}`);
      const parsed = parseDbml(back.text);
      if (!parsed.ok) throw new Error(`re-parse ${d} failed: ${parsed.errors[0]?.message}`);
      expect(parsed.schema.tables.map((t) => t.name).sort()).toEqual(['posts', 'users']);
      expect(parsed.schema.refs).toHaveLength(1);
    }
  });

  it('fails with the importer message on invalid SQL, current state untouched semantics', async () => {
    const r = await importSql('NOT VALID SQL AT ALL;', 'postgres');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/mismatched|extraneous|expecting/i);
    expect(r.errors[0].line).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/convert/convert.test.ts` — Expected: FAIL (cannot resolve `./convert`).

- [ ] **Step 3: Implement**

`src/core/parse/errors.ts`:
```ts
export interface ParseError {
  message: string;
  line: number;
  column: number;
}

/** Normalize a thrown @dbml/core CompilerError — `{ diags: [{ message,
 *  location: { start: { line, column } } }] }` in the installed 8.3.1 — or
 *  any unknown throw, into our flat ParseError list. Shared by the DBML
 *  parse wrapper and the SQL convert facade. Deliberately free of any
 *  @dbml/core import so it is always safe in the main chunk. */
export function normalizeParseErrors(e: unknown): ParseError[] {
  const err = e as {
    diags?: Array<{ message?: string; location?: { start?: { line?: number; column?: number } } }>;
    message?: string;
  };
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

`src/core/parse/parseDbml.ts` (complete replacement — same behavior, normalizer extracted):
```ts
import { Parser } from '@dbml/core';
import type { Schema, Table, Field, Ref, RefEndpoint, EnumDef, Relation } from '../model/types';
import type { ParseError } from './errors';
import { normalizeParseErrors } from './errors';

export type { ParseError } from './errors';
export type ParseResult = { ok: true; schema: Schema } | { ok: false; errors: ParseError[] };

export function parseDbml(source: string): ParseResult {
  try {
    // 'dbmlv2' is the ANTLR-based DBML parser (dbdiagram.io's current syntax);
    // the legacy 'dbml' peg parser rejects single-line blocks like `Table a { id int }`.
    const db = new Parser().parse(source, 'dbmlv2');
    return { ok: true, schema: normalizeDatabase(db) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
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
```

`src/core/convert/convert.ts`:
```ts
import type { ParseError } from '../parse/errors';
import { normalizeParseErrors } from '../parse/errors';

export type SqlDialect = 'postgres' | 'mysql' | 'mssql';
export type ConvertResult = { ok: true; text: string } | { ok: false; errors: ParseError[] };

// @dbml/core is ~2.7 MB gzipped — it must never land in the main chunk
// (CLAUDE.md invariant). Loaded on first use, exactly like workerParse's
// fallback path; Vite shares the chunk with the parser, and the browser
// caches it after the first conversion. A failed chunk load rejects the
// await inside the try, so it surfaces as a normal {ok:false} result.
const loadCore = () => import('@dbml/core');

/** SQL DDL → DBML text. Uses the installed 8.3.1 facade
 *  `importer.import(str, format)`, which parses with the v2 dialect parsers
 *  ('postgres' | 'mysql' | 'mssql') and re-emits DBML via its own exporter —
 *  so the result is always re-parseable by our 'dbmlv2' pipeline. */
export async function importSql(sql: string, dialect: SqlDialect): Promise<ConvertResult> {
  try {
    const { importer } = await loadCore();
    return { ok: true, text: importer.import(sql, dialect) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
  }
}

/** DBML text → SQL DDL. `exporter.export(str, format)` parses the DBML with
 *  the 'dbmlv2' grammar internally (verified against the 8.3.1 bundle) —
 *  the same format parseDbml uses, so anything the canvas renders exports. */
export async function exportSql(dbml: string, dialect: SqlDialect): Promise<ConvertResult> {
  try {
    const { exporter } = await loadCore();
    return { ok: true, text: exporter.export(dbml, dialect) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
  }
}
```

- [ ] **Step 4: Run tests to verify pass (convert + untouched parse suite)**

Run: `npx vitest run src/core/convert src/core/parse` — Expected: PASS (8 new tests — the `it.each` expands to 3 — + all existing parse tests green; the extraction must not change any parse test result).

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && git add src/core/convert src/core/parse/errors.ts src/core/parse/parseDbml.ts && git commit -m "feat: sql convert facade (import/export) over lazy @dbml/core"
```

---

### Task 2: Project file — serialize + validate (pure)

**Files:**
- Create: `src/core/convert/projectFile.ts`
- Test: `src/core/convert/projectFile.test.ts`

**Interfaces:**
- Consumes: `TablePosition`, `Viewport` from `src/core/model/types`.
- Produces:
  - `PROJECT_FILE_VERSION = 1`
  - `interface ProjectFile { version: 1; name: string; dbml: string; layout: Record<string, TablePosition>; viewport: Viewport }`
  - `type ProjectParseResult = { ok: true; project: ProjectFile } | { ok: false; error: string }`
  - `serializeProject(p: { name: string; dbml: string; positions: Record<string, TablePosition>; viewport: Viewport }): string`
  - `parseProject(text: string): ProjectParseResult` — validates shape, rebuilds sanitized objects (unknown keys dropped, reserved layout keys like `__proto__` rejected), readable error messages.

- [ ] **Step 1: Write the failing test**

`src/core/convert/projectFile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { serializeProject, parseProject, PROJECT_FILE_VERSION } from './projectFile';

const input = {
  name: 'Shop',
  dbml: 'Table a { id int }',
  positions: { 'public.a': { x: 10, y: 20 } },
  viewport: { x: 1, y: 2, zoom: 0.75 },
};

describe('serializeProject / parseProject', () => {
  it('round-trips through JSON', () => {
    const r = parseProject(serializeProject(input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual({
      version: PROJECT_FILE_VERSION,
      name: 'Shop',
      dbml: 'Table a { id int }',
      layout: { 'public.a': { x: 10, y: 20 } },
      viewport: { x: 1, y: 2, zoom: 0.75 },
    });
  });

  it('strips unknown keys instead of carrying them along', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.evil = 'payload';
    (raw.layout as Record<string, unknown>)['public.a'] = { x: 10, y: 20, extra: true };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('evil' in r.project).toBe(false);
    expect(r.project.layout['public.a']).toEqual({ x: 10, y: 20 });
  });

  it('rejects non-JSON', () => {
    const r = parseProject('not json {');
    expect(r).toEqual({ ok: false, error: 'Not valid JSON.' });
  });

  it('rejects non-objects', () => {
    expect(parseProject('42').ok).toBe(false);
    expect(parseProject('null').ok).toBe(false);
  });

  it('rejects wrong versions with a readable message', () => {
    const r = parseProject(JSON.stringify({ ...JSON.parse(serializeProject(input)), version: 9 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('version');
    expect(r.error).toContain('9');
  });

  it('rejects missing name/dbml', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    delete raw.dbml;
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('dbml');
  });

  it('rejects malformed layout entries, naming the offender', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.layout = { 'public.a': { x: 'ten', y: 20 } };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('public.a');
  });

  it('rejects a "__proto__" layout key instead of hijacking the prototype', () => {
    const r = parseProject(
      '{"version":1,"name":"Shop","dbml":"Table a { id int }","layout":{"__proto__":{"x":111,"y":222},"public.a":{"x":1,"y":2}},"viewport":{"x":0,"y":0,"zoom":1}}',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('not allowed');
    // pin the no-global-pollution property
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('rejects a bad viewport (non-numeric or non-positive zoom)', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.viewport = { x: 0, y: 0, zoom: 0 };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('viewport');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/convert/projectFile.test.ts` — Expected: FAIL (cannot resolve `./projectFile`).

- [ ] **Step 3: Implement**

`src/core/convert/projectFile.ts`:
```ts
import type { TablePosition, Viewport } from '../model/types';

export const PROJECT_FILE_VERSION = 1;

/** On-disk project file: DBML + layout + viewport (spec §3 Export row).
 *  `layout` is this codebase's `positions` map, keyed by `${schema}.${table}`. */
export interface ProjectFile {
  version: 1;
  name: string;
  dbml: string;
  layout: Record<string, TablePosition>;
  viewport: Viewport;
}

export type ProjectParseResult =
  | { ok: true; project: ProjectFile }
  | { ok: false; error: string };

export function serializeProject(p: {
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
}): string {
  const file: ProjectFile = {
    version: PROJECT_FILE_VERSION,
    name: p.name,
    dbml: p.dbml,
    layout: p.positions,
    viewport: p.viewport,
  };
  return JSON.stringify(file, null, 2);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate an untrusted project file. Rebuilds sanitized objects (unknown
 *  keys dropped, reserved layout keys like "__proto__" rejected) — this is a
 *  trust boundary. Errors are user-readable. */
export function parseProject(text: string): ProjectParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Not a project file (expected a JSON object).' };
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== PROJECT_FILE_VERSION) {
    return { ok: false, error: `Unsupported project file version: ${String(o.version)} (expected ${PROJECT_FILE_VERSION}).` };
  }
  if (typeof o.name !== 'string' || typeof o.dbml !== 'string') {
    return { ok: false, error: 'Project file is missing "name" or "dbml".' };
  }
  if (typeof o.layout !== 'object' || o.layout === null || Array.isArray(o.layout)) {
    return { ok: false, error: 'Project file "layout" must be an object of table positions.' };
  }
  const layout: Record<string, TablePosition> = {};
  for (const [k, v] of Object.entries(o.layout as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return { ok: false, error: `Project file layout entry "${k}" is not allowed.` };
    }
    const p = v as { x?: unknown; y?: unknown } | null;
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
      return { ok: false, error: `Project file layout entry "${k}" must have numeric x/y.` };
    }
    layout[k] = { x: p.x, y: p.y };
  }
  const vp = o.viewport as { x?: unknown; y?: unknown; zoom?: unknown } | null | undefined;
  if (!vp || !isFiniteNumber(vp.x) || !isFiniteNumber(vp.y) || !isFiniteNumber(vp.zoom) || vp.zoom <= 0) {
    return { ok: false, error: 'Project file "viewport" must have numeric x, y and a positive zoom.' };
  }
  return {
    ok: true,
    project: {
      version: PROJECT_FILE_VERSION,
      name: o.name,
      dbml: o.dbml,
      layout,
      viewport: { x: vp.x, y: vp.y, zoom: vp.zoom },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/convert` — Expected: PASS (9 new tests + Task 1's).

- [ ] **Step 5: Commit**

```bash
git add src/core/convert/projectFile.ts src/core/convert/projectFile.test.ts && git commit -m "feat: project file serialize + validate"
```

---

### Task 3: Pure export helpers — rect union (core), CSS-var resolution + safe filenames (app)

**Files:**
- Modify: `src/core/model/geometry.ts`
- Create: `src/app/export/exportCss.ts`
- Test: modify `src/core/model/geometry.test.ts` (append), create `src/app/export/exportCss.test.ts`

**Interfaces:**
- Produces:
  - `unionRects(rects: Rect[]): Rect | null` — bounding box of all rects; `null` for empty input.
  - `expandRect(r: Rect, margin: number): Rect`
  - `EXPORT_CSS: string` — the SVG-relevant subset of `styles.css`, with `var()` references intact.
  - `resolveCssVars(css: string, getVar: (name: string) => string): string` — replaces `var(--x)` / `var(--x, fallback)` with concrete values.
  - `safeFilename(name: string): string` — cross-platform filename stem, `'diagram'` fallback.

Note on placement: `exportCss.ts` performs no DOM access at module level (it takes `getVar` as a parameter), so it is unit-testable in vitest's node environment even though it lives in `src/app/export/` next to its DOM consumers.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/model/geometry.test.ts` — first replace the import line:
```ts
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight, fieldRowY, getTableRect, unionRects, expandRect } from './geometry';
```
then append at the end of the file:
```ts
describe('unionRects / expandRect', () => {
  it('unions rects into a bounding box', () => {
    expect(unionRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 40, y: -5, w: 10, h: 10 },
    ])).toEqual({ x: 0, y: -5, w: 50, h: 15 });
  });
  it('returns null for no rects', () => {
    expect(unionRects([])).toBeNull();
  });
  it('expands a rect by a margin on all sides', () => {
    expect(expandRect({ x: 10, y: 20, w: 30, h: 40 }, 5)).toEqual({ x: 5, y: 15, w: 40, h: 50 });
  });
});
```

`src/app/export/exportCss.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EXPORT_CSS, resolveCssVars, safeFilename } from './exportCss';

describe('EXPORT_CSS', () => {
  it('covers every canvas class the scene uses', () => {
    for (const sel of [
      '.table-body', '.table-header', '.table-title', '.field-name',
      '.field-type', '.row-line', '.edge path', '.edge-label',
    ]) {
      expect(EXPORT_CSS).toContain(sel);
    }
  });
});

describe('resolveCssVars', () => {
  const vars: Record<string, string> = { '--border': '#d9dde3', '--text': ' #1f2430 ' };
  const getVar = (n: string) => vars[n] ?? '';

  it('replaces var() references with concrete values, trimming whitespace', () => {
    expect(resolveCssVars('stroke: var(--border);', getVar)).toBe('stroke: #d9dde3;');
    expect(resolveCssVars('fill: var(--text);', getVar)).toBe('fill: #1f2430;');
  });
  it('uses the literal fallback when the variable is not defined', () => {
    expect(resolveCssVars('fill: var(--missing, #abc);', getVar)).toBe('fill: #abc;');
  });
  it('resolves every var in EXPORT_CSS given a full variable map', () => {
    expect(resolveCssVars(EXPORT_CSS, () => '#123456')).not.toContain('var(');
  });
});

describe('safeFilename', () => {
  it('strips path and reserved characters', () => {
    expect(safeFilename('my/diagram: v2?')).toBe('my_diagram_ v2_');
  });
  it('falls back for empty names', () => {
    expect(safeFilename('   ')).toBe('diagram');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/model/geometry.test.ts src/app/export/exportCss.test.ts` — Expected: FAIL (geometry: `unionRects` not exported; exportCss: cannot resolve `./exportCss`).

- [ ] **Step 3: Implement**

Append to `src/core/model/geometry.ts`:
```ts
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function expandRect(r: Rect, margin: number): Rect {
  return { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 };
}
```
(`Rect` is already imported at the top of `geometry.ts`.)

`src/app/export/exportCss.ts`:
```ts
/** Pure helpers for diagram export. No DOM access at module level — this
 *  file is unit-tested in vitest's node environment; the DOM-touching SVG
 *  serialization lives in svgExport.ts. */

/** SVG-relevant subset of src/styles.css, kept as var() references so the
 *  values are resolved from the LIVE document at export time — when Plan 3
 *  lands CSS-variable theming (dark mode), exports automatically pick up
 *  the active theme without touching this file.
 *  ponytail: selectors duplicated from styles.css by hand; if a canvas
 *  class is renamed there, rename it here too. */
export const EXPORT_CSS = [
  'text { font-family: system-ui, sans-serif; }',
  '.table-body { fill: #fff; stroke: var(--border); }',
  '.table-header { fill: var(--table-header); }',
  '.table-title { fill: #fff; font-size: 13px; font-weight: 600; }',
  '.field-name { font-size: 12px; fill: var(--text); }',
  '.field-name.pk { font-weight: 600; }',
  '.field-type { font-size: 11px; fill: var(--text-dim); }',
  '.row-line { stroke: var(--border); }',
  '.edge path { fill: none; stroke: var(--edge); stroke-width: 1.5; }',
  '.edge-label { font-size: 10px; fill: var(--text-dim); }',
].join('\n');

/** Replace every `var(--name)` / `var(--name, fallback)` with a concrete
 *  value from `getVar`, falling back to the literal fallback, then ''. */
export function resolveCssVars(css: string, getVar: (name: string) => string): string {
  return css.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_m, name: string, fallback?: string) => {
      const v = getVar(name).trim();
      if (v !== '') return v;
      return (fallback ?? '').trim();
    },
  );
}

/** Turn a diagram name into a safe cross-platform filename stem. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned === '' ? 'diagram' : cleaned;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/model src/app/export` — Expected: PASS (9 new tests + existing geometry/reconcile tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/model/geometry.ts src/core/model/geometry.test.ts src/app/export && git commit -m "feat: export pure helpers — rect union, css var resolution, safe filenames"
```

---

### Task 4: Snapshot repository — DB v2 upgrade + per-diagram ring buffer

**Files:**
- Modify: `src/core/persist/repository.ts`
- Test: modify `src/core/persist/repository.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface DiagramSnapshot { id: string; diagramId: string; takenAt: number; name: string; dbml: string; positions: Record<string, TablePosition>; viewport: Viewport }`
  - `SNAPSHOT_LIMIT = 20`
  - `putSnapshot(snap: DiagramSnapshot): Promise<void>` — insert + prune the ring to the newest `SNAPSHOT_LIMIT` rows for that diagram.
  - `listSnapshots(diagramId: string): Promise<DiagramSnapshot[]>` — newest first.
  - `deleteDiagram(id)` now also deletes that diagram's snapshots (history is per-diagram; no orphans).
- Storage schema: DB `dbdraft` **version 2**. `diagrams` store unchanged. New store `snapshots` (`keyPath: 'id'`) with index `byDiagram` on `diagramId`. Upgrade path is per-version guarded: fresh installs run 0→2 (both stores), existing Plan-1 databases run 1→2 (snapshots store only, diagrams preserved in place).

- [ ] **Step 1: Write the failing tests**

Append to `src/core/persist/repository.test.ts` — first replace the entire import section (current lines 1–4: the `fake-indexeddb/auto`, vitest, `./repository` value and type imports) with the block below, so the file ends up with exactly these imports once — no duplicates:
```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import {
  listDiagrams, getDiagram, putDiagram, deleteDiagram,
  listSnapshots, putSnapshot, SNAPSHOT_LIMIT, __resetForTests,
} from './repository';
import type { PersistedDiagram, DiagramSnapshot } from './repository';
```
(keep the existing `rec` helper and `describe('repository', …)` block unchanged), then append at the end of the file:
```ts
const snap = (id: string, diagramId: string, takenAt: number): DiagramSnapshot => ({
  id, diagramId, takenAt, name: 'd', dbml: `Table t { id int } // v${takenAt}`,
  positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
});

describe('snapshots', () => {
  beforeEach(async () => { await __resetForTests(); });

  it('lists snapshots for a diagram newest first, isolated per diagram', async () => {
    await putSnapshot(snap('a1', 'da', 100));
    await putSnapshot(snap('a2', 'da', 300));
    await putSnapshot(snap('b1', 'db', 200));
    expect((await listSnapshots('da')).map((s) => s.id)).toEqual(['a2', 'a1']);
    expect((await listSnapshots('db')).map((s) => s.id)).toEqual(['b1']);
  });

  it('prunes the ring buffer to SNAPSHOT_LIMIT per diagram', async () => {
    for (let i = 1; i <= SNAPSHOT_LIMIT + 3; i++) await putSnapshot(snap(`s${i}`, 'da', i));
    const all = await listSnapshots('da');
    expect(all).toHaveLength(SNAPSHOT_LIMIT);
    expect(all[0].takenAt).toBe(SNAPSHOT_LIMIT + 3); // newest kept
    expect(all[all.length - 1].takenAt).toBe(4);      // 1..3 pruned
  });

  it("deleteDiagram removes that diagram's snapshots only", async () => {
    await putDiagram(rec('da', 1));
    await putSnapshot(snap('a1', 'da', 100));
    await putSnapshot(snap('b1', 'db', 100));
    await deleteDiagram('da');
    expect(await listSnapshots('da')).toEqual([]);
    expect((await listSnapshots('db')).map((s) => s.id)).toEqual(['b1']);
  });

  it('upgrades a v1 database in place, preserving diagrams', async () => {
    // Recreate the exact Plan-1 schema: version 1, diagrams store only.
    const v1 = await openDB('dbdraft', 1, {
      upgrade(d) { d.createObjectStore('diagrams', { keyPath: 'id' }); },
    });
    await v1.put('diagrams', rec('legacy', 42));
    v1.close();
    // The repository now opens it at version 2 (oldVersion === 1 path).
    expect((await listDiagrams()).map((d) => d.id)).toEqual(['legacy']);
    await putSnapshot(snap('s1', 'legacy', 1));
    expect(await listSnapshots('legacy')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/persist` — Expected: FAIL (`listSnapshots`/`putSnapshot`/`SNAPSHOT_LIMIT`/`DiagramSnapshot` not exported).

- [ ] **Step 3: Implement**

`src/core/persist/repository.ts` (complete replacement):
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

/** One History entry. Ring buffer: at most SNAPSHOT_LIMIT rows per diagram. */
export interface DiagramSnapshot {
  id: string;
  diagramId: string;
  takenAt: number;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
}

export const SNAPSHOT_LIMIT = 20;

const DB_NAME = 'dbdraft';
const DB_VERSION = 2; // v1: diagrams. v2: + snapshots (keyPath id, index byDiagram).
const STORE = 'diagrams';
const SNAPSHOTS = 'snapshots';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      // Guarded per-version so both fresh installs (0 → 2) and existing
      // Plan-1 databases (1 → 2) arrive at the same shape without ever
      // touching existing diagram rows.
      if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' });
      if (oldVersion < 2) {
        const snaps = d.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
        snaps.createIndex('byDiagram', 'diagramId');
      }
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
  const d = await db();
  await d.delete(STORE, id);
  // History is per-diagram: deleting the diagram deletes its snapshots too.
  const snaps = (await d.getAllFromIndex(SNAPSHOTS, 'byDiagram', id)) as DiagramSnapshot[];
  await Promise.all(snaps.map((s) => d.delete(SNAPSHOTS, s.id)));
}

export async function listSnapshots(diagramId: string): Promise<DiagramSnapshot[]> {
  const all = (await (await db()).getAllFromIndex(SNAPSHOTS, 'byDiagram', diagramId)) as DiagramSnapshot[];
  return all.sort((a, b) => b.takenAt - a.takenAt);
}

/** Insert a snapshot, then prune the ring: only the newest SNAPSHOT_LIMIT
 *  rows for that diagram survive. */
export async function putSnapshot(snap: DiagramSnapshot): Promise<void> {
  const d = await db();
  await d.put(SNAPSHOTS, snap);
  const all = (await d.getAllFromIndex(SNAPSHOTS, 'byDiagram', snap.diagramId)) as DiagramSnapshot[];
  if (all.length > SNAPSHOT_LIMIT) {
    all.sort((a, b) => b.takenAt - a.takenAt);
    await Promise.all(all.slice(SNAPSHOT_LIMIT).map((s) => d.delete(SNAPSHOTS, s.id)));
  }
}

export async function __resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB(DB_NAME);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/persist src/app` — Expected: PASS (4 new tests; the existing repository tests AND the app persistence-race tests stay green — `deleteDiagram`'s new snapshot cleanup must not break them).

- [ ] **Step 5: Commit**

```bash
git add src/core/persist && git commit -m "feat: snapshot store — db v2 upgrade + per-diagram ring buffer"
```

---

### Task 5: Persistence wiring — importDiagram, snapshot-on-autosave, non-destructive restore

**Files:**
- Modify: `src/app/usePersistence.ts`
- Test: `src/app/snapshotFlow.test.ts` (new)

**Interfaces:**
- Consumes: `putSnapshot`, `listSnapshots`, `DiagramSnapshot` (Task 4), existing `saveCurrent`/`invalidatePendingAutosave` machinery, `nanoid`.
- Produces:
  - `interface ImportedDiagram { name: string; dbml: string; positions?: Record<string, TablePosition>; viewport?: Viewport }`
  - `importDiagram(imp: ImportedDiagram): Promise<void>` — always creates a NEW diagram (fresh id) with `createDiagram`'s exact call sequence: `await saveCurrent()` → `invalidatePendingAutosave()` → `putDiagram(new)` (try/caught → banner) → `loadDiagram(new)`.
  - `restoreSnapshot(snap: DiagramSnapshot): Promise<void>` — no-ops unless `snap.diagramId` is the current diagram; checkpoints the pre-restore state first (deduped); identical-text restores patch layout state directly instead of `loadDiagram` (see comment in code — avoids the `[diagramId, source]`-keyed parse pipeline never re-firing and leaving a blank canvas).
  - `saveCurrent` now runs `maybeSnapshot` **after** a successful `putDiagram` (trigger rule from Global Constraints), swallowing all snapshot failures.

- [ ] **Step 1: Write the failing test**

`src/app/snapshotFlow.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from './store';
import { EMPTY_SCHEMA } from '../core/model/types';
import { parseDbml } from '../core/parse/parseDbml';
import {
  putDiagram, getDiagram, listDiagrams, putSnapshot, listSnapshots, __resetForTests,
} from '../core/persist/repository';
import type { DiagramSnapshot, PersistedDiagram } from '../core/persist/repository';
import {
  scheduleAutosave, invalidatePendingAutosave, AUTOSAVE_DEBOUNCE_MS,
  importDiagram, restoreSnapshot,
} from './usePersistence';

const BASE = 'Table a { id int }';
const EDITED = 'Table a { id int }\nTable b { id int }';

const diagramA = (): PersistedDiagram => ({
  id: 'diagram-a', name: 'A', dbml: BASE,
  positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
});

const resetStore = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, editorFocusTableId: null, storageUnavailable: false,
  });

describe('snapshot + import persistence flows', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('writes a snapshot on a clean-parse autosave and dedupes identical text', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(EDITED)); // clean parse state
    vi.useFakeTimers();
    useAppStore.getState().setSource(EDITED);
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const snaps = await listSnapshots(a.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].dbml).toBe(EDITED);

    // an identical follow-up save must not add a second snapshot
    vi.useFakeTimers();
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await listSnapshots(a.id)).toHaveLength(1);
  });

  it('autosaves dirty text (never lose work) but does NOT snapshot it', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml('Table broken {')); // errors + stale
    vi.useFakeTimers();
    useAppStore.getState().setSource('Table broken {');
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect((await getDiagram(a.id))?.dbml).toBe('Table broken {'); // raw source still saved
    expect(await listSnapshots(a.id)).toEqual([]);                  // but never snapshotted
  });

  it('restore is non-destructive: checkpoints the pre-restore state first', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE));
    const old: DiagramSnapshot = {
      id: 'snap-old', diagramId: a.id, takenAt: 111, name: 'A',
      dbml: 'Table old { id int }', positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(old);

    await restoreSnapshot(old);

    expect(useAppStore.getState().source).toBe('Table old { id int }');
    expect((await getDiagram(a.id))?.dbml).toBe('Table old { id int }');
    const snaps = await listSnapshots(a.id);
    expect(snaps[0].dbml).toBe(BASE); // pre-restore checkpoint is the newest snapshot
    expect(snaps.map((s) => s.id)).toContain('snap-old');
  });

  it('restoring identical text patches layout without resetting the schema', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE));
    const schemaBefore = useAppStore.getState().schema;
    const snap: DiagramSnapshot = {
      id: 's-layout', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: { 'public.a': { x: 555, y: 66 } }, viewport: { x: 1, y: 2, zoom: 0.5 },
    };
    await putSnapshot(snap);

    await restoreSnapshot(snap);

    const st = useAppStore.getState();
    expect(st.schema).toBe(schemaBefore); // no EMPTY_SCHEMA reset, no stuck parse
    expect(st.positions['public.a']).toEqual({ x: 555, y: 66 });
    expect(st.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
    expect((await getDiagram(a.id))?.positions['public.a']).toEqual({ x: 555, y: 66 });
  });

  it('import creates a NEW diagram and never overwrites the current one', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    vi.useFakeTimers();
    useAppStore.getState().setSource(EDITED);
    scheduleAutosave(); // a pending edit on A when the import lands
    const done = importDiagram({ name: 'Imported', dbml: 'Table z { id int }' });
    await vi.runAllTimersAsync();
    await done;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 500);
    vi.useRealTimers();

    const st = useAppStore.getState();
    expect(st.diagramId).not.toBe(a.id);
    expect(st.source).toBe('Table z { id int }');
    expect(st.diagramName).toBe('Imported');
    expect((await getDiagram(a.id))?.dbml).toBe(EDITED); // A kept its flushed edit
    expect(await listDiagrams()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/snapshotFlow.test.ts` — Expected: FAIL (`importDiagram` / `restoreSnapshot` not exported from `./usePersistence`).

- [ ] **Step 3: Implement** — in `src/app/usePersistence.ts`:

Replace the repository import lines with:
```ts
import {
  listDiagrams, getDiagram, putDiagram, deleteDiagram, listSnapshots, putSnapshot,
} from '../core/persist/repository';
import type { DiagramSnapshot } from '../core/persist/repository';
import type { TablePosition, Viewport } from '../core/model/types';
```

Replace the existing `saveCurrent` function with (and add `maybeSnapshot` directly above it):
```ts
// Snapshot policy (History): every successful diagram write below produces
// a snapshot CANDIDATE. It is kept only when (a) the parse state LOOKS
// clean (`!stale && errors.length === 0`) and (b) the text differs from the
// newest stored snapshot. Note the gate is approximate: stale/errors
// reflect the last COMPLETED parse, so a slow worker parse still in flight
// when the 1 s autosave fires can let a not-yet-validated text through —
// same race class as the applyFormat stale-check ledger item; move to a
// `parsedSource === dbml` gate once a parsedSource field exists.
// Layout-only saves (drag/pan) and the keystroke stream (1 s debounce)
// never snapshot. Runs strictly AFTER putDiagram has succeeded and swallows
// every failure: history is best-effort and must never break, abort, or
// reorder the diagram save itself.
async function maybeSnapshot(rec: DiagramRecord): Promise<void> {
  const s = useAppStore.getState();
  if (s.stale || s.errors.length > 0) return;
  try {
    const newest = (await listSnapshots(rec.id))[0];
    if (newest && newest.dbml === rec.dbml) return;
    await putSnapshot({
      id: nanoid(),
      diagramId: rec.id,
      takenAt: rec.updatedAt,
      name: rec.name,
      dbml: rec.dbml,
      positions: rec.positions,
      viewport: rec.viewport,
    });
  } catch {
    // best-effort: the diagram row itself was already saved above; a failed
    // snapshot write must not surface or flip the storage banner.
  }
}

async function saveCurrent(): Promise<void> {
  const rec = currentRecord();
  if (!rec) return;
  try {
    await putDiagram(rec);
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
    return;
  }
  await maybeSnapshot(rec);
}
```

Append after `renameDiagram` (before `usePersistence`):
```ts
export interface ImportedDiagram {
  name: string;
  dbml: string;
  positions?: Record<string, TablePosition>;
  viewport?: Viewport;
}

// Import ALWAYS creates a new diagram — it must never overwrite the current
// one (spec §3). Exact same discipline as createDiagram: flush the current
// diagram, then synchronously invalidate its pending autosave before the
// awaits tied to the switch.
export async function importDiagram(imp: ImportedDiagram): Promise<void> {
  await saveCurrent();
  invalidatePendingAutosave();
  const rec: DiagramRecord = {
    id: nanoid(),
    name: imp.name.trim() || 'Imported',
    dbml: imp.dbml,
    positions: imp.positions ?? {},
    viewport: imp.viewport ?? { x: 40, y: 40, zoom: 1 },
    updatedAt: Date.now(),
  };
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  useAppStore.getState().loadDiagram(rec);
}

// Restore a snapshot into the CURRENT diagram (same id). Non-destructive:
// the pre-restore state is checkpointed first (deduped against the newest
// snapshot), so a restore can itself be undone from the History panel.
// The checkpoint deliberately has no clean-parse gate — restore must never
// destroy state, even mid-error.
export async function restoreSnapshot(snap: DiagramSnapshot): Promise<void> {
  const cur = currentRecord();
  if (!cur || cur.id !== snap.diagramId) return;
  invalidatePendingAutosave();
  try {
    const newest = (await listSnapshots(cur.id))[0];
    if (!newest || newest.dbml !== cur.dbml) {
      await putSnapshot({
        id: nanoid(), diagramId: cur.id, takenAt: Date.now(), name: cur.name,
        dbml: cur.dbml, positions: cur.positions, viewport: cur.viewport,
      });
    }
  } catch {
    // history is best-effort; the restore itself proceeds
  }
  const rec: DiagramRecord = {
    id: cur.id, name: snap.name, dbml: snap.dbml,
    positions: snap.positions, viewport: snap.viewport, updatedAt: Date.now(),
  };
  try { await putDiagram(rec); } catch { useAppStore.getState().setStorageUnavailable(true); }
  if (snap.dbml === cur.dbml) {
    // Text unchanged: loadDiagram would reset schema to EMPTY_SCHEMA and the
    // parse pipeline — keyed on [diagramId, source], both unchanged — would
    // never re-fire, leaving a blank canvas. Patch layout state directly and
    // keep the live schema.
    useAppStore.setState({ diagramName: rec.name, positions: rec.positions, viewport: rec.viewport });
  } else {
    useAppStore.getState().loadDiagram(rec);
  }
}
```

**Ledger entry (do this as part of this step):** append to `.superpowers/sdd/progress.md`: "P4: snapshot gate should move to `parsedSource === dbml` once a parsedSource field exists (stale/errors reflect the last completed parse; a slow in-flight worker parse can let unvalidated text snapshot — same race class as the applyFormat stale check)."

**Implementation note — accepted race, do NOT "fix" it:** an autosave callback already mid-`putDiagram` when `restoreSnapshot` runs (i.e. past the generation check, awaiting IndexedDB) can transiently write the pre-restore text after restore's own `putDiagram`. This self-heals within ~1 s: both restore branches mutate state the `usePersistence` subscription watches (`source`/`positions`/`viewport`/`diagramName`), which re-arms the debounced autosave and re-writes the restored record. Implementers must not remove `invalidatePendingAutosave()` or reorder the puts to chase this window — that discipline is what prevents the far worse delete-resurrection class of bugs (see `persistenceRace.test.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app` — Expected: PASS (5 new tests; `persistenceRace.test.ts` and `parseResubscribe.test.ts` must stay green — the `saveCurrent` change adds a post-save step but never throws).

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && git add src/app/usePersistence.ts src/app/snapshotFlow.test.ts && git commit -m "feat: import-as-new-diagram, snapshot-on-autosave, non-destructive restore"
```

---

### Task 6: Download helper + Export menu (DBML / SQL / project) + banner escape hatch

**Files:**
- Create: `src/app/export/download.ts`
- Create: `src/app/ExportMenu.tsx`
- Modify: `src/app/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `exportSql`/`SqlDialect` (Task 1), `serializeProject` (Task 2), `safeFilename` (Task 3), `useAppStore`.
- Produces:
  - `downloadBlob(blob: Blob, filename: string): void`
  - `downloadText(text: string, filename: string, mime?: string): void`
  - `<ExportMenu />` — toolbar dropdown: DBML (always enabled), SQL × 3 dialects (disabled while `stale || errors.length > 0`), project file (always enabled). Escape closes it. All items read only the in-memory store — they work with storage unavailable.
  - Storage-unavailable banner gains a working "Download your work (.dbml)" button.

- [ ] **Step 1: Implement**

`src/app/export/download.ts`:
```ts
/** DOM-side download helpers — deliberately OUTSIDE src/core (core purity). */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
```

`src/app/ExportMenu.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { exportSql, type SqlDialect } from '../core/convert/convert';
import { serializeProject } from '../core/convert/projectFile';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';

const SQL_DIALECTS: Array<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgres', label: 'PostgreSQL' },
  { dialect: 'mysql', label: 'MySQL' },
  { dialect: 'mssql', label: 'SQL Server' },
];

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const sqlDisabled = stale || errors.length > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const exportDbml = () => {
    const s = useAppStore.getState();
    downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
    setOpen(false);
  };

  const exportProject = () => {
    const s = useAppStore.getState();
    downloadText(
      serializeProject({ name: s.diagramName, dbml: s.source, positions: s.positions, viewport: s.viewport }),
      `${safeFilename(s.diagramName)}.json`,
      'application/json',
    );
    setOpen(false);
  };

  const exportAsSql = async (dialect: SqlDialect) => {
    const s = useAppStore.getState();
    const r = await exportSql(s.source, dialect);
    if (r.ok) downloadText(r.text, `${safeFilename(s.diagramName)}.${dialect}.sql`);
    else window.alert(`SQL export failed: ${r.errors[0]?.message ?? 'unknown error'}`);
    setOpen(false);
  };

  return (
    <div className="export-menu">
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} export</button>
      {open && (
        <ul className="export-list">
          <li><button onClick={exportDbml}>DBML (.dbml)</button></li>
          {SQL_DIALECTS.map(({ dialect, label }) => (
            <li key={dialect}>
              <button
                disabled={sqlDisabled}
                title={sqlDisabled ? 'Fix parse errors first' : undefined}
                onClick={() => void exportAsSql(dialect)}
              >
                SQL — {label}
              </button>
            </li>
          ))}
          <li><button onClick={exportProject}>Project file (.json)</button></li>
        </ul>
      )}
    </div>
  );
}
```

In `src/app/App.tsx`: add imports
```tsx
import { ExportMenu } from './ExportMenu';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';
```
add `<ExportMenu />` to the toolbar directly after the Format button, and replace the banner block with:
```tsx
{storageUnavailable && (
  <div className="banner-warning">
    <span>Browser storage is unavailable — your work is NOT being saved. Keep this tab open.</span>
    <button
      className="banner-action"
      onClick={() => {
        const s = useAppStore.getState();
        downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
      }}
    >
      Download your work (.dbml)
    </button>
  </div>
)}
```

Append to `src/styles.css`:
```css
.export-menu { position: relative; }
.export-menu > button { font-size: 12px; padding: 3px 8px; border: 1px solid var(--border); background: #fff; border-radius: 4px; cursor: pointer; }
.export-list {
  position: absolute; top: 30px; left: 0; z-index: 20; min-width: 200px;
  background: #fff; border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); list-style: none; margin: 0; padding: 4px;
}
.export-list button { display: block; width: 100%; text-align: left; border: none; background: none; padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
.export-list button:hover:not(:disabled) { background: #eef3fe; }
.export-list button:disabled { opacity: 0.45; cursor: not-allowed; }
.banner-warning { display: flex; align-items: center; gap: 12px; }
.banner-action { border: 1px solid #a33; background: #fff; color: #a33; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean, and the build output must NOT show `@dbml/core` in the main `index-*.js` chunk (the multi-MB chunk stays lazy; `ExportMenu` imports `convert.ts` statically, but `convert.ts` only references `@dbml/core` via `import()`).

Manual browser check:
1. export → DBML downloads `<name>.dbml` with the exact editor text.
2. export → SQL (each dialect) downloads `<name>.<dialect>.sql` containing `CREATE TABLE`; the first SQL export shows a short delay (lazy chunk), later ones are instant.
3. With a syntax error present, the three SQL items are disabled (tooltip), DBML/project still work.
4. export → project file downloads JSON with `version`, `name`, `dbml`, `layout`, `viewport`.
5. Escape closes the menu.
6. Network tab: no `@dbml/core`-sized chunk loads on page load; it loads on the first SQL export only.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: export menu (dbml/sql/project), download helper, banner escape hatch"
```

---

### Task 7: SVG scene serialization + PNG (2x) export

**Files:**
- Create: `src/app/export/svgExport.ts`
- Modify: `src/app/ExportMenu.tsx`

**Interfaces:**
- Consumes: `unionRects`/`expandRect`/`getTableRect` (Task 3 / core geometry), `EXPORT_CSS`/`resolveCssVars` (Task 3), `downloadBlob` (Task 6), `useAppStore`, live DOM (`svg.diagram-canvas` — the single canvas SVG `DiagramCanvas` renders, whose only child is the scene `<g>`).
- Produces:
  - `EXPORT_MARGIN = 48`
  - `interface BuiltSvg { markup: string; width: number; height: number }`
  - `buildDiagramSvg(): BuiltSvg | null` — full-diagram bounds (not viewport), viewport transform stripped, CSS variables resolved into an embedded `<style>`, background rect from `--bg`; `null` when nothing to export.
  - `buildPngBlob(scale?: number): Promise<Blob | null>` — rasterizes at 2x by default via offscreen `<canvas>`.
  - ExportMenu gains "SVG (.svg)" and "PNG (2x)" items, disabled when the schema has no tables.

- [ ] **Step 1: Implement**

`src/app/export/svgExport.ts`:
```ts
import { useAppStore } from '../store';
import { getTableRect, unionRects, expandRect } from '../../core/model/geometry';
import { EXPORT_CSS, resolveCssVars } from './exportCss';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Extra space around the table bounding box so orthogonal edge routes and
 *  cardinality labels that swing outside the table rects are not clipped. */
export const EXPORT_MARGIN = 48;

export interface BuiltSvg {
  markup: string;
  width: number;
  height: number;
}

/** Serialize the live canvas scene into a standalone SVG document string.
 *  - full-diagram bounds (union of all table rects + margin), NOT the viewport
 *  - the scene <g>'s pan/zoom transform is stripped from the clone
 *  - styles inlined via an embedded <style> block, with every CSS variable
 *    resolved against the live document — theme-correct once Plan 3 lands
 *    CSS-variable theming
 *  - fonts are the system stack; nothing to embed
 *  Returns null when there is nothing to export (no canvas / no tables). */
export function buildDiagramSvg(): BuiltSvg | null {
  const live = document.querySelector('svg.diagram-canvas');
  const scene = live?.firstElementChild ?? null; // the single scene <g>
  const { schema, positions } = useAppStore.getState();
  const rects = schema.tables
    .filter((t) => positions[t.id])
    .map((t) => getTableRect(t, positions[t.id]));
  const bounds = unionRects(rects);
  if (!scene || !bounds) return null;
  const b = expandRect(bounds, EXPORT_MARGIN);

  const rootStyle = getComputedStyle(document.documentElement);
  const getVar = (name: string) => rootStyle.getPropertyValue(name);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(b.w));
  svg.setAttribute('height', String(b.h));
  svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = resolveCssVars(EXPORT_CSS, getVar);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(b.x));
  bg.setAttribute('y', String(b.y));
  bg.setAttribute('width', String(b.w));
  bg.setAttribute('height', String(b.h));
  bg.setAttribute('fill', getVar('--bg').trim() || '#ffffff');

  // Clone the live scene; drop the viewport pan/zoom so the viewBox rules.
  // Transient UI classes (.focused, .hot) survive the clone, but EXPORT_CSS
  // defines no rules for them, so they render as normal tables/edges.
  const clone = scene.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');

  svg.append(style, bg, clone);
  return { markup: new XMLSerializer().serializeToString(svg), width: b.w, height: b.h };
}

/** Rasterize the built SVG at `scale`× via an offscreen <canvas>. The SVG is
 *  loaded through a same-origin blob URL and contains no external
 *  references, so the canvas is never tainted and toBlob is allowed. */
export async function buildPngBlob(scale = 2): Promise<Blob | null> {
  const built = buildDiagramSvg();
  if (!built) return null;
  const url = URL.createObjectURL(new Blob([built.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(built.width * scale));
    canvas.height = Math.max(1, Math.round(built.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

`src/app/ExportMenu.tsx` (complete replacement — adds the two image items):
```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { exportSql, type SqlDialect } from '../core/convert/convert';
import { serializeProject } from '../core/convert/projectFile';
import { downloadBlob, downloadText } from './export/download';
import { safeFilename } from './export/exportCss';
import { buildDiagramSvg, buildPngBlob } from './export/svgExport';

const SQL_DIALECTS: Array<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgres', label: 'PostgreSQL' },
  { dialect: 'mysql', label: 'MySQL' },
  { dialect: 'mssql', label: 'SQL Server' },
];

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const sqlDisabled = stale || errors.length > 0;
  const imageDisabled = tableCount === 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const exportDbml = () => {
    const s = useAppStore.getState();
    downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
    setOpen(false);
  };

  const exportProject = () => {
    const s = useAppStore.getState();
    downloadText(
      serializeProject({ name: s.diagramName, dbml: s.source, positions: s.positions, viewport: s.viewport }),
      `${safeFilename(s.diagramName)}.json`,
      'application/json',
    );
    setOpen(false);
  };

  const exportAsSql = async (dialect: SqlDialect) => {
    const s = useAppStore.getState();
    const r = await exportSql(s.source, dialect);
    if (r.ok) downloadText(r.text, `${safeFilename(s.diagramName)}.${dialect}.sql`);
    else window.alert(`SQL export failed: ${r.errors[0]?.message ?? 'unknown error'}`);
    setOpen(false);
  };

  const exportSvgFile = () => {
    const built = buildDiagramSvg();
    if (built) {
      const name = useAppStore.getState().diagramName;
      downloadBlob(new Blob([built.markup], { type: 'image/svg+xml' }), `${safeFilename(name)}.svg`);
    }
    setOpen(false);
  };

  const exportPngFile = async () => {
    // Same alert pattern as SQL export: rasterization can reject
    // (img.onerror) and toBlob can yield null when the 2x canvas exceeds
    // the browser's size limit (~120+ tables) — neither may surface as an
    // unhandled rejection or a silent no-op.
    try {
      const blob = await buildPngBlob(2);
      if (!blob) throw new Error('canvas too large or rasterization failed');
      const name = useAppStore.getState().diagramName;
      downloadBlob(blob, `${safeFilename(name)}.png`);
    } catch (e) {
      window.alert(`PNG export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    setOpen(false);
  };

  return (
    <div className="export-menu">
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} export</button>
      {open && (
        <ul className="export-list">
          <li><button onClick={exportDbml}>DBML (.dbml)</button></li>
          {SQL_DIALECTS.map(({ dialect, label }) => (
            <li key={dialect}>
              <button
                disabled={sqlDisabled}
                title={sqlDisabled ? 'Fix parse errors first' : undefined}
                onClick={() => void exportAsSql(dialect)}
              >
                SQL — {label}
              </button>
            </li>
          ))}
          <li><button disabled={imageDisabled} onClick={exportSvgFile}>SVG (.svg)</button></li>
          <li><button disabled={imageDisabled} onClick={() => void exportPngFile()}>PNG (2x)</button></li>
          <li><button onClick={exportProject}>Project file (.json)</button></li>
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean.

Manual browser check:
1. Zoom into one corner of a multi-table diagram, export SVG → the file contains the **whole** diagram (bounds, not viewport), opens standalone in a browser tab with correct colors and fonts.
2. `grep -c 'var(' <exported>.svg` → 0 (all variables resolved).
3. Export PNG → image dimensions are exactly 2× the SVG's `width`/`height`; background is opaque (no transparency checkerboard).
4. Hover a table (edges "hot") and keep the editor caret inside a table (focused outline), then export → no highlight artifacts in the output.
5. Empty diagram (`Table`-less doc): SVG/PNG items disabled.

- [ ] **Step 3: Commit**

```bash
git add src/app/export/svgExport.ts src/app/ExportMenu.tsx && git commit -m "feat: svg scene serialization + 2x png export"
```

---

### Task 8: Import dialog — SQL / DBML / project file, always a new diagram

**Files:**
- Create: `src/app/ImportDialog.tsx`
- Modify: `src/app/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `importSql`/`SqlDialect` (Task 1), `parseProject` (Task 2), `importDiagram` (Task 5), `ParseError` type.
- Produces: `<ImportDialog onClose={() => void} />` — modal with source-kind selector (3 SQL dialects, DBML, project JSON), paste textarea, file picker (`.sql`/`.dbml`/`.json`), error list with line:column context. Success imports as a NEW diagram and closes; failure renders the errors inside the dialog and leaves the current diagram untouched. Escape and backdrop-click dismiss.

- [ ] **Step 1: Implement**

`src/app/ImportDialog.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { importSql, type SqlDialect } from '../core/convert/convert';
import { parseProject } from '../core/convert/projectFile';
import { importDiagram } from './usePersistence';
import type { ParseError } from '../core/parse/parseDbml';

type ImportKind = SqlDialect | 'dbml' | 'project';

const KIND_OPTIONS: Array<{ kind: ImportKind; label: string }> = [
  { kind: 'postgres', label: 'PostgreSQL DDL' },
  { kind: 'mysql', label: 'MySQL DDL' },
  { kind: 'mssql', label: 'SQL Server DDL' },
  { kind: 'dbml', label: 'DBML' },
  { kind: 'project', label: 'Project file (.json)' },
];

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ImportKind>('postgres');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErrors([]);
    setFileName(f.name);
    try {
      setText(await f.text());
    } catch (e) {
      // File.text() can reject (file moved/deleted after picking, permission
      // revoked, decode failure) — surface it in the dialog instead of the
      // void'd promise swallowing it. No store/repo writes on this path.
      setErrors([{ message: `Could not read file: ${e instanceof Error ? e.message : String(e)}`, line: 1, column: 1 }]);
      return;
    }
    if (/\.dbml$/i.test(f.name)) setKind('dbml');
    else if (/\.json$/i.test(f.name)) setKind('project');
  };

  const baseName = (fallback: string) =>
    fileName ? fileName.replace(/\.[^.]+$/, '') : fallback;

  const runImport = async () => {
    setErrors([]);
    if (text.trim() === '') {
      setErrors([{ message: 'Nothing to import — paste text or choose a file.', line: 1, column: 1 }]);
      return;
    }
    setBusy(true);
    try {
      if (kind === 'dbml') {
        // No pre-validation: the user's file is imported verbatim; any syntax
        // errors surface in the editor + problems panel of the NEW diagram.
        await importDiagram({ name: baseName('Imported'), dbml: text });
      } else if (kind === 'project') {
        const r = parseProject(text);
        if (!r.ok) {
          setErrors([{ message: r.error, line: 1, column: 1 }]);
          return; // current diagram untouched
        }
        await importDiagram({
          name: r.project.name,
          dbml: r.project.dbml,
          positions: r.project.layout,
          viewport: r.project.viewport,
        });
      } else {
        const r = await importSql(text, kind);
        if (!r.ok) {
          setErrors(r.errors); // importer message with line context; current diagram untouched
          return;
        }
        await importDiagram({ name: baseName('Imported'), dbml: r.text });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Import — creates a new diagram</h3>
        <div className="dialog-row">
          <select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind}>{o.label}</option>
            ))}
          </select>
          <input
            type="file"
            accept=".sql,.dbml,.json,.txt"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        <textarea
          className="dialog-text"
          placeholder="Paste SQL DDL, DBML, or a project file here…"
          value={text}
          onChange={(e) => { setText(e.target.value); setErrors([]); }}
        />
        {errors.length > 0 && (
          <ul className="dialog-errors">
            {errors.map((er, i) => (
              <li key={`${er.line}:${er.column}:${i}`}>
                <span className="problem-loc">{er.line}:{er.column}</span> {er.message}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => void runImport()}>
            {busy ? 'Importing…' : 'Import as new diagram'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

In `src/app/App.tsx`: add imports
```tsx
import { useState } from 'react';
import { ImportDialog } from './ImportDialog';
```
add inside the `App` component body:
```tsx
const [importOpen, setImportOpen] = useState(false);
```
add to the toolbar between `<DiagramManager />` and the Format button:
```tsx
<button onClick={() => setImportOpen(true)}>Import</button>
```
and mount the dialog just before the closing `</div>` of `.app-shell`:
```tsx
{importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
```

Append to `src/styles.css`:
```css
.dialog-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); z-index: 50; display: flex; align-items: center; justify-content: center; }
.dialog { background: #fff; border-radius: 8px; padding: 16px; width: min(640px, 90vw); max-height: 80vh; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.25); }
.dialog h3 { margin: 0; font-size: 15px; }
.dialog-row { display: flex; gap: 8px; align-items: center; }
.dialog-text { width: 100%; min-height: 220px; resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; border: 1px solid var(--border); border-radius: 4px; }
.dialog-errors { list-style: none; margin: 0; padding: 6px 8px; background: #fff6f6; border: 1px solid #f3c2c2; border-radius: 4px; color: var(--error); font-size: 12px; max-height: 120px; overflow-y: auto; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dialog-actions button { font-size: 13px; padding: 5px 12px; border: 1px solid var(--border); background: #fff; border-radius: 4px; cursor: pointer; }
.dialog-actions .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.dialog-actions .primary:disabled { opacity: 0.6; cursor: wait; }
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean.

Manual browser check:
1. Import → paste the PostgreSQL DDL `CREATE TABLE users (id integer PRIMARY KEY);` → a NEW diagram appears (old one intact in the diagrams list), canvas renders `users`.
2. Paste garbage SQL → error with line:column shown inside the dialog; the diagram behind the dialog is untouched; fix the SQL → import succeeds.
3. Open a `.dbml` file via the picker → kind auto-switches to DBML, import creates a new diagram named after the file stem.
4. Export a project file (Task 6), then import it → new diagram with identical table positions and viewport.
5. Import a truncated/corrupted project JSON → readable error in the dialog.
6. Escape and backdrop-click both close the dialog; a repeat SQL import shows no chunk-load delay.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: import dialog (sql/dbml/project) creating new diagrams"
```

---

### Task 9: History panel — list snapshots, restore per row

**Files:**
- Create: `src/app/HistoryPanel.tsx`
- Modify: `src/app/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `listSnapshots`/`DiagramSnapshot` (Task 4), `restoreSnapshot` (Task 5), `useAppStore`.
- Produces: `<HistoryPanel />` — toolbar dropdown listing the current diagram's snapshots newest-first with timestamps and a restore button per row; restoring refreshes the list in place (the pre-restore checkpoint appears at the top). Escape closes. Empty state explains the trigger rule.

- [ ] **Step 1: Implement**

`src/app/HistoryPanel.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listSnapshots } from '../core/persist/repository';
import type { DiagramSnapshot } from '../core/persist/repository';
import { restoreSnapshot } from './usePersistence';

export function HistoryPanel() {
  const diagramId = useAppStore((s) => s.diagramId);
  const [open, setOpen] = useState(false);
  const [snaps, setSnaps] = useState<DiagramSnapshot[]>([]);

  const refresh = (id: string) => {
    void listSnapshots(id).then(setSnaps).catch(() => setSnaps([]));
  };

  useEffect(() => {
    if (open && diagramId) refresh(diagramId);
  }, [open, diagramId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const restore = (snap: DiagramSnapshot) => {
    // restoreSnapshot keeps the diagram id, so refreshing with the captured
    // id is safe; the pre-restore checkpoint shows up at the top of the list.
    void restoreSnapshot(snap).then(() => refresh(snap.diagramId));
  };

  return (
    <div className="history-wrap">
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} history</button>
      {open && (
        <div className="history-panel">
          <div className="history-header">Snapshots — newest first, last 20 kept</div>
          {snaps.length === 0 ? (
            <p className="history-empty">
              No snapshots yet. One is written on each autosave once the document parses cleanly.
            </p>
          ) : (
            <ul>
              {snaps.map((s) => (
                <li key={s.id}>
                  <span className="when">{new Date(s.takenAt).toLocaleString()}</span>
                  <span className="history-meta">{s.dbml.length} chars</span>
                  <button onClick={() => restore(s)}>restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

In `src/app/App.tsx`: add
```tsx
import { HistoryPanel } from './HistoryPanel';
```
and mount `<HistoryPanel />` in the toolbar directly after `<ExportMenu />`.

Append to `src/styles.css`:
```css
.history-wrap { position: relative; }
.history-wrap > button { font-size: 12px; padding: 3px 8px; border: 1px solid var(--border); background: #fff; border-radius: 4px; cursor: pointer; }
.history-panel {
  position: absolute; top: 30px; left: 0; z-index: 20; width: 320px; max-height: 60vh; overflow-y: auto;
  background: #fff; border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 8px; font-size: 12px;
}
.history-header { font-weight: 600; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.history-panel ul { list-style: none; margin: 6px 0 0; padding: 0; }
.history-panel li { display: flex; align-items: center; gap: 8px; padding: 5px 2px; border-bottom: 1px solid var(--border); }
.history-panel .when { flex: 1; }
.history-meta { color: var(--text-dim); font-size: 10px; }
.history-panel li button { font-size: 11px; padding: 2px 8px; border: 1px solid var(--border); background: #fff; border-radius: 4px; cursor: pointer; }
.history-empty { color: var(--text-dim); margin: 8px 0 2px; }
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean.

Manual browser check:
1. Type a valid edit, pause >1 s → history shows a new snapshot; keep typing without pausing → no snapshot per keystroke.
2. Drag a table around (no text change), pause → NO new snapshot (layout-only saves never snapshot).
3. Restore an older snapshot → editor + canvas update; the list now has a new top entry (the pre-restore checkpoint); restoring that checkpoint returns to the pre-restore text (non-destructive round-trip).
4. Make >20 clean-parse edits → the list caps at 20, oldest dropped.
5. Switch diagrams → the panel shows only the current diagram's snapshots. Escape closes it.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: history panel with snapshot restore"
```

---

### Task 10: Integration pass — bundle budget, purity audit, walkthrough, tag

**Files:** none new.

- [ ] **Step 1: Full verification**

Run: `npx vitest run` — Expected: all tests pass (~143; Plan 2 ended at 109, this plan adds ~34: T1 8, T2 8, T3 9, T4 4, T5 5).
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 2: Bundle-size verification (build must prove the lazy-chunk invariant)**

Run: `npm run build` — Expected: clean build. In the emitted asset list:
- the main `dist/assets/index-*.js` gzip size is **≤ 210 kB** (Plan 2 baseline 197.8 kB; this plan adds only small UI + facades to the main chunk);
- the multi-MB `@dbml/core` chunk still exists as a **separate lazy** chunk (loaded by the worker and, now shared, by the convert facade).

If the main chunk ballooned, a static `@dbml/core` (or `parseDbml`) import leaked into main-thread code — find it with the Step 3 greps before proceeding.

- [ ] **Step 3: Constraint audit**

```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output (core purity — convert + persist stayed pure; download/svgExport live in `src/app/export/`).

```bash
grep -rn "from '@dbml/core'" src/ | grep -v "src/core/parse/parseDbml.ts" || true
```
Expected: no output (the only static importer of `@dbml/core` remains `parseDbml.ts`; `convert.ts` uses `import('@dbml/core')` only — verify with `grep -n "import('@dbml/core')" src/core/convert/convert.ts`).

Then update CLAUDE.md so future audits don't flag the snapshot behavior as a deviation: in the **Persistence safety** paragraph of `/Users/sharif/Documents/dbdiagram/CLAUDE.md`, append this sentence after "…never an unhandled rejection.":

> Snapshots (History) are deliberately best-effort: `maybeSnapshot` runs only after `putDiagram` has succeeded and swallows every failure without flipping `storageUnavailable` — the diagram write just proved storage works, so a failed snapshot must never surface or abort a save.

- [ ] **Step 4: Browser walkthrough**

Dev server (`npm run dev`):
1. Import each SQL dialect (paste + file); garbage SQL shows the importer's line-context error in the dialog with the current diagram untouched; every import lands as a NEW diagram.
2. Open a `.dbml` file; import a previously exported project file → positions + viewport restored exactly.
3. Export all six formats (DBML, 3× SQL, SVG, PNG 2x, project JSON); PNG is 2× the SVG dimensions; SVG opens standalone with resolved colors.
4. History: snapshots appear on clean-parse pauses only; restore is non-destructive (checkpoint on top); ring caps at 20; per-diagram isolation.
5. Escape dismisses import dialog, export menu, and history panel.
6. Regression sweep: type→render, break syntax→stale badge (canvas never blanks), drag/pan/zoom, diagram switch/duplicate/delete, reload→everything restored.
7. Storage-unavailable path (DevTools → Application → simulate, or Firefox private window): banner shows and its "Download your work (.dbml)" button downloads the current text; exports still work.

- [ ] **Step 5: Commit + tag**

```bash
git add -A && git commit -m "chore: plan 4 complete — interop" --allow-empty
git tag plan-4-complete
```

---

## Self-review checklist (done at authoring time)

- Spec §3 Import row (3 SQL dialects, open/paste .dbml, import-creates-new) → Tasks 1, 5, 8. Export row (SQL ×3, .dbml, PNG 2x, SVG, project file) → Tasks 1, 6, 7. Persistence row (snapshots ring 20 + History restore) → Tasks 4, 5, 9. §8 (snapshots, storage-unavailable escape hatch) → Tasks 5, 6. §9 (SQL import failure UX) → Task 8. §11.5 fully covered; nothing beyond it added.
- `@dbml/core` call shapes cited from the installed 8.3.1 `types/` and empirically verified (import/export per dialect, single-line DBML through `exporter.export`, `CompilerError.diags` shape, round-trips).
- Cross-task signatures checked: `ConvertResult`/`SqlDialect` (T1→T6/T8), `ProjectFile.layout` (T2→T6/T8), `unionRects`/`expandRect` (T3→T7), `DiagramSnapshot`/`SNAPSHOT_LIMIT` (T4→T5/T9), `importDiagram`/`restoreSnapshot` (T5→T8/T9), `downloadBlob`/`downloadText` (T6→T7), `BuiltSvg`/`buildPngBlob` (T7).
- No placeholders: every code step contains the complete code; component tasks verify via build + browser checklist per the Plan 2 template.
