# dbdiagram Clone — Plan 6: UX Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the visible UX gap with dbdiagram.io. (A) Toolbar dropdowns (Export, History) open on hover — 100 ms open delay, 250 ms close grace — via one shared `useHoverMenu` hook, restyled to dbdiagram's roomier look with grouped Export items including the newly verified Oracle dialect (import AND export, both empirically supported by the installed `@dbml/core` 8.3.1). (B) A per-table settings popover (gear on table-header hover) that renames a table and sets/updates/removes its `headerColor` — **by rewriting the DBML header line through a new `editorNav.applyTableSettings` bridge in ONE CodeMirror transaction**, never by writing schema state. (C) A dbdiagram-style project dashboard replacing the diagrams dropdown: search, Name/Modified/Created columns (new optional `createdAt`, backward compatible), per-row kebab with Open/Rename/Duplicate/Delete. (D) A right-edge "Diagram Views" sidebar toggling per-table/per-schema visibility — new `hiddenTableIds` layout state, persisted/snapshotted/project-filed exactly like `notePositions`, honored by TableNode render, EdgeLayer, MiniMap, fit, marquee, export bounds, and ELK layout. (E) A bottom-left control cluster: keyboard-shortcuts popover, snap toggle (`snapEnabled`), and a Detail dropdown (`lodOverride`: Auto/Full/Headers/Boxes) — session-only state.

**Architecture:** Pure logic stays pure and unit-tested in vitest's node env: the header-line rewriter (`src/editor/tableSettings.ts`), date labels (`src/app/relativeDate.ts`), visibility helpers (`src/core/model/visibility.ts`), hidden-aware `computeExportBounds`/`buildElkGraph`, and `effectiveLod`. The canvas→text bridge lives where the other sanctioned bridges live (`src/editor/editorNav.ts`, single-registered-view). Canvas-adjacent HTML UI (settings popover, views sidebar, control cluster) renders in `DiagramCanvas`'s existing `.canvas-wrap` HTML layer — never inside the memoized SVG hot path; `TableNode` gains exactly one new prop (`onOpenSettings`, referentially stable). The sidebar's center-on-table uses a new `canvasNav.ts` registered handle, the same pattern as `editorNav`. Visibility filtering runs at render time from committed store state (memoized `Set`), adding zero per-tick work to the imperative pan/drag paths. React wiring is browser-verified per repo convention; four new Playwright specs (`e2e/ux.spec.ts`) pin the golden flows.

**Tech Stack:** Existing Plans 1–5 stack. **No new dependencies, runtime or dev.** Icons are inline SVG paths / unicode glyphs only.

## Verified environment facts (checked empirically on 2026-07-13 against the working tree and the INSTALLED packages — do not trust memory)

- HEAD is `aad930a` on `main`, clean tree; **237/237** vitest unit tests, **9/9** Playwright e2e; last bundle gate on main measured **206,739 / 215,040** gzip bytes (progress.md, Plan 5 merge) — ~8.3 kB headroom under the 210 KiB budget.
- **Oracle support in the installed `@dbml/core` 8.3.1** (run via `node --input-type=module`, importing the real package):
  - `exporter.export(dbml, 'oracle')` → works: `CREATE TABLE "users" (\n  "id" integer PRIMARY KEY, …`.
  - `importer.import('CREATE TABLE refunds (id NUMBER PRIMARY KEY, amount NUMBER(10,2) NOT NULL);', 'oracle')` → works: `Table "refunds" {\n  "id" NUMBER [pk]\n  "amount" NUMBER(10,2) [not null]\n}\n`, and that output **re-parses cleanly with `new Parser().parse(text, 'dbmlv2')`** (our pipeline's format).
  - So Oracle is included for BOTH import and export. (`exporter.export(dbml, 'sqlite')` returns an **empty string** in 8.3.1 — sqlite is deliberately excluded.)
  - `importer` keys: `['import', 'generateDbml']`; `exporter` keys: `['export']`.
- **`headerColor` round-trips through the real parser** (`'dbmlv2'`), verified for every header shape Feature B must handle: `Table users [headerColor: #2196f3]`, quoted+alias `Table "order items" as OI [headerColor: #E91E63]`, schema-qualified `Table auth.users [headerColor: #16a085]`, merged settings `[note: 'hi', headerColor: #FF9800]`, lowercase hex. The normalizer already emits it: `src/core/parse/parseDbml.ts:60` (`headerColor: t.headerColor ?? null`); `Table.headerColor: string | null` is in `src/core/model/types.ts:18`. `TableNode` already renders it (`fill={table.headerColor ?? undefined}` on `.table-header` and `.table-box`), and `MiniMap` colors its rects with it — so Feature B needs **no schema/render changes**, only the text edit.
- **Store state today** (`src/app/store.ts`): `diagramId, diagramName, source, schema, errors, stale, positions, viewport, hoveredTableId, editorFocusTableId, storageUnavailable, parsedSource, notePositions, selectedTableIds`. `grep -rn "hiddenTableIds\|createdAt\|snapEnabled\|lodOverride" src/ e2e/` returns **nothing** — all four names are unclaimed. `applyParse` already prunes `selectedTableIds` against the new schema's table-id set (the exact pattern `hiddenTableIds` pruning must copy).
- **Autosave selector tuple** (`src/app/usePersistence.ts:296`): `[s.source, s.positions, s.viewport, s.diagramName, s.notePositions]` — `hiddenTableIds` MUST be added there or eye-toggles never autosave. `currentRecord()` builds the persisted record from store state, so `createdAt` must round-trip through a new store field (`diagramCreatedAt`) or autosave would strip it.
- **`PersistedDiagram`/`DiagramSnapshot`** (`src/core/persist/repository.ts`) already model optional backfill: `notePositions?` is `// optional: pre-Plan-3 records lack it`. Same treatment for `createdAt?`/`hiddenTableIds?` requires **no DB version bump** (plain extra properties on stored objects).
- **Project file** (`src/core/convert/projectFile.ts`): version 1; `notePositions` optional with trust-boundary validation (`parsePositionsMap` rejects `__proto__`/`constructor`/`prototype` keys). `hiddenTableIds` is an **array of strings** — no prototype-key hazard; validate `Array.isArray` + all-strings.
- **Current selectors / labels** (for e2e + CSS): tables `g.table-node` (`.table-title`, `.table-header`, `.table-box`), edges `g.edge`, toolbar buttons `▼ export` / `▼ history` / `▼ diagrams` (open state flips to `▲`), export dropdown `ul.export-list` (items "DBML (.dbml)", "SQL — PostgreSQL", "SQL — MySQL", "SQL — SQL Server", "SVG (.svg)", "PNG (2x)", "Project file (.json)"), history `div.history-panel` with `li` rows + "restore" buttons, diagrams dropdown `ul.diagram-list` with `li` rows, editor `.cm-content`, import dialog `.dialog` / `.dialog-text` / select options `postgres|mysql|mssql|dbml|project` / confirm "Import as new diagram", canvas overlay layer `div.canvas-wrap` (absolute inset 0) hosting `.minimap` (bottom-right, above) and `.zoom-controls` (bottom-right) — **bottom-left and the right edge are free** for Features E and D.
- **`e2e/interop.spec.ts:41-42`** clicks `getByRole('button', { name: /diagrams/ })` then asserts `.diagram-list li` count — Feature C removes `.diagram-list`, so that assertion is updated in Task 8 (and the import/export dialect loops gain Oracle in Task 3). No other spec touches the diagrams dropdown.
- **e2e harness:** specs in `e2e/*.spec.ts`, `import { test, expect } from '@playwright/test'` + `setEditorText`/`STARTER_TABLE_COUNT` from `e2e/helpers.ts`; deterministic idioms = auto-retrying `expect`, `expect.poll` on IndexedDB (`persistence.spec.ts` polls `dbdraft`→`diagrams` via `getAll`), zero `waitForTimeout`. `playwright.config.ts` uses `webServer` on **5173** with `reuseExistingServer: !CI`. **A dev server is already running on 5173 during authoring/execution — do not kill it or start a second one; local e2e runs will reuse it.**
- Starter diagram: 3 tables (`users`, `posts`, `comments`), **3 refs** (`posts.user_id>users.id`, `comments.post_id>posts.id`, `comments.user_id>users.id`) → hiding `comments` must drop the edge count from 3 to 1. Schema name is `public` for all → the Views sidebar shows one schema group `public 3/3`.
- vitest: node env, `include: ['src/**/*.test.ts']`, no DOM; persistence tests use `fake-indexeddb/auto` + `__resetForTests()`; `store.test.ts` has a file-scope `reset()` that `setState`s a partial state (zustand merges — new fields MUST be added to it or values leak across tests); same for `snapshotFlow.test.ts`'s `resetStore()`.
- LOD (`src/canvas/lod.ts`): tiers `'full' | 'shell' | 'box'`, thresholds 0.4 / 0.15. Culling (`src/canvas/culling.ts`): `visibleWorldRect` with 0.5 viewport margin, recomputed only on committed renders. `reconcilePositions` rename heuristic keys on `schemaName|sorted field names` — a Feature B rename with unchanged fields keeps the table's position automatically.
- `runElkLayout(schema)` / `buildElkGraph(schema)` take only a schema today; `elkResultToPositions` returns positions **only for laid-out children** — so passing a hidden-filtered child list automatically leaves hidden tables' positions untouched (`autoLayout` commits deltas only for returned ids).
- `nanoid` is an existing runtime dep (used by `usePersistence`/`starter`) — ids for duplicated records need nothing new.

## Global Constraints

- TypeScript `strict: true`; no new `any` (the `@dbml/core` normalizer boundary in `parseDbml.ts` remains the only exception).
- **Core purity (CLAUDE.md, verbatim):** `src/core/` must never import React, zustand, or anything from `src/app|editor|canvas`. New core file `src/core/model/visibility.ts` imports only core. Audit stays: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` returns nothing.
- **Canvas→text bridge (NEW — this plan adds it to CLAUDE.md in Task 13):** canvas-origin UI may request TEXT edits **only through `editorNav`** — one CodeMirror transaction per user action, so editor history owns undo and the parse pipeline re-renders the result. `applyTableSettings` (Feature B) is the first user of this bridge, alongside the existing `applyFormat`/`revealTable`. The settings popover NEVER writes `schema`, `positions`, or any store state to change a table's name/color. Drag, viewport, selection, and **visibility** (`hiddenTableIds`) stay layout-only and never touch DBML text. Renaming does NOT rewrite refs — dangling refs surface as ordinary parse errors (stale badge + problems panel), exactly as if the user typed the rename.
- **Last good parse (CLAUDE.md):** untouched. `applyParse` on failure still sets only `errors`/`stale`; the failure path must not touch `hiddenTableIds` either.
- **Canvas performance contract (CLAUDE.md):** pan/zoom/drag bypass React. `TableNode`'s new `onOpenSettings` prop must be referentially stable (a `useCallback([])` wrapping a state setter); the gear renders inside `TableNode` but the popover, sidebar, and control cluster are HTML in `.canvas-wrap`, outside the SVG hot path. Visibility filtering runs **at render time from committed state**: a memoized `Set(hiddenTableIds)` consulted inside the existing render maps (`O(1)` per table) and inside `EdgeLayer`'s `specs` memo — the imperative per-tick paths (pan transform, drag `setAttribute`, `updateTablePositions`) are never touched by a visibility check because hidden tables/edges are simply not mounted. `snapEnabled` is read via one `getState()` field access inside `handleLiveMove` (no subscription, no React work per tick).
- **Persistence safety (CLAUDE.md):** unchanged — every repository failure degrades to `setStorageUnavailable(true)` + in-memory operation. New dashboard flows reuse the existing `switchDiagram`/`createDiagram`/`removeDiagram` functions (which own the autosave-invalidation race discipline); the two new helpers (`renameDiagramById`, `duplicateDiagramById`) never repoint the store's current diagram and therefore need no `invalidatePendingAutosave`.
- **@dbml/core pin (CLAUDE.md):** stay on `^8.3.x` / `'dbmlv2'`. The only static `from '@dbml/core'` import remains `src/core/parse/parseDbml.ts`; Oracle goes through the existing lazy `convert.ts` facade.
- **Backward compatibility:** `createdAt` and `hiddenTableIds` are OPTIONAL on `PersistedDiagram`, `DiagramSnapshot`, and `ProjectFile`. Pre-Plan-6 records/files/snapshots load with `hiddenTableIds → []` and `createdAt → null` ("—" in the dashboard). No IndexedDB version bump. Both directions are unit-tested (load-old and write-new).
- **Session-only state (documented choice):** `snapEnabled` and `lodOverride` are deliberately NOT persisted and NOT reset by `loadDiagram` — they are workbench preferences for the current session, matching dbdiagram's behavior; a reload returns to defaults (snap on, Auto detail).
- **Tests:** vitest node env, no DOM. Unit-tested this plan: header-line rewrite (incl. real-parser round-trips), date formatting, visibility pruning + helpers, hidden-aware export bounds/ELK graph, LOD override selection, project-file validation, persistence threading. React wiring browser-verified per convention. E2E additions (`e2e/ux.spec.ts`): hover-menu smoke, dashboard create/search/rename/delete, visibility toggle + persistence across reload, header-color popover writes DBML AND repaints the header. Deterministic only: auto-retrying `expect`, `expect.poll` on IndexedDB — no sleeps.
- **Bundle budget:** main chunk ≤ 210 KiB gzip, `npm run check:bundle` in the integration task. These are plain React components + CSS (~4–7 kB gz expected); if the gate trips, trim CSS/duplicated markup — never raise the budget.
- **No new dependencies.** Icons: inline SVG paths or unicode glyphs (`⚙︎`, `⋮`, `✕`, `‹›`).
- Working dir `/Users/sharif/Documents/dbdiagram`, branch **`feature/plan-6-ux`** (created from `main` in Task 1). **Single lane — no parallel task execution** (the tasks share `store.ts`, `DiagramCanvas.tsx`, `usePersistence.ts`, `styles.css`).
- Commands exactly as in CLAUDE.md: `npm test`, `npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`, `npm run test:e2e`, `npm run check:bundle`.
- **Tag step SKIPPED** — the controller tags `plan-6-complete` at merge.

---

### Task 1: Store + persisted types — `hiddenTableIds`, `diagramCreatedAt`, `snapEnabled`, `lodOverride`, `effectiveLod`

**Files:**
- Modify: `src/app/store.ts`, `src/core/persist/repository.ts` (type fields only), `src/canvas/lod.ts`
- Test: `src/app/store.test.ts` (extend `reset()` + append), `src/canvas/lod.test.ts` (append)

**Interfaces:**
- `repository.ts`: `PersistedDiagram` gains `createdAt?: number;` and `hiddenTableIds?: string[];` (both `// optional: pre-Plan-6 records lack it`); `DiagramSnapshot` gains `hiddenTableIds?: string[];`. Types only — writer threading is Task 2.
- `lod.ts`: `export type LodOverride = 'auto' | 'full' | 'headers' | 'boxes';` and `export function effectiveLod(zoom: number, override: LodOverride): LodLevel` — override wins over zoom thresholds (`headers`→`'shell'`, `boxes`→`'box'`); `'auto'` delegates to `lodLevel(zoom)`. Culling stays zoom/viewport-based regardless (documented in the code comment).
- `store.ts` (`AppState`): new state `hiddenTableIds: string[]` (default `[]`), `diagramCreatedAt: number | null` (default `null`), `snapEnabled: boolean` (default `true`), `lodOverride: LodOverride` (default `'auto'`; type-only import `import type { LodOverride } from '../canvas/lod';` — app→canvas type imports are fine, only core has the purity rule); new actions `setHiddenTables(ids: string[]): void` (also prunes the newly hidden ids from `selectedTableIds` — hiding deselects, so a multi-select drag can never silently move an invisible table; group drags remain the intentional exception, moving members by group membership), `setSnapEnabled(v: boolean): void`, `setLodOverride(v: LodOverride): void`.
- `applyParse` (success branch) prunes hidden ids exactly like selection; the failure branch touches nothing new. `loadDiagram` loads `hiddenTableIds: rec.hiddenTableIds ?? []` and `diagramCreatedAt: rec.createdAt ?? null`, and deliberately does NOT touch `snapEnabled`/`lodOverride` (session state).

- [ ] **Step 0: Branch**

```bash
cd /Users/sharif/Documents/dbdiagram && git checkout -b feature/plan-6-ux
```

- [ ] **Step 1: Write the failing tests**

In `src/app/store.test.ts`, extend the file-scope `reset()` state object with four new lines (zustand `setState` merges — without this, values leak across tests):

```ts
    hiddenTableIds: [], diagramCreatedAt: null, snapEnabled: true, lodOverride: 'auto',
```

then append at the end of the file:

```ts
describe('view state (Plan 6): hiddenTableIds, session flags, createdAt', () => {
  beforeEach(reset);

  it('defaults: nothing hidden, snap on, LOD auto, no createdAt', () => {
    const s = useAppStore.getState();
    expect(s.hiddenTableIds).toEqual([]);
    expect(s.snapEnabled).toBe(true);
    expect(s.lodOverride).toBe('auto');
    expect(s.diagramCreatedAt).toBeNull();
  });

  it('applyParse prunes hidden ids of deleted tables, keeps live ones', () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setHiddenTables(['public.a', 'public.b']);
    const next = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(next), next);
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);
  });

  it('a failed parse leaves hiddenTableIds untouched (last-good-parse contract)', () => {
    const src = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setHiddenTables(['public.a']);
    useAppStore.getState().applyParse(parseDbml('Table a {'), 'Table a {');
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);
  });

  it('setHiddenTables deselects the newly hidden tables (hiding deselects)', () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setSelectedTables(['public.a', 'public.b']);
    useAppStore.getState().setHiddenTables(['public.a']);
    expect(useAppStore.getState().selectedTableIds).toEqual(['public.b']);
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);
  });

  it('loadDiagram loads hiddenTableIds/createdAt, defaulting for pre-Plan-6 records', () => {
    useAppStore.getState().loadDiagram({
      id: 'x', name: 'X', dbml: '', positions: {},
      viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
      hiddenTableIds: ['public.t'], createdAt: 123,
    });
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.t']);
    expect(useAppStore.getState().diagramCreatedAt).toBe(123);

    useAppStore.getState().loadDiagram({
      id: 'y', name: 'Y', dbml: '', positions: {},
      viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1, // pre-Plan-6 record: neither field
    });
    expect(useAppStore.getState().hiddenTableIds).toEqual([]);
    expect(useAppStore.getState().diagramCreatedAt).toBeNull();
  });

  it('loadDiagram does NOT touch snapEnabled/lodOverride (session state)', () => {
    useAppStore.getState().setSnapEnabled(false);
    useAppStore.getState().setLodOverride('boxes');
    useAppStore.getState().loadDiagram({
      id: 'z', name: 'Z', dbml: '', positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().snapEnabled).toBe(false);
    expect(useAppStore.getState().lodOverride).toBe('boxes');
  });
});
```

Append to `src/canvas/lod.test.ts` (add `effectiveLod` to its import from `./lod`):

```ts
describe('effectiveLod (Plan 6 detail override)', () => {
  it('auto follows the zoom thresholds', () => {
    expect(effectiveLod(1, 'auto')).toBe('full');
    expect(effectiveLod(0.3, 'auto')).toBe('shell');
    expect(effectiveLod(0.1, 'auto')).toBe('box');
  });

  it('an override wins over zoom at both extremes', () => {
    expect(effectiveLod(0.05, 'full')).toBe('full');
    expect(effectiveLod(1, 'headers')).toBe('shell');
    expect(effectiveLod(1, 'boxes')).toBe('box');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/store.test.ts src/canvas/lod.test.ts` — Expected: FAIL (`setHiddenTables` not a function; `effectiveLod` not exported; `hiddenTableIds`/`createdAt` unknown properties on `DiagramRecord`).

- [ ] **Step 3: Implement**

Append to `src/canvas/lod.ts`:

```ts
/** Feature E's Detail dropdown. An override wins over the zoom thresholds;
 *  'auto' is today's behavior. Culling stays zoom/viewport-based regardless:
 *  overriding to 'full' at 10% zoom renders full detail for the tables that
 *  survive culling — it never mounts the whole scene. */
export type LodOverride = 'auto' | 'full' | 'headers' | 'boxes';

export function effectiveLod(zoom: number, override: LodOverride): LodLevel {
  switch (override) {
    case 'full': return 'full';
    case 'headers': return 'shell';
    case 'boxes': return 'box';
    default: return lodLevel(zoom);
  }
}
```

In `src/core/persist/repository.ts`, extend the two interfaces (positions untouched):

```ts
export interface PersistedDiagram {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  notePositions?: Record<string, TablePosition>; // optional: pre-Plan-3 records lack it
  hiddenTableIds?: string[]; // optional: pre-Plan-6 records lack it (view state, Feature D)
  viewport: Viewport;
  updatedAt: number;
  createdAt?: number; // optional: pre-Plan-6 records lack it ("—" in the dashboard)
}
```

and in `DiagramSnapshot`, after the `notePositions?` line:

```ts
  hiddenTableIds?: string[]; // optional: pre-Plan-6 rows lack it
```

In `src/app/store.ts`:

1. Add the type import:
```ts
import type { LodOverride } from '../canvas/lod';
```
2. In `interface AppState`, after `selectedTableIds: string[];`:
```ts
  hiddenTableIds: string[]; // view state: tables hidden from the canvas (Feature D) — layout-side, never DBML
  diagramCreatedAt: number | null; // mirrors PersistedDiagram.createdAt so autosave round-trips it
  snapEnabled: boolean; // session-only (not persisted): drag snap on/off (Feature E)
  lodOverride: LodOverride; // session-only (not persisted): detail dropdown (Feature E)
```
and after `setSelectedTables(ids: string[]): void;`:
```ts
  setHiddenTables(ids: string[]): void;
  setSnapEnabled(v: boolean): void;
  setLodOverride(v: LodOverride): void;
```
3. In the initial state, after `selectedTableIds: [],`:
```ts
    hiddenTableIds: [],
    diagramCreatedAt: null,
    snapEnabled: true,
    lodOverride: 'auto',
```
4. In `applyParse`, widen the destructure and prune alongside selection. Replace:
```ts
      const { schema: prev, positions, notePositions, selectedTableIds } = get();
```
with:
```ts
      const { schema: prev, positions, notePositions, selectedTableIds, hiddenTableIds } = get();
```
and inside the `set({ … })` call, after the `selectedTableIds: …` line:
```ts
        hiddenTableIds: hiddenTableIds.filter((id) => tableIds.has(id)),
```
(A renamed table's OLD id is pruned here, so a rename un-hides the table — same self-correcting behavior selection has; positions survive via the reconcile heuristic.)
5. Next to the other simple setters:
```ts
    setHiddenTables: (hiddenTableIds) =>
      set((s) => {
        // Hiding deselects: a hidden table left in the selection would be
        // silently moved by the next multi-select drag it isn't visible in.
        // (Group drags are the intentional exception — membership, not selection.)
        const hidden = new Set(hiddenTableIds);
        return {
          hiddenTableIds,
          selectedTableIds: s.selectedTableIds.filter((id) => !hidden.has(id)),
        };
      }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    setLodOverride: (lodOverride) => set({ lodOverride }),
```
6. In `loadDiagram`'s `set({ … })`, after `selectedTableIds: [],`:
```ts
        hiddenTableIds: rec.hiddenTableIds ?? [], // pre-Plan-6 records: nothing hidden
        diagramCreatedAt: rec.createdAt ?? null,
        // snapEnabled / lodOverride deliberately untouched: session state.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/store.test.ts src/canvas/lod.test.ts` — Expected: PASS (8 new = 6 store + 2 lod, + all existing).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npx vitest run && npx tsc --noEmit && git add src/app/store.ts src/app/store.test.ts src/core/persist/repository.ts src/canvas/lod.ts src/canvas/lod.test.ts && git commit -m "feat: store view state — hiddenTableIds, createdAt mirror, snap/lod session flags"
```

---

### Task 2: Persistence + interchange threading — `createdAt` and `hiddenTableIds` end to end (the `notePositions` precedent, exactly)

**Files:**
- Modify: `src/app/usePersistence.ts`, `src/app/starter.ts`, `src/core/convert/projectFile.ts`, `src/app/ImportDialog.tsx`, `src/app/ExportMenu.tsx` (one line)
- Test: `src/core/convert/projectFile.test.ts` (append), `src/app/snapshotFlow.test.ts` (extend `resetStore()` + append), `src/app/starter.test.ts` (append)

**Interfaces:**
- `currentRecord()` now emits `hiddenTableIds: s.hiddenTableIds` always, and `createdAt: s.diagramCreatedAt` only when non-null (an old record autosaves without inventing a birth date).
- Autosave subscription tuple gains `s.hiddenTableIds` (without it, an eye-toggle never persists). The tuple change is React-hook wiring — its regression guard is the Task 12 e2e reload test, per repo convention.
- `snapshotIfChanged(rec, compareLayout)`: snapshot payload gains `hiddenTableIds: rec.hiddenTableIds`; the `compareLayout` dedupe adds a `JSON.stringify(… ?? [])` comparison — normalized on BOTH sides so a pre-Plan-6 snapshot (field `undefined`) equals a live `[]` and the first restore after upgrade doesn't write a spurious checkpoint.
- `restoreSnapshot`: restored record gets `hiddenTableIds: snap.hiddenTableIds ?? []`; the same-text patch branch `setState`s it too (a restore must swap visibility without a blank-canvas reload).
- `duplicateDiagram()`: the copy gets `createdAt: Date.now()` (a copy is a new document).
- `ImportedDiagram` gains `hiddenTableIds?: string[]`; `importDiagram` stamps `createdAt: Date.now()` and threads `hiddenTableIds: imp.hiddenTableIds ?? []`.
- `createStarterDiagram()`: `const now = Date.now();` → `createdAt: now, updatedAt: now`.
- `projectFile.ts`: `ProjectFile` gains `hiddenTableIds?: string[];` (comment: optional, pre-Plan-6 files lack it); `serializeProject` takes `hiddenTableIds?: string[]` and emits the key only when non-empty; `parseProject` validates it when present as an array of strings (it is an array — no reserved-key hazard; malformed → `{ ok: false, error: 'Project file "hiddenTableIds" must be an array of table ids.' }`).
- `ImportDialog` (project branch) passes `hiddenTableIds: r.project.hiddenTableIds`; `ExportMenu.exportProject` passes `hiddenTableIds: s.hiddenTableIds`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/convert/projectFile.test.ts`:

```ts
describe('hiddenTableIds (Plan 6, optional — backward compatible)', () => {
  it('round-trips hiddenTableIds and accepts files without them', () => {
    const r = parseProject(serializeProject({ ...input, hiddenTableIds: ['public.a'] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.hiddenTableIds).toEqual(['public.a']);

    const old = parseProject(serializeProject(input)); // pre-Plan-6 shape: no key at all
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect('hiddenTableIds' in old.project).toBe(false);
  });

  it('omits the key when nothing is hidden (files stay byte-stable for old consumers)', () => {
    expect(serializeProject({ ...input, hiddenTableIds: [] })).not.toContain('hiddenTableIds');
  });

  it('rejects malformed hiddenTableIds (non-array, non-string entries)', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.hiddenTableIds = { 'public.a': true };
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
    raw.hiddenTableIds = ['public.a', 7];
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
  });
});
```

In `src/app/snapshotFlow.test.ts`, extend `resetStore()`'s state object with:

```ts
    hiddenTableIds: [], diagramCreatedAt: null,
```

then append at the end of the file:

```ts
describe('createdAt + hiddenTableIds threading (Plan 6)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });

  it('importDiagram stamps createdAt and threads hiddenTableIds', async () => {
    await importDiagram({ name: 'Imp', dbml: BASE, hiddenTableIds: ['public.a'] });
    const s = useAppStore.getState();
    expect(s.diagramCreatedAt).not.toBeNull();
    expect(s.hiddenTableIds).toEqual(['public.a']);
    const all = await listDiagrams();
    expect(all[0].createdAt).toBe(s.diagramCreatedAt);
    expect(all[0].hiddenTableIds).toEqual(['public.a']);
  });

  it('hiddenTableIds travel through snapshot restore', async () => {
    const a: PersistedDiagram = { ...diagramA(), hiddenTableIds: ['public.a'] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);

    const snap: DiagramSnapshot = {
      id: 'snap-1', diagramId: a.id, takenAt: 5, name: 'A', dbml: EDITED,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, hiddenTableIds: ['public.b'],
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.b']);
    expect(useAppStore.getState().source).toBe(EDITED);
  });

  it('restoring an OLD snapshot without hiddenTableIds clears them (backward compat)', async () => {
    const a: PersistedDiagram = { ...diagramA(), hiddenTableIds: ['public.a'] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    const snap: DiagramSnapshot = {
      id: 'snap-old', diagramId: a.id, takenAt: 5, name: 'A', dbml: EDITED,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, // pre-Plan-6 row
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().hiddenTableIds).toEqual([]);
  });

  it('restore-checkpoint dedupe treats a pre-Plan-6 snapshot (no hiddenTableIds) as []', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a); // hiddenTableIds → []
    // Plan-3-era snapshot: HAS notePositions (so that compare passes) but
    // predates hiddenTableIds — the ?? [] normalization is what's under test.
    const snap: DiagramSnapshot = {
      id: 'snap-pre6', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, notePositions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap); // identical text+layout → checkpoint must dedupe
    expect(await listSnapshots(a.id)).toHaveLength(1); // no spurious checkpoint
  });

  it('same-text restore patches hiddenTableIds without reloading the diagram', async () => {
    const a: PersistedDiagram = { ...diagramA(), hiddenTableIds: [] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    useAppStore.getState().applyParse(parseDbml(BASE), BASE);
    const schemaBefore = useAppStore.getState().schema;
    const snap: DiagramSnapshot = {
      id: 'snap-same', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, hiddenTableIds: ['public.a'],
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().schema).toBe(schemaBefore); // no blank-canvas reload
    expect(useAppStore.getState().hiddenTableIds).toEqual(['public.a']);
  });
});
```

Append to `src/app/starter.test.ts` (inside the existing `describe`):

```ts
  it('stamps createdAt on new starter diagrams', () => {
    const before = Date.now();
    const a = createStarterDiagram();
    expect(a.createdAt).toBeGreaterThanOrEqual(before);
    expect(a.createdAt).toBe(a.updatedAt);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/convert/projectFile.test.ts src/app/snapshotFlow.test.ts src/app/starter.test.ts` — Expected: FAIL (serializeProject rejects the extra key at the type level / drops it; snapshot restore loses hiddenTableIds; starter has no createdAt).

- [ ] **Step 3: Implement**

`src/app/starter.ts` — replace the body of `createStarterDiagram`:

```ts
export function createStarterDiagram(): DiagramRecord {
  const now = Date.now();
  return {
    id: nanoid(),
    name: 'Untitled',
    dbml: STARTER_DBML,
    positions: {},
    viewport: { x: 40, y: 40, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}
```

`src/app/usePersistence.ts` — five edits:

1. `currentRecord()` (complete replacement):
```ts
function currentRecord(): DiagramRecord | null {
  const s = useAppStore.getState();
  if (!s.diagramId) return null;
  return {
    id: s.diagramId, name: s.diagramName, dbml: s.source,
    positions: s.positions, notePositions: s.notePositions,
    hiddenTableIds: s.hiddenTableIds,
    viewport: s.viewport, updatedAt: Date.now(),
    // Only stamp createdAt when the store actually knows it — an autosave of
    // a pre-Plan-6 record must not invent a birth date.
    ...(s.diagramCreatedAt !== null ? { createdAt: s.diagramCreatedAt } : {}),
  };
}
```
2. In `snapshotIfChanged`, extend the `sameLayout` expression — replace:
```ts
      JSON.stringify(newest?.viewport) === JSON.stringify(rec.viewport)
```
with:
```ts
      JSON.stringify(newest?.viewport) === JSON.stringify(rec.viewport) &&
      // ?? [] on BOTH sides: a pre-Plan-6 snapshot (undefined) must equal a
      // live [] — otherwise the first restore after upgrade writes a
      // spurious checkpoint.
      JSON.stringify(newest?.hiddenTableIds ?? []) === JSON.stringify(rec.hiddenTableIds ?? [])
```
and add to the `putSnapshot({ … })` payload, after `notePositions: rec.notePositions,`:
```ts
      hiddenTableIds: rec.hiddenTableIds,
```
3. In `duplicateDiagram`, replace the `copy` line with:
```ts
  const copy: DiagramRecord = {
    ...cur, id: nanoid(), name: `${cur.name} copy`,
    createdAt: Date.now(), updatedAt: Date.now(), // a copy is a NEW document
  };
```
(Task 8 deletes `duplicateDiagram()` entirely once the dashboard owns duplication — this edit keeps the still-present toolbar button correct for Tasks 2–7.)
4. `ImportedDiagram` gains a field and `importDiagram`'s record gains two — in the interface, after `notePositions?…`:
```ts
  hiddenTableIds?: string[];
```
and in `importDiagram`'s `rec`, after `notePositions: imp.notePositions ?? {},`:
```ts
    hiddenTableIds: imp.hiddenTableIds ?? [],
```
plus after `viewport: …`:
```ts
    createdAt: Date.now(),
```
5. `restoreSnapshot` — the restored record and the same-text patch. Replace the `rec` construction with:
```ts
  const rec: DiagramRecord = {
    id: cur.id, name: snap.name, dbml: snap.dbml,
    positions: snap.positions, notePositions: snap.notePositions ?? {},
    hiddenTableIds: snap.hiddenTableIds ?? [],
    viewport: snap.viewport, updatedAt: Date.now(),
    ...(cur.createdAt !== undefined ? { createdAt: cur.createdAt } : {}), // restore never changes the birth date
  };
```
and the same-text `setState` patch with:
```ts
    useAppStore.setState({
      diagramName: rec.name, positions: rec.positions, notePositions: rec.notePositions,
      hiddenTableIds: rec.hiddenTableIds, viewport: rec.viewport,
    });
```
6. The autosave subscription tuple — replace:
```ts
      (s) => [s.source, s.positions, s.viewport, s.diagramName, s.notePositions] as const,
```
with:
```ts
      (s) => [s.source, s.positions, s.viewport, s.diagramName, s.notePositions, s.hiddenTableIds] as const,
```
(The `equalityFn` is index-generic — `a.every((v, i) => Object.is(v, b[i]))` — and needs no change.)

`src/core/convert/projectFile.ts` — four edits:

1. `ProjectFile` interface, after `notePositions?…`:
```ts
  hiddenTableIds?: string[]; // optional: pre-Plan-6 files lack it (Feature D view state)
```
2. `serializeProject` — parameter type gains `hiddenTableIds?: string[];`, and the `file` literal gains (after `notePositions: p.notePositions,`):
```ts
    hiddenTableIds: p.hiddenTableIds && p.hiddenTableIds.length > 0 ? p.hiddenTableIds : undefined,
```
(`JSON.stringify` drops `undefined` values — old-shape files stay byte-identical when nothing is hidden.)
3. `parseProject` — after the `notePositions` block, before the viewport check:
```ts
  // hiddenTableIds is optional (pre-Plan-6 files). It is a plain string
  // array — no reserved-key hazard (that only exists for object maps) — so
  // the trust boundary is: array, all entries strings.
  let hiddenTableIds: string[] | undefined;
  if (o.hiddenTableIds !== undefined) {
    const arr = o.hiddenTableIds;
    if (!Array.isArray(arr) || !arr.every((v): v is string => typeof v === 'string')) {
      return { ok: false, error: 'Project file "hiddenTableIds" must be an array of table ids.' };
    }
    hiddenTableIds = arr;
  }
```
4. and thread it into the returned project, next to the notePositions spread:
```ts
      ...(hiddenTableIds !== undefined ? { hiddenTableIds } : {}),
```

`src/app/ImportDialog.tsx` — in the `kind === 'project'` branch, add to the `importDiagram({ … })` call after `notePositions: r.project.notePositions,`:
```ts
          hiddenTableIds: r.project.hiddenTableIds,
```

`src/app/ExportMenu.tsx` — in `exportProject`, extend the `serializeProject({ … })` argument after `notePositions: s.notePositions,`:
```ts
        hiddenTableIds: s.hiddenTableIds,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/convert/projectFile.test.ts src/app/snapshotFlow.test.ts src/app/starter.test.ts` — Expected: PASS (9 new = 3 projectFile + 5 snapshotFlow + 1 starter, + all existing; the pre-existing layout-drift dedupe tests must still pass — for them the added compare is `[] === []` after normalization).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npx vitest run && npx tsc --noEmit && git add -A && git commit -m "feat: thread createdAt + hiddenTableIds through persistence, snapshots, project files"
```

---

### Task 3: Oracle dialect — convert facade, Export menu item, Import option, e2e loops

**Files:**
- Modify: `src/core/convert/convert.ts`, `src/app/ExportMenu.tsx`, `src/app/ImportDialog.tsx`, `e2e/interop.spec.ts`
- Test: `src/core/convert/convert.test.ts` (extend)

**Interfaces:**
- `export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle';` — verified against the INSTALLED 8.3.1: `exporter.export(dbml, 'oracle')` and `importer.import(sql, 'oracle')` both work, and the import output re-parses with `'dbmlv2'` (see Verified facts). No other code change in `convert.ts` — both facades are format-string passthroughs.
- ExportMenu gains `{ dialect: 'oracle', label: 'Oracle' }` (renders as "SQL — Oracle", downloads `<name>.oracle.sql`); ImportDialog gains `{ kind: 'oracle', label: 'Oracle DDL' }` (`ImportKind` already unions `SqlDialect`).

- [ ] **Step 1: Write the failing tests**

In `src/core/convert/convert.test.ts`:

1. Change the exportSql `it.each` array to include oracle:
```ts
  it.each(['postgres', 'mysql', 'mssql', 'oracle'] as const)('emits CREATE TABLE DDL for %s', async (d) => {
```
2. Append inside the `importSql` describe:
```ts
  it('converts oracle DDL to DBML that our dbmlv2 pipeline re-parses', async () => {
    const sql = 'CREATE TABLE refunds (id NUMBER PRIMARY KEY, amount NUMBER(10,2) NOT NULL);';
    const r = await importSql(sql, 'oracle');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const parsed = parseDbml(r.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schema.tables[0].name).toBe('refunds');
    expect(parsed.schema.tables[0].fields.map((f) => f.name)).toEqual(['id', 'amount']);
  });
```

Run: `npx vitest run src/core/convert/convert.test.ts` — Expected: FAIL (TS2345: `'oracle'` not assignable to `SqlDialect`).

- [ ] **Step 2: Implement**

`src/core/convert/convert.ts` — replace the dialect type line:
```ts
export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle';
```
and update the `importSql` doc comment's dialect list to `('postgres' | 'mysql' | 'mssql' | 'oracle')`.

`src/app/ExportMenu.tsx` — append to `SQL_DIALECTS`:
```ts
  { dialect: 'oracle', label: 'Oracle' },
```

`src/app/ImportDialog.tsx` — in `KIND_OPTIONS`, after the mssql entry:
```ts
  { kind: 'oracle', label: 'Oracle DDL' },
```

Run: `npx vitest run src/core/convert/convert.test.ts` — Expected: PASS (the oracle export case pays the real `@dbml/core` load in node — same as the existing dialect cases).

- [ ] **Step 3: Extend the e2e interop loops**

In `e2e/interop.spec.ts`:

1. Append to the `DIALECTS` array:
```ts
  {
    kind: 'oracle',
    sql: 'CREATE TABLE refunds (id NUMBER PRIMARY KEY, amount NUMBER(10,2) NOT NULL);',
    table: 'refunds',
  },
```
2. In the export test's dialect loop array, append:
```ts
    { dialect: 'oracle', label: 'SQL — Oracle' },
```
(Both loops are count-derived — `1 + DIALECTS.length` and the per-entry assertions adjust automatically.)

- [ ] **Step 4: Verify (unit + e2e + typecheck)**

```bash
npx vitest run && npx tsc --noEmit && npx playwright test e2e/interop.spec.ts
```
Expected: unit green; interop 2/2 with oracle now exercised in both directions (import creates a 4th diagram; export downloads `Untitled.oracle.sql` containing `CREATE TABLE`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: oracle SQL dialect (import + export) — verified against installed @dbml/core 8.3.1"
```

---

### Task 4: Feature A — `useHoverMenu` hook + roomier, grouped menus (Export, History)

**Files:**
- Create: `src/app/useHoverMenu.ts`
- Modify: `src/app/ExportMenu.tsx` (complete replacement), `src/app/HistoryPanel.tsx`, `src/styles.css`, `e2e/interop.spec.ts` is untouched (labels unchanged)

**Interfaces:**
- `useHoverMenu(): { open: boolean; close(): void; toggle(): void; rootRef: React.RefObject<HTMLDivElement | null>; rootProps: { onPointerEnter; onPointerLeave } }` with exported constants `HOVER_OPEN_DELAY_MS = 100`, `HOVER_CLOSE_GRACE_MS = 250`.
  - Hover open/close applies to `pointerType === 'mouse'` only — on touch, `pointerenter` fires just before the tap and hover-open + click-toggle would cancel out; touch/keyboard get the plain click toggle.
  - The enter/leave handlers sit on the menu ROOT (`.export-menu` / `.history-wrap`), which contains both the trigger and the absolutely-positioned dropdown: `pointerleave` does not fire when moving onto a descendant, so trigger→menu diagonal travel inside the root never closes; crossing the small gap between trigger and menu leaves the root, and the 250 ms grace absorbs it.
  - Escape and outside-`pointerdown` close (window listeners, active only while open). Hover/click race guard: `toggle()` is a no-op while the menu is open AND was hover-opened < 500 ms ago (`openedByHoverAt` stamp) — otherwise a click landing just after the 100 ms hover-open (a real user reaching for the button, and a real Playwright actionability-retry flake) would slam the menu shut. A menu open ≥ 500 ms, or click-opened (stamp stale), toggles closed as before; touch/keyboard behavior is unchanged (hover never fires for them).
- The `DiagramManager` "diagrams" trigger is deliberately NOT wired to this hook — Feature C replaces its dropdown with a full-height dashboard overlay, and hover-opening a screen-stealing overlay is hostile; the scope grants this call ("hover-open per Feature A or click — your call, document it"). `useHoverMenu` remains the single shared implementation for everything dropdown-shaped.
- Menu restyle: shared `.menu-list` class (min-width 240 px, 9 px item padding, group labels + separators, subtle hover highlight); the legacy `.export-list` CSS block is deleted. Export items regrouped dbdiagram-style: **Document** (DBML, Project JSON, PNG, SVG) | **SQL** (PostgreSQL, MySQL, SQL Server, Oracle). Text-first, no icons — the scope marks icons optional.
- All existing e2e locators keep working: trigger labels stay `▼ export` / `▼ history`, item labels unchanged, history rows stay `.history-panel li`.

- [ ] **Step 1: Implement the hook**

`src/app/useHoverMenu.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export const HOVER_OPEN_DELAY_MS = 100; // hover-intent: don't open on a drive-by
export const HOVER_CLOSE_GRACE_MS = 250; // diagonal travel trigger→menu crosses a small gap

export interface HoverMenu {
  open: boolean;
  close: () => void;
  toggle: () => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  rootProps: {
    onPointerEnter: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
  };
}

/** Shared hover-menu behavior (Feature A): hover-open with a short delay,
 *  hover-close with a grace period, click toggle retained (touch/keyboard),
 *  Escape + outside-pointerdown close. Attach `rootProps` + `rootRef` to the
 *  wrapper that contains BOTH the trigger and the dropdown — pointerleave
 *  never fires for moves onto a descendant, so travel into the menu is safe.
 *  Hover handlers apply to mouse pointers only: on touch, pointerenter fires
 *  right before the tap, and hover-open + click-toggle would cancel out. */
export function useHoverMenu(): HoverMenu {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHoverAt = useRef(0); // when the hover timer opened the menu (0 = click-opened/stale)

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const close = useCallback(() => {
    clear();
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    clear();
    setOpen((v) => {
      // Hover/click race: a click landing right after a hover-open must not
      // slam the menu shut (the hover opened it while the pointer traveled
      // to the trigger — also a Playwright actionability-retry flake).
      if (v && Date.now() - openedByHoverAt.current < 500) return v;
      return !v;
    });
  }, []);

  useEffect(() => clear, []); // unmount: no timer leaks

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  return {
    open,
    close,
    toggle,
    rootRef,
    rootProps: {
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        clear(); // re-entering the root cancels a pending grace-close
        if (!open) {
          timer.current = setTimeout(() => {
            timer.current = null;
            openedByHoverAt.current = Date.now();
            setOpen(true);
          }, HOVER_OPEN_DELAY_MS);
        }
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        clear();
        if (open) {
          timer.current = setTimeout(() => {
            timer.current = null;
            setOpen(false);
          }, HOVER_CLOSE_GRACE_MS);
        }
      },
    },
  };
}
```

- [ ] **Step 2: Rewire ExportMenu (complete replacement)**

`src/app/ExportMenu.tsx`:

```tsx
import { useAppStore } from './store';
import { useHoverMenu } from './useHoverMenu';
import { exportSql, type SqlDialect } from '../core/convert/convert';
import { serializeProject } from '../core/convert/projectFile';
import { downloadBlob, downloadText } from './export/download';
import { safeFilename } from './export/exportCss';
import { buildDiagramSvg, buildPngBlob } from './export/svgExport';

const SQL_DIALECTS: Array<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgres', label: 'PostgreSQL' },
  { dialect: 'mysql', label: 'MySQL' },
  { dialect: 'mssql', label: 'SQL Server' },
  { dialect: 'oracle', label: 'Oracle' },
];

export function ExportMenu() {
  const menu = useHoverMenu();
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const sqlDisabled = stale || errors.length > 0;
  const imageDisabled = tableCount === 0;

  const exportDbml = () => {
    const s = useAppStore.getState();
    downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
    menu.close();
  };

  const exportProject = () => {
    const s = useAppStore.getState();
    downloadText(
      serializeProject({
        name: s.diagramName, dbml: s.source, positions: s.positions,
        notePositions: s.notePositions, hiddenTableIds: s.hiddenTableIds, viewport: s.viewport,
      }),
      `${safeFilename(s.diagramName)}.json`,
      'application/json',
    );
    menu.close();
  };

  const exportAsSql = async (dialect: SqlDialect) => {
    const s = useAppStore.getState();
    const r = await exportSql(s.source, dialect);
    if (r.ok) downloadText(r.text, `${safeFilename(s.diagramName)}.${dialect}.sql`);
    else window.alert(`SQL export failed: ${r.errors[0]?.message ?? 'unknown error'}`);
    menu.close();
  };

  const exportSvgFile = () => {
    const built = buildDiagramSvg();
    if (built) {
      const name = useAppStore.getState().diagramName;
      downloadBlob(new Blob([built.markup], { type: 'image/svg+xml' }), `${safeFilename(name)}.svg`);
    }
    menu.close();
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
    menu.close();
  };

  return (
    <div className="export-menu" ref={menu.rootRef} {...menu.rootProps}>
      <button onClick={menu.toggle}>{menu.open ? '▲' : '▼'} export</button>
      {menu.open && (
        <ul className="menu-list">
          <li className="menu-group">Document</li>
          <li><button onClick={exportDbml}>DBML (.dbml)</button></li>
          <li><button onClick={exportProject}>Project file (.json)</button></li>
          <li><button disabled={imageDisabled} onClick={() => void exportPngFile()}>PNG (2x)</button></li>
          <li><button disabled={imageDisabled} onClick={exportSvgFile}>SVG (.svg)</button></li>
          <li className="menu-sep" role="separator" />
          <li className="menu-group">SQL</li>
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
        </ul>
      )}
    </div>
  );
}
```

(Behavior notes: the standalone Escape effect is gone — the hook owns it, and adds outside-click close the old menu never had. Every item still closes the menu after acting, so the interop export spec's "reopen per item" loop is untouched.)

- [ ] **Step 3: Rewire HistoryPanel**

In `src/app/HistoryPanel.tsx`:

1. Replace the imports' first line and add the hook import:
```tsx
import { useEffect, useState } from 'react';
import { useHoverMenu } from './useHoverMenu';
```
2. Replace the open-state line `const [open, setOpen] = useState(false);` with:
```tsx
  const menu = useHoverMenu();
```
3. Replace `open` with `menu.open` in the two effects' conditions and dependency arrays (`if (open && diagramId) …`, `[open, diagramId]` → `if (menu.open && diagramId) …`, `[menu.open, diagramId]`), and DELETE the whole Escape-listener `useEffect` (the hook owns Escape now).
4. Replace the returned JSX shell with:
```tsx
  return (
    <div className="history-wrap" ref={menu.rootRef} {...menu.rootProps}>
      <button onClick={menu.toggle}>{menu.open ? '▲' : '▼'} history</button>
      {menu.open && (
        <div className="history-panel">
```
(the panel's inner content — header, empty text, `<ul>` rows, restore buttons — is byte-identical to today; only the wrapper/button/conditional lines change).

- [ ] **Step 4: Restyle — CSS**

In `src/styles.css`:

1. DELETE the legacy dropdown block (both rules):
```css
.export-list {
  position: absolute; top: 30px; left: 0; z-index: 20; min-width: 200px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); list-style: none; margin: 0; padding: 4px;
}
.export-list button { display: block; width: 100%; text-align: left; border: none; background: none; color: var(--text); padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
.export-list button:hover:not(:disabled) { background: var(--selection-bg); }
.export-list button:disabled { opacity: 0.45; cursor: not-allowed; }
```
2. Append:
```css
/* Plan 6 Feature A: shared hover-menu look (dbdiagram-style, roomier) */
.menu-list {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; min-width: 240px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14); list-style: none; margin: 0; padding: 6px;
}
.menu-list button {
  display: block; width: 100%; text-align: left; border: none; background: none;
  color: var(--text); padding: 9px 12px; cursor: pointer; border-radius: 6px; font-size: 13px;
}
.menu-list button:hover:not(:disabled) { background: var(--selection-bg); }
.menu-list button:disabled { opacity: 0.45; cursor: not-allowed; }
.menu-group {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-dim); padding: 6px 12px 2px;
}
.menu-sep { border-top: 1px solid var(--border); margin: 6px 4px; }
```
3. Update the history panel's anchor to match (in the existing `.history-panel` rule, change `top: 30px;` to `top: calc(100% + 4px);`).

- [ ] **Step 5: Verify (typecheck, unit regression, e2e regression, browser)**

```bash
npx tsc --noEmit && npx vitest run && npx playwright test e2e/interop.spec.ts e2e/persistence.spec.ts
```
Expected: clean / green / 6 passed (all existing click-driven flows still work — click-toggle retained).

Browser check (`npm run dev` is already serving on 5173 — just open it):
1. Hover "▼ export" ~100 ms → menu opens with Document/SQL groups incl. "SQL — Oracle"; drift diagonally down into the menu across the 4 px gap → stays open; leave sideways → closes after ~250 ms.
2. Hover "▼ history" → same behavior; snapshots list loads on hover-open.
3. Click-toggle still works on both (click-open when closed; click-close once open ≥ 500 ms); clicking the trigger IMMEDIATELY after a hover-open keeps the menu open (race guard); Escape closes; clicking elsewhere closes.
4. Dark theme: menus use theme variables (toggle and re-check).
5. DevTools device-emulation (touch): tap opens, tap again closes — no hover interference.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: hover-open toolbar menus via shared useHoverMenu + dbdiagram-style menu restyle"
```

---

### Task 5: Feature B core — `rewriteTableHeader` pure helper (headless, real-parser round-trips)

**Files:**
- Create: `src/editor/tableSettings.ts`
- Test: `src/editor/tableSettings.test.ts`

**Interfaces:**
- `export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;` (shared with the popover's input validation).
- `export interface TableHeaderEdit { name?: string; headerColor?: string | null }` — `headerColor: null` removes the setting.
- `export function rewriteTableHeader(header: string, edit: TableHeaderEdit): string | null` — input is the header segment `sourceMap` delimits (from the `Table` keyword up to, NOT including, the `{`; possibly with trailing whitespace). Returns the rewritten header (no trailing space) or **null when it refuses**: unrecognized header shape (comment mid-header, stray tokens), unquotable name (empty, contains `"` or newline), non-`#RRGGBB` color. Refusing is the safety contract — the caller then makes no edit at all, never a mangled one.
- Handles all scoped shapes: bare header (append `[headerColor: #xxxxxx]`), existing bracket with `headerColor` (update value in place), existing bracket without it (merge: `, headerColor: #xxxxxx` appended inside), removal (drop the entry; drop the bracket entirely if emptied), alias (`Table x as X`), quoted names (`Table "order items"`), schema-qualified (`Table auth.users` — schema token untouched), rename+color in one call. Settings-bracket scanning runs on `blankNoise`d text (reused from `sourceMap.ts`) so a quoted note containing the literal words `headerColor:` can never false-match.
- Bracket contents are matched greedily to the LAST `]` on the line, so a `]` inside a quoted setting value (`[note: 'a]b']`) is handled, not refused — pinned by an adversarial test (round-trip verified against the installed parser: both `headerColor` and the note survive). The genuine refusal ceiling is shapes the anchored regex can't account for (comment mid-header, stray tokens after the bracket): helper returns null → the popover reports "could not edit" instead of corrupting text.

- [ ] **Step 1: Write the failing tests**

`src/editor/tableSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rewriteTableHeader } from './tableSettings';
import { parseDbml } from '../core/parse/parseDbml';

/** Round-trip guard: whatever we emit must parse under 'dbmlv2' and land the
 *  expected values in OUR normalized schema — the real parser is the oracle,
 *  not string expectations alone. */
function roundTrip(header: string) {
  const r = parseDbml(`${header} {\n  id integer\n}\n`);
  if (!r.ok) throw new Error(`emitted header does not parse: ${header} → ${r.errors[0]?.message}`);
  return r.schema.tables[0];
}

describe('rewriteTableHeader — headerColor', () => {
  it('appends a settings bracket to a bare header', () => {
    const out = rewriteTableHeader('Table users', { headerColor: '#2196f3' });
    expect(out).toBe('Table users [headerColor: #2196f3]');
    expect(roundTrip(out!).headerColor).toBe('#2196f3');
  });

  it('updates an existing headerColor in place', () => {
    const out = rewriteTableHeader('Table users [headerColor: #f44336]', { headerColor: '#4caf50' });
    expect(out).toBe('Table users [headerColor: #4caf50]');
    expect(roundTrip(out!).headerColor).toBe('#4caf50');
  });

  it('tolerates the trailing whitespace sourceMap slices deliver', () => {
    expect(rewriteTableHeader('Table users   ', { headerColor: '#2196f3' }))
      .toBe('Table users [headerColor: #2196f3]');
  });

  it('merges into an existing bracket without touching other settings', () => {
    const out = rewriteTableHeader("Table users [note: 'core, do not drop']", { headerColor: '#ff9800' });
    expect(out).toBe("Table users [note: 'core, do not drop', headerColor: #ff9800]");
    const t = roundTrip(out!);
    expect(t.headerColor).toBe('#ff9800');
    expect(t.note).toBe('core, do not drop');
  });

  it('a quoted note containing "headerColor:" is not a false match', () => {
    const out = rewriteTableHeader("Table users [note: 'headerColor: #000000 is fake']", { headerColor: '#009688' });
    expect(out).toBe("Table users [note: 'headerColor: #000000 is fake', headerColor: #009688]");
    expect(roundTrip(out!).headerColor).toBe('#009688');
  });

  it("handles a ']' inside a quoted setting value (greedy bracket match — not a refusal)", () => {
    const out = rewriteTableHeader("Table users [note: 'a]b']", { headerColor: '#009688' });
    expect(out).toBe("Table users [note: 'a]b', headerColor: #009688]");
    const t = roundTrip(out!);
    expect(t.headerColor).toBe('#009688');
    expect(t.note).toBe('a]b');
  });

  it('removes the setting and drops an emptied bracket', () => {
    expect(rewriteTableHeader('Table users [headerColor: #2196f3]', { headerColor: null }))
      .toBe('Table users');
    expect(rewriteTableHeader('Table users', { headerColor: null })).toBe('Table users'); // nothing to remove
  });

  it('removes only headerColor when other settings remain (either position)', () => {
    expect(rewriteTableHeader("Table users [headerColor: #2196f3, note: 'x']", { headerColor: null }))
      .toBe("Table users [note: 'x']");
    expect(rewriteTableHeader("Table users [note: 'x', headerColor: #2196f3]", { headerColor: null }))
      .toBe("Table users [note: 'x']");
  });

  it('removing a MIDDLE entry leaves clean single-space separators', () => {
    // Synthetic three-entry bracket: pins the whitespace handling (no round-trip).
    expect(
      rewriteTableHeader("Table t [note: 'a', headerColor: #2196f3, note: 'b']", { headerColor: null }),
    ).toBe("Table t [note: 'a', note: 'b']");
  });

  it('rejects a non-#RRGGBB color', () => {
    expect(rewriteTableHeader('Table users', { headerColor: 'red' })).toBeNull();
    expect(rewriteTableHeader('Table users', { headerColor: '#12345' })).toBeNull();
  });
});

describe('rewriteTableHeader — rename', () => {
  it('replaces a bare name', () => {
    const out = rewriteTableHeader('Table users', { name: 'customers' });
    expect(out).toBe('Table customers');
    expect(roundTrip(out!).name).toBe('customers');
  });

  it('quotes a name that needs quoting, and can rename a quoted table', () => {
    expect(rewriteTableHeader('Table users', { name: 'order items' })).toBe('Table "order items"');
    expect(rewriteTableHeader('Table "order items"', { name: 'orders' })).toBe('Table orders');
    expect(roundTrip('Table "order items"').name).toBe('order items');
  });

  it('preserves alias and schema qualifier', () => {
    expect(rewriteTableHeader('Table users as U', { name: 'people' })).toBe('Table people as U');
    const out = rewriteTableHeader('Table auth.users [headerColor: #16a085]', { name: 'accounts' });
    expect(out).toBe('Table auth.accounts [headerColor: #16a085]');
    const t = roundTrip(out!);
    expect(t.schemaName).toBe('auth');
    expect(t.name).toBe('accounts');
  });

  it('applies rename + color in one call', () => {
    const out = rewriteTableHeader('Table users as U', { name: 'people', headerColor: '#e91e63' });
    expect(out).toBe('Table people as U [headerColor: #e91e63]');
    expect(roundTrip(out!).headerColor).toBe('#e91e63');
  });

  it('rejects unsafe names and unrecognized header shapes', () => {
    expect(rewriteTableHeader('Table users', { name: '' })).toBeNull();
    expect(rewriteTableHeader('Table users', { name: '  ' })).toBeNull();
    expect(rewriteTableHeader('Table users', { name: 'a"b' })).toBeNull();
    expect(rewriteTableHeader('Table users /* huh */', { name: 'x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/tableSettings.test.ts` — Expected: FAIL (cannot resolve `./tableSettings`).

- [ ] **Step 3: Implement**

`src/editor/tableSettings.ts`:

```ts
import { blankNoise } from './sourceMap';

/** Feature B's pure header-line rewriter — the text half of the canvas→text
 *  bridge. Input is the header segment sourceMap delimits (from the `Table`
 *  keyword up to, NOT including, the `{`). Output is the rewritten header,
 *  or null when the shape isn't one we can rewrite safely — the caller then
 *  makes NO edit (never a mangled one). */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;

// Header anatomy (single line by construction — sourceMap's HEADER_RE only
// matches headers whose `{` is on the same line):
//   Table <schema.>? <name> ( as <alias>)? [settings]?
// Anchored ^…$ so anything unexpected (a comment mid-header, stray tokens
// after the bracket) fails the match and we refuse to edit.
// The bracket group is greedy to the LAST `]` on the line, so a `]` inside a
// quoted setting value ([note: 'a]b']) is captured whole — pinned by test.
const PARTS_RE =
  /^(Table[ \t]+)((?:"[^"\n]+"|[A-Za-z_]\w*)[ \t]*\.[ \t]*)?("[^"\n]+"|[A-Za-z_]\w*)((?:[ \t]+as[ \t]+[A-Za-z_]\w*)?)(?:[ \t]*(\[[^\n]*\]))?$/i;

export interface TableHeaderEdit {
  name?: string;
  headerColor?: string | null; // null removes the setting
}

interface ColorSpan {
  keyFrom: number;
  valueFrom: number;
  valueTo: number;
}

/** Locate `headerColor: <value>` inside a settings bracket's INNER text.
 *  Scans blankNoise'd text (quoted strings blanked) so a note containing the
 *  literal words "headerColor:" can never false-match. */
function findColorSpan(inner: string): ColorSpan | null {
  const blanked = blankNoise(inner);
  const m = /(^|[,\s])headerColor[ \t]*:[ \t]*/i.exec(blanked);
  if (!m) return null;
  const keyFrom = m.index + m[1].length;
  const valueFrom = m.index + m[0].length;
  const comma = blanked.indexOf(',', valueFrom);
  let valueTo = comma === -1 ? inner.length : comma;
  while (valueTo > valueFrom && /[ \t]/.test(blanked[valueTo - 1])) valueTo--;
  return { keyFrom, valueFrom, valueTo };
}

function upsertColor(bracket: string | undefined, color: string): string {
  if (!bracket) return `[headerColor: ${color}]`;
  const inner = bracket.slice(1, -1);
  const span = findColorSpan(inner);
  if (span) return `[${inner.slice(0, span.valueFrom)}${color}${inner.slice(span.valueTo)}]`;
  if (inner.trim() === '') return `[headerColor: ${color}]`;
  return `[${inner.trimEnd()}, headerColor: ${color}]`;
}

function removeColor(bracket: string | undefined): string | undefined {
  if (!bracket) return undefined;
  const inner = bracket.slice(1, -1);
  const span = findColorSpan(inner);
  if (!span) return bracket; // not set — bracket unchanged
  const blanked = blankNoise(inner);
  let from = span.keyFrom;
  let to = span.valueTo;
  // Consume ONE separating comma — the trailing one when another entry
  // follows ("headerColor: x, rest"), else the leading one ("rest,
  // headerColor: x") — plus the spaces after it, so removing a MIDDLE entry
  // never leaves a double space.
  const after = /^[ \t]*,[ \t]*/.exec(blanked.slice(to));
  if (after) {
    to += after[0].length;
  } else {
    const before = blanked.slice(0, from);
    const comma = before.lastIndexOf(',');
    if (comma !== -1 && before.slice(comma + 1).trim() === '') from = comma;
  }
  const rest = (inner.slice(0, from) + inner.slice(to)).trim();
  return rest === '' ? undefined : `[${rest}]`;
}

/** Bare identifier when possible, double-quoted otherwise; null when the
 *  name can't be represented on a header line at all. */
function emitName(name: string): string | null {
  if (IDENT_RE.test(name)) return name;
  if (name === '' || name.includes('"') || name.includes('\n')) return null;
  return `"${name}"`;
}

export function rewriteTableHeader(header: string, edit: TableHeaderEdit): string | null {
  const m = PARTS_RE.exec(header.trimEnd());
  if (m === null) return null; // shape we don't understand — refuse, never mangle
  const [, kw, schemaPart = '', nameTok, aliasPart, bracket] = m;

  let name = nameTok;
  if (edit.name !== undefined) {
    const emitted = emitName(edit.name.trim());
    if (emitted === null) return null;
    name = emitted;
  }

  let settings: string | undefined = bracket;
  if (edit.headerColor !== undefined) {
    if (edit.headerColor === null) settings = removeColor(bracket);
    else if (HEX_COLOR_RE.test(edit.headerColor)) settings = upsertColor(bracket, edit.headerColor);
    else return null;
  }

  return `${kw}${schemaPart}${name}${aliasPart}${settings ? ` ${settings}` : ''}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor/tableSettings.test.ts` — Expected: PASS (15 tests = 10 headerColor + 5 rename; every emitted header that must parse is round-tripped through the real `@dbml/core` parser).

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && git add src/editor/tableSettings.ts src/editor/tableSettings.test.ts && git commit -m "feat: pure DBML table-header rewriter (rename + headerColor upsert/remove)"
```

---

### Task 6: Feature B wiring — `applyTableSettings` bridge, gear on TableNode, settings popover host

**Files:**
- Modify: `src/editor/editorNav.ts`, `src/canvas/TableNode.tsx` (complete replacement), `src/canvas/DiagramCanvas.tsx`, `src/styles.css`
- Create: `src/canvas/TableSettingsPopover.tsx`

**Interfaces:**
- `editorNav.ts`: `export function applyTableSettings(tableId: string, edit: TableHeaderEdit): boolean` — locate the table via `buildTableRanges`/`rangeForTable` (the same scanner `revealTable` uses; normalizer and scanner agree on `${schemaName}.${name}` identity per CLAUDE.md), rewrite the `[headerFrom, headerTo)` span via `rewriteTableHeader`, dispatch **ONE** CodeMirror transaction. Returns false on: no registered view, unknown tableId, helper refusal. A no-op rewrite returns true without dispatching. Undo = editor history; re-render = the normal parse pipeline (~300 ms). **Rename does NOT rewrite refs** — dangling refs surface as ordinary parse errors, same as typing the rename (documented at the call site and in Task 13's CLAUDE.md note).
- `TableNode` props gain exactly one entry: `onOpenSettings: (id: string) => void` — stable (`useCallback([])` in DiagramCanvas wrapping a state setter), preserving the memo contract. The gear is a small SVG group in the header (hidden until `.table-node:hover` via CSS `opacity`/`pointer-events`), rendered for `full`/`shell` LOD only; its `onPointerDown` stops propagation so a gear press never starts a drag.
- `TableSettingsPopover` — ONE host component, HTML layer (`.canvas-wrap`), never inside the SVG. Props `{ tableId: string; onClose: () => void }`. Reads table/position/viewport from the store; positioned at the table's screen point from the **committed** viewport (during an imperative pan it holds still until the gesture-end commit — accepted, documented here). Contains: Table Name input (Enter or Rename button applies), 18 swatches (`HEADER_SWATCHES`), custom hex input with `HEX_COLOR_RE` validation, a clear-color button (the helper's remove path). Every action calls `applyTableSettings` — **this component never writes schema state**. Closes on Escape / outside pointerdown / table disappearing (parse deletion, diagram switch, or its own successful rename — the id changes).
- DiagramCanvas: `const [settingsTableId, setSettingsTableId] = useState<string | null>(null)` + stable `handleOpenSettings`/`closeSettings` callbacks; popover rendered in `.canvas-wrap`.

- [ ] **Step 1: Implement the bridge**

In `src/editor/editorNav.ts`, add to the imports:

```ts
import { rewriteTableHeader, type TableHeaderEdit } from './tableSettings';
```

and append:

```ts
/** Canvas→text bridge (Feature B) — the sanctioned way for canvas-origin UI
 *  to change DBML, alongside applyFormat/revealTable: ONE CodeMirror
 *  transaction, so undo lives in editor history and the parse pipeline
 *  re-renders the result. Never touches store schema state.
 *  Renaming deliberately does NOT rewrite refs: dangling refs surface as
 *  ordinary parse errors (stale badge + problems panel), exactly as if the
 *  user had typed the rename. */
export function applyTableSettings(tableId: string, edit: TableHeaderEdit): boolean {
  const view = currentView;
  if (!view) return false;
  const doc = view.state.doc.toString();
  const range = rangeForTable(buildTableRanges(doc), tableId);
  if (!range) return false;
  const header = doc.slice(range.headerFrom, range.headerTo);
  const rewritten = rewriteTableHeader(header, edit);
  if (rewritten === null) return false; // unsafe shape — refuse, make no edit
  if (rewritten === header.trimEnd()) return true; // no-op: nothing to dispatch
  view.dispatch({
    changes: { from: range.headerFrom, to: range.headerTo, insert: `${rewritten} ` },
  });
  return true;
}
```

- [ ] **Step 2: TableNode gear (complete file replacement)**

`src/canvas/TableNode.tsx`:

```tsx
import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';
import { type LodLevel } from './lod';

interface Props {
  table: Table;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  lod: LodLevel;
  onLiveMove: (id: string, raw: TablePosition) => TablePosition;
  onCommitMove: (id: string) => void;
  onHover: (id: string | null) => void;
  focused: boolean;
  selected: boolean;
  onOpenInEditor: (id: string) => void;
  onOpenSettings: (id: string) => void; // stable callback (memo contract) — gear passes the id out
  registerEl: (id: string, el: SVGGElement | null) => void;
}

export const TableNode = memo(function TableNode({
  table, pos, zoomRef, lod, onLiveMove, onCommitMove, onHover, focused, selected,
  onOpenInEditor, onOpenSettings, registerEl,
}: Props) {
  const gRef = useRef<SVGGElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const h = tableHeight(table.fields.length);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    const zoom = zoomRef.current ?? 1;
    const raw = {
      x: drag.current.origX + (e.clientX - drag.current.startX) / zoom,
      y: drag.current.origY + (e.clientY - drag.current.startY) / zoom,
    };
    const snapped = onLiveMove(table.id, raw);
    gRef.current?.setAttribute('transform', `translate(${snapped.x}, ${snapped.y})`);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommitMove(table.id);
  };

  return (
    <g
      ref={(el) => {
        gRef.current = el;
        registerEl(table.id, el);
      }}
      transform={`translate(${pos.x}, ${pos.y})`}
      className={`table-node${focused ? ' focused' : ''}${selected ? ' selected' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onPointerEnter={() => onHover(table.id)}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={() => onOpenInEditor(table.id)}
    >
      {lod === 'box' ? (
        <rect width={TABLE_WIDTH} height={h} rx={6} className="table-box" fill={table.headerColor ?? undefined} />
      ) : (
        <>
          <rect width={TABLE_WIDTH} height={h} rx={6} className="table-body" />
          <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} className="table-header" fill={table.headerColor ?? undefined} />
          <text x={10} y={HEADER_HEIGHT / 2} dominantBaseline="central" className="table-title">
            {table.name}
          </text>
          {lod === 'full' &&
            table.fields.map((f, i) => (
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
          {/* Gear (Feature B): visible on table hover via CSS. Inline
              closures here are fine — they live INSIDE the memoized
              component; the PROP (onOpenSettings) is what must be stable.
              stopPropagation on pointerdown keeps a gear press from
              starting a drag. */}
          <g
            className="table-gear"
            transform={`translate(${TABLE_WIDTH - 24}, ${HEADER_HEIGHT / 2 - 8})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings(table.id);
            }}
          >
            <rect width={16} height={16} rx={3} className="table-gear-bg" />
            <text x={8} y={8} textAnchor="middle" dominantBaseline="central" className="table-gear-glyph">
              {'⚙︎'}
            </text>
          </g>
        </>
      )}
    </g>
  );
});
```

- [ ] **Step 3: Popover host component**

`src/canvas/TableSettingsPopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { applyTableSettings } from '../editor/editorNav';
import { HEX_COLOR_RE } from '../editor/tableSettings';
import { TABLE_WIDTH } from '../core/model/geometry';

export const HEADER_SWATCHES: readonly string[] = [
  '#2196f3', '#f44336', '#4caf50', '#ff9800', '#9c27b0', '#009688',
  '#34495e', '#e74c3c', '#d35400', '#16a085', '#2980b9', '#8e44ad',
  '#2c3e50', '#f1c40f', '#e67e22', '#7f8c8d', '#c0392b', '#e91e63',
]; // 18 swatches, dbdiagram-like (Feature B)

interface Props {
  tableId: string;
  onClose: () => void;
}

/** Single popover host in DiagramCanvas's HTML layer (Feature B). CRITICAL
 *  architecture rule: every mutation routes through applyTableSettings — a
 *  TEXT edit via editorNav (one CodeMirror transaction; editor history owns
 *  undo; the parse pipeline repaints ~300 ms later). This component never
 *  writes schema state. Positioned from the COMMITTED viewport: during an
 *  imperative pan it holds still until the gesture-end commit (accepted). */
export function TableSettingsPopover({ tableId, onClose }: Props) {
  const table = useAppStore((s) => s.schema.tables.find((t) => t.id === tableId));
  const pos = useAppStore((s) => s.positions[tableId]);
  const viewport = useAppStore((s) => s.viewport);
  const [name, setName] = useState(() => table?.name ?? '');
  const [hex, setHex] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The table can vanish under us: parse deleted it, the diagram switched,
  // or our own rename changed its id. Close instead of orphaning.
  useEffect(() => {
    if (!table || !pos) onClose();
  }, [table, pos, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  if (!table || !pos) return null;

  const setColor = (color: string | null) => {
    setErr(applyTableSettings(tableId, { headerColor: color }) ? null : 'Could not edit this table header.');
  };
  const rename = () => {
    const next = name.trim();
    if (next === '' || next === table.name) return;
    if (applyTableSettings(tableId, { name: next })) onClose(); // id changed — this popover is stale
    else setErr('Could not rename — try editing the DBML directly.');
  };
  const applyHex = () => {
    const value = (hex.startsWith('#') ? hex : `#${hex}`).toLowerCase();
    if (!HEX_COLOR_RE.test(value)) {
      setErr('Hex color must be #RRGGBB.');
      return;
    }
    setColor(value);
  };

  return (
    <div
      ref={rootRef}
      className="table-settings"
      style={{
        left: viewport.x + (pos.x + TABLE_WIDTH) * viewport.zoom + 10,
        top: viewport.y + pos.y * viewport.zoom,
      }}
    >
      <label className="ts-label">
        Table Name
        <input
          className="ts-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename();
          }}
        />
      </label>
      <button className="ts-rename" onClick={rename}>Rename</button>
      <div className="ts-label">Header Color</div>
      <div className="ts-swatches">
        {HEADER_SWATCHES.map((c) => (
          <button
            key={c}
            className={`swatch${table.headerColor?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
            data-color={c}
            style={{ background: c }}
            title={c}
            aria-label={`Set header color ${c}`}
            onClick={() => setColor(c)}
          />
        ))}
        <button className="swatch none" title="Clear color" aria-label="Clear header color" onClick={() => setColor(null)}>
          ✕
        </button>
      </div>
      <div className="ts-hex-row">
        <input
          className="ts-hex"
          placeholder="#a1b2c3"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyHex();
          }}
        />
        <button onClick={applyHex}>Set</button>
      </div>
      {err && <div className="ts-error">{err}</div>}
    </div>
  );
}
```

- [ ] **Step 4: DiagramCanvas wiring**

In `src/canvas/DiagramCanvas.tsx`:

1. Add the import:
```ts
import { TableSettingsPopover } from './TableSettingsPopover';
```
2. After the `const [layoutBusy, setLayoutBusy] = useState(false);` line:
```ts
  const [settingsTableId, setSettingsTableId] = useState<string | null>(null);
```
3. Next to the other stable callbacks (after `registerNodeEl`):
```ts
  // Stable callbacks (TableNode memo contract): the gear passes the id out;
  // the popover itself lives in the HTML layer below, outside the SVG.
  const handleOpenSettings = useCallback((id: string) => setSettingsTableId(id), []);
  const closeSettings = useCallback(() => setSettingsTableId(null), []);
```
4. In the `TableNode` render, after `onOpenInEditor={revealTable}`:
```tsx
                onOpenSettings={handleOpenSettings}
```
5. In the returned JSX, after the `.zoom-controls` div (inside `.canvas-wrap`):
```tsx
      {settingsTableId && <TableSettingsPopover tableId={settingsTableId} onClose={closeSettings} />}
```

- [ ] **Step 5: CSS**

Append to `src/styles.css`:

```css
/* Plan 6 Feature B: table gear + settings popover */
.table-gear { opacity: 0; pointer-events: none; cursor: pointer; }
.table-node:hover .table-gear { opacity: 1; pointer-events: all; }
.table-gear-bg { fill: var(--bg-elev); stroke: var(--border); }
.table-gear-glyph { font-size: 11px; fill: var(--text); user-select: none; }
.table-settings {
  position: absolute; z-index: 30; width: 224px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18); padding: 12px;
  display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text);
}
.ts-label { color: var(--text-dim); font-weight: 600; display: flex; flex-direction: column; gap: 4px; }
.ts-name, .ts-hex {
  font-size: 12px; padding: 5px 8px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg); color: var(--text);
}
.ts-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.swatch { width: 26px; height: 26px; border-radius: 4px; border: 1px solid rgba(0, 0, 0, 0.15); cursor: pointer; padding: 0; }
.swatch.active { outline: 2px solid var(--accent); outline-offset: 1px; }
.swatch.none { background: var(--bg); color: var(--text-dim); font-size: 11px; }
.ts-hex-row { display: flex; gap: 6px; }
.ts-hex { flex: 1; min-width: 0; }
.ts-hex-row button, .ts-rename {
  font-size: 12px; padding: 4px 10px; border: 1px solid var(--border);
  background: var(--bg-elev); color: var(--text); border-radius: 4px; cursor: pointer;
}
.ts-error { color: var(--error); }
```

- [ ] **Step 6: Verify (typecheck, unit regression, browser)**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: clean / green (no unit tests for the wiring by design — the bridge's text logic was proven in Task 5; the end-to-end proof is Task 12's e2e).

Browser check (dev server on 5173):
1. Hover `users` → gear fades in at the header's right; click it → popover appears beside the table. Dragging the table still works everywhere EXCEPT the gear (gear press never starts a drag).
2. Click swatch `#e91e63` → the editor text gains `Table users [headerColor: #e91e63]` **as a single edit**, and ~300 ms later the header repaints. `Ctrl/Cmd+Z` in the editor undoes the color in one step; the header reverts on the next parse.
3. Custom hex `16a085` (no `#`) + Set → normalizes to `#16a085` and applies; garbage (`zzz`) shows the inline error, no edit.
4. Clear color (✕ swatch) → the bracket disappears from the text entirely (when headerColor was its only setting).
5. Rename `users` → `customers`: header line changes, popover closes, the table keeps its position (reconcile signature heuristic), and the three starter refs to `users` produce parse errors + stale badge — the documented behavior, identical to typing the rename. Undo restores everything.
6. With the popover open: pan/zoom → popover snaps to the table at gesture end; switch diagrams → popover closes; Escape / outside click close it.
7. LOD: zoom below 15% (box tier) → no gear rendered.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: table settings popover — rename + header color via editorNav text bridge"
```

---

### Task 7: Feature C core — date labels + dashboard persistence helpers

**Files:**
- Create: `src/app/relativeDate.ts`, `src/app/relativeDate.test.ts`, `src/app/dashboardFlow.test.ts`
- Modify: `src/app/usePersistence.ts` (append two functions)

**Interfaces:**
- `relativeDate.ts` (pure, no date libraries, hard-coded English month names so CI never depends on host locale):
  - `export function ordinal(n: number): string` — `1st/2nd/3rd/4th…11th/12th/13th…21st`.
  - `export function formatDiagramDate(ts: number, now?: number): string` — same calendar day as `now` → `Today at 9:55 AM`; else `June 3rd 2024, 5:46 PM`. `now` injectable for tests (defaults `Date.now()`).
- `usePersistence.ts`:
  - `export async function renameDiagramById(id: string, name: string): Promise<void>` — current diagram routes through the existing `renameDiagram` (store + immediate flush); any other row is a read-modify-write of its persisted record (`updatedAt` refreshed). Failure → `setStorageUnavailable(true)`.
  - `export async function duplicateDiagramById(id: string): Promise<void>` — `saveCurrent()` first (duplicating the current row must copy the latest in-memory edits), then copy `{ ...rec, id: nanoid(), name: `${rec.name} copy`, createdAt: Date.now(), updatedAt: Date.now() }` **without switching** to it. No `invalidatePendingAutosave` in either helper — neither repoints the store's current diagram (the race discipline only exists for operations that do).
  - `duplicateDiagram()` (duplicate-current-and-switch) loses its ONLY caller when Task 8 removes the toolbar button, and no test imports it (grep-verified: `DiagramManager.tsx` is the sole importer; `parseResubscribe.test.ts`/`useParsePipeline.ts` mention the name only in prose comments) — Task 8 DELETES it. `duplicateDiagramById` covers current and non-current rows alike.

- [ ] **Step 1: Write the failing tests**

`src/app/relativeDate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDiagramDate, ordinal } from './relativeDate';

describe('ordinal', () => {
  it('handles st/nd/rd/th including the 11-13 exceptions', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(31)).toBe('31st');
  });
});

describe('formatDiagramDate', () => {
  // Local-time constructors keep these assertions timezone-independent.
  const at = (y: number, mo: number, d: number, h: number, mi: number) =>
    new Date(y, mo, d, h, mi).getTime();

  it('same calendar day → "Today at h:mm AM/PM"', () => {
    const now = at(2026, 6, 13, 12, 0);
    expect(formatDiagramDate(at(2026, 6, 13, 9, 55), now)).toBe('Today at 9:55 AM');
    expect(formatDiagramDate(at(2026, 6, 13, 17, 46), now)).toBe('Today at 5:46 PM');
    expect(formatDiagramDate(at(2026, 6, 13, 0, 5), now)).toBe('Today at 12:05 AM');
    expect(formatDiagramDate(at(2026, 6, 13, 12, 0), now)).toBe('Today at 12:00 PM');
  });

  it('other days → "June 3rd 2024, 5:46 PM" shape', () => {
    const now = at(2026, 6, 13, 12, 0);
    expect(formatDiagramDate(at(2024, 5, 3, 17, 46), now)).toBe('June 3rd 2024, 5:46 PM');
    expect(formatDiagramDate(at(2025, 0, 21, 8, 5), now)).toBe('January 21st 2025, 8:05 AM');
  });

  it('yesterday at the same clock time is NOT "Today"', () => {
    const now = at(2026, 6, 13, 9, 0);
    expect(formatDiagramDate(at(2026, 6, 12, 9, 0), now)).toBe('July 12th 2026, 9:00 AM');
  });
});
```

`src/app/dashboardFlow.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';
import { EMPTY_SCHEMA } from '../core/model/types';
import { putDiagram, getDiagram, listDiagrams, __resetForTests } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import { renameDiagramById, duplicateDiagramById, invalidatePendingAutosave } from './usePersistence';

const rec = (id: string, name: string, over: Partial<PersistedDiagram> = {}): PersistedDiagram => ({
  id, name, dbml: 'Table a { id int }', positions: {},
  viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1, ...over,
});

const resetStore = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, notePositions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hiddenTableIds: [], diagramCreatedAt: null, storageUnavailable: false, parsedSource: null,
  });

describe('dashboard persistence helpers (Plan 6)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });

  it('renameDiagramById renames a NON-current diagram without touching the store', async () => {
    await putDiagram(rec('other', 'Old'));
    useAppStore.getState().loadDiagram(rec('current', 'Current'));
    await renameDiagramById('other', '  New Name  ');
    expect((await getDiagram('other'))?.name).toBe('New Name');
    expect(useAppStore.getState().diagramName).toBe('Current');
  });

  it('renameDiagramById routes the CURRENT diagram through the store + flush', async () => {
    const cur = rec('current', 'Current');
    await putDiagram(cur);
    useAppStore.getState().loadDiagram(cur);
    await renameDiagramById('current', 'Renamed');
    expect(useAppStore.getState().diagramName).toBe('Renamed');
    expect((await getDiagram('current'))?.name).toBe('Renamed');
  });

  it('duplicateDiagramById copies without switching, stamping fresh createdAt', async () => {
    await putDiagram(rec('other', 'Source', { createdAt: 111, hiddenTableIds: ['public.a'] }));
    useAppStore.getState().loadDiagram(rec('current', 'Current'));
    await duplicateDiagramById('other');
    const copy = (await listDiagrams()).find((d) => d.name === 'Source copy');
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe('other');
    expect(copy!.createdAt).toBeGreaterThan(111);
    expect(copy!.hiddenTableIds).toEqual(['public.a']); // view state travels with the copy
    expect(useAppStore.getState().diagramId).toBe('current'); // no switch
  });

  it('duplicateDiagramById of the CURRENT diagram copies the latest in-memory edits', async () => {
    const cur = rec('current', 'Current');
    await putDiagram(cur);
    useAppStore.getState().loadDiagram(cur);
    useAppStore.getState().setSource('Table b { id int }'); // newer than the stored record
    await duplicateDiagramById('current');
    const copy = (await listDiagrams()).find((d) => d.name === 'Current copy');
    expect(copy?.dbml).toBe('Table b { id int }'); // saveCurrent() flushed first
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/relativeDate.test.ts src/app/dashboardFlow.test.ts` — Expected: FAIL (cannot resolve `./relativeDate`; `renameDiagramById` not exported).

- [ ] **Step 3: Implement**

`src/app/relativeDate.ts`:

```ts
/** Pure date labels for the dashboard (Feature C) — no date libraries.
 *  "Today at 9:55 AM" for the current calendar day, else
 *  "June 3rd 2024, 5:46 PM". Month names are hard-coded English so tests and
 *  CI never depend on the host locale. `now` is injectable for tests. */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function formatDiagramDate(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const h12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  const time = `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `Today at ${time}`;
  return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())} ${d.getFullYear()}, ${time}`;
}
```

Append to `src/app/usePersistence.ts` (after `renameDiagram`; `getDiagram` and `nanoid` are already imported):

```ts
/** Rename an arbitrary diagram from the dashboard (Feature C). The CURRENT
 *  diagram routes through renameDiagram (store + immediate flush); any other
 *  row is a plain read-modify-write of its persisted record. Neither path
 *  repoints the store's diagram, so no autosave invalidation is needed. */
export async function renameDiagramById(id: string, name: string): Promise<void> {
  if (useAppStore.getState().diagramId === id) return renameDiagram(name);
  try {
    const rec = await getDiagram(id);
    if (rec) await putDiagram({ ...rec, name: name.trim() || 'Untitled', updatedAt: Date.now() });
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
  }
}

/** Duplicate any diagram WITHOUT switching to the copy (dashboard kebab).
 *  saveCurrent() first so duplicating the CURRENT row copies the latest
 *  in-memory edits rather than a stale record. The current diagram never
 *  changes, so no autosave invalidation is needed. */
export async function duplicateDiagramById(id: string): Promise<void> {
  await saveCurrent();
  try {
    const rec = await getDiagram(id);
    if (!rec) return;
    await putDiagram({
      ...rec, id: nanoid(), name: `${rec.name} copy`,
      createdAt: Date.now(), updatedAt: Date.now(), // a copy is a NEW document
    });
  } catch {
    useAppStore.getState().setStorageUnavailable(true);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/relativeDate.test.ts src/app/dashboardFlow.test.ts` — Expected: PASS (8 new = 4 relativeDate + 4 dashboardFlow).

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && npx tsc --noEmit && git add -A && git commit -m "feat: dashboard core — relative date labels + rename/duplicate-by-id persistence helpers"
```

---

### Task 8: Feature C — project dashboard overlay, DiagramManager slim-down, interop spec update

**Files:**
- Create: `src/app/DiagramDashboard.tsx`
- Modify: `src/app/DiagramManager.tsx` (complete replacement), `src/app/usePersistence.ts` (delete `duplicateDiagram`), `src/styles.css`, `e2e/interop.spec.ts` (one assertion)

**Interfaces:**
- `DiagramDashboard({ onClose }: { onClose: () => void })` — full-height overlay: backdrop (`.dash-backdrop`, click closes) + centered full-height panel (`.dashboard`); left rail with "New Diagram" (`createDiagram()` then close — it switches to the new diagram) and a "My Diagrams" label; main area with search input (case-insensitive name filter), table with **Name / Date Modified / Date Created** columns (`formatDiagramDate`; `createdAt === undefined` → "—"), rows clickable (`switchDiagram` + close), per-row kebab (`⋮`, `aria-label="Row actions"`) with Open / Rename (inline input: **Enter commits, blur/Escape cancels** — blur-commit would misfire when clicking elsewhere) / Duplicate (`duplicateDiagramById` + refresh, stays on the current diagram) / Delete (inline `confirm ✓ / ✕` two-step, then `removeDiagram` — the existing function handles deleting the CURRENT diagram safely). Escape closes the overlay; Escape inside the rename input stops propagation and only cancels the rename. NO accounts/share/upgrade/API-token elements.
- **Open trigger decision (documented):** the `▼ diagrams` button opens the dashboard on CLICK, not hover — Feature C's scope grants the call, and hover-opening a screen-stealing overlay from a toolbar drive-by is hostile. `useHoverMenu` remains the shared behavior for dropdown-shaped menus only.
- `DiagramManager` slims to: inline-rename name button (kept — quick rename of the current diagram) + the dashboard trigger. The `+ new` / `duplicate` toolbar buttons and the old `.diagram-list` dropdown are REMOVED (their functions live in the dashboard now), and `duplicateDiagram()` is DELETED from `usePersistence.ts` — dead code once the button is gone (no test imports it; the dashboard's `duplicateDiagramById` covers both current and non-current rows).
- Kebab-menu open state is single-row (`menuId`); opening another row's kebab closes the previous. Accepted simplification: the kebab menu has no dedicated outside-click closer — row clicks, Escape (overlay), and other kebabs all collapse it.
- e2e: `interop.spec.ts`'s diagram-count assertion moves from `.diagram-list li` to `.dash-row` (the trigger locator `/diagrams/` still matches — the label is unchanged).

- [ ] **Step 1: Dashboard component**

`src/app/DiagramDashboard.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listDiagrams } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import {
  switchDiagram, createDiagram, removeDiagram, renameDiagramById, duplicateDiagramById,
} from './usePersistence';
import { formatDiagramDate } from './relativeDate';

interface Props {
  onClose: () => void;
}

/** dbdiagram-style project dashboard (Feature C). Fetches the list on open;
 *  every mutation routes through the existing usePersistence flows (which own
 *  the autosave-invalidation race discipline) and then re-fetches. */
export function DiagramDashboard({ onClose }: Props) {
  const diagramId = useAppStore((s) => s.diagramId);
  const [items, setItems] = useState<PersistedDiagram[]>([]);
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listDiagrams().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, diagramId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commitRename = (id: string, value: string) => {
    setRenamingId(null);
    void renameDiagramById(id, value).then(refresh);
  };

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((d) => d.name.toLowerCase().includes(q)) : items;

  return (
    <div className="dash-backdrop" onClick={onClose}>
      <div className="dashboard" onClick={(e) => e.stopPropagation()}>
        <aside className="dash-rail">
          <button className="dash-new" onClick={() => void createDiagram().then(onClose)}>
            New Diagram
          </button>
          <div className="dash-rail-label">My Diagrams</div>
        </aside>
        <main className="dash-main">
          <div className="dash-topbar">
            <input
              className="dash-search"
              placeholder="Search diagrams…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="dash-close" aria-label="Close" onClick={onClose}>✕</button>
          </div>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date Modified</th>
                <th>Date Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr
                  key={d.id}
                  className={`dash-row${d.id === diagramId ? ' current' : ''}`}
                  onClick={() => void switchDiagram(d.id).then(onClose)}
                >
                  <td className="dash-name">
                    {renamingId === d.id ? (
                      <input
                        autoFocus
                        defaultValue={d.name}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => setRenamingId(null)}
                        onKeyDown={(e) => {
                          e.stopPropagation(); // Escape cancels the rename, not the dashboard
                          if (e.key === 'Enter') commitRename(d.id, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                      />
                    ) : (
                      d.name
                    )}
                  </td>
                  <td className="dash-modified">{formatDiagramDate(d.updatedAt)}</td>
                  <td className="dash-created">
                    {d.createdAt !== undefined ? formatDiagramDate(d.createdAt) : '—'}
                  </td>
                  <td className="dash-actions" onClick={(e) => e.stopPropagation()}>
                    {confirmingId === d.id ? (
                      <>
                        <button
                          className="danger"
                          onClick={() => {
                            setConfirmingId(null);
                            void removeDiagram(d.id).then(refresh);
                          }}
                        >
                          confirm ✓
                        </button>
                        <button onClick={() => setConfirmingId(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="dash-kebab"
                          aria-label="Row actions"
                          onClick={() => {
                            setConfirmingId(null);
                            setMenuId(menuId === d.id ? null : d.id);
                          }}
                        >
                          ⋮
                        </button>
                        {menuId === d.id && (
                          <div className="dash-menu">
                            <button onClick={() => void switchDiagram(d.id).then(onClose)}>Open</button>
                            <button onClick={() => { setMenuId(null); setRenamingId(d.id); }}>Rename</button>
                            <button onClick={() => { setMenuId(null); void duplicateDiagramById(d.id).then(refresh); }}>
                              Duplicate
                            </button>
                            <button className="danger" onClick={() => { setMenuId(null); setConfirmingId(d.id); }}>
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td className="dash-empty" colSpan={4}>No diagrams match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DiagramManager (complete replacement)**

`src/app/DiagramManager.tsx`:

```tsx
import { useState } from 'react';
import { useAppStore } from './store';
import { renameDiagram } from './usePersistence';
import { DiagramDashboard } from './DiagramDashboard';

export function DiagramManager() {
  const diagramName = useAppStore((s) => s.diagramName);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);

  return (
    <div className="diagram-manager">
      {editingName ? (
        <input
          className="name-input"
          autoFocus
          defaultValue={diagramName}
          onBlur={(e) => {
            void renameDiagram(e.target.value);
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <button className="name-button" onClick={() => setEditingName(true)} title="Rename">
          {diagramName} ✎
        </button>
      )}
      {/* CLICK-open by design (documented in the plan): Feature C replaces the
          dropdown with a full-height overlay, and hover-opening something
          that steals the whole screen is hostile. useHoverMenu stays the
          shared behavior for dropdown-shaped menus (Export, History). */}
      <button onClick={() => setDashboardOpen(true)}>▼ diagrams</button>
      {dashboardOpen && <DiagramDashboard onClose={() => setDashboardOpen(false)} />}
    </div>
  );
}
```

Then in `src/app/usePersistence.ts`, DELETE the entire `duplicateDiagram()` function (including its doc comment) — its only caller was the toolbar button removed above (Task 2's `createdAt` edit to it was interim-correctness only). Verify it is truly dead:

```bash
grep -rn "duplicateDiagram\b" src/ e2e/ | grep -v "duplicateDiagramById"
```
Expected: only prose-comment mentions in `useParsePipeline.ts` and `parseResubscribe.test.ts` (the byte-identical-source scenario they describe still exists via `duplicateDiagramById`) — no imports, no calls.

- [ ] **Step 3: CSS**

In `src/styles.css`, DELETE the now-dead dropdown rules (`.diagram-list`, `.diagram-list li`, `.diagram-list li.current`, `.diagram-list .open-button`, `.diagram-list .when`, `.diagram-list .danger` — six rules), then append:

```css
/* Plan 6 Feature C: project dashboard */
.dash-backdrop { position: fixed; inset: 0; background: var(--scrim); z-index: 40; }
.dashboard {
  position: fixed; top: 0; bottom: 0; left: 50%; transform: translateX(-50%);
  width: min(960px, 94vw); z-index: 41; display: flex; background: var(--bg);
  border-left: 1px solid var(--border); border-right: 1px solid var(--border);
  box-shadow: 0 0 48px rgba(0, 0, 0, 0.3); color: var(--text);
}
.dash-rail {
  width: 190px; border-right: 1px solid var(--border); background: var(--bg-panel);
  padding: 16px; display: flex; flex-direction: column; gap: 14px;
}
.dash-new {
  font-size: 13px; padding: 8px 10px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff; border-radius: 6px; cursor: pointer;
}
.dash-rail-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
.dash-main { flex: 1; display: flex; flex-direction: column; padding: 16px; gap: 12px; overflow-y: auto; min-width: 0; }
.dash-topbar { display: flex; gap: 8px; }
.dash-search {
  flex: 1; font-size: 13px; padding: 7px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg); color: var(--text);
}
.dash-close { border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.dash-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dash-table th {
  text-align: left; color: var(--text-dim); font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.04em; padding: 6px 8px; border-bottom: 1px solid var(--border);
}
.dash-row td { padding: 9px 8px; border-bottom: 1px solid var(--border); }
.dash-row { cursor: pointer; }
.dash-row:hover { background: var(--selection-bg); }
.dash-row.current .dash-name { font-weight: 600; }
.dash-name input { font-size: 13px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
.dash-modified, .dash-created { color: var(--text-dim); white-space: nowrap; }
.dash-actions { position: relative; width: 100px; text-align: right; white-space: nowrap; }
.dash-actions button { font-size: 12px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.dash-kebab { border: none !important; background: none !important; font-size: 15px; color: var(--text-dim) !important; }
.dash-menu {
  position: absolute; right: 4px; top: 26px; z-index: 5; min-width: 140px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); padding: 4px; display: flex; flex-direction: column;
}
.dash-menu button { text-align: left; border: none; background: none; padding: 7px 10px; border-radius: 4px; font-size: 12px; }
.dash-menu button:hover { background: var(--selection-bg); }
.dash-menu .danger, .dash-actions .danger { color: var(--error); }
.dash-empty { color: var(--text-dim); padding: 16px 8px; }
```

- [ ] **Step 4: Update the interop spec's diagram-count assertion**

In `e2e/interop.spec.ts`, replace:

```ts
  await expect(page.locator('.diagram-list li')).toHaveCount(1 + DIALECTS.length);
```

with:

```ts
  // Feature C: the diagrams trigger now opens the dashboard overlay.
  await expect(page.locator('.dash-row')).toHaveCount(1 + DIALECTS.length);
```

- [ ] **Step 5: Verify (typecheck, unit, e2e, browser)**

```bash
npx tsc --noEmit && npx vitest run && npx playwright test e2e/interop.spec.ts
```
Expected: clean / green / 2 passed (the import test now counts `.dash-row`).

Browser check:
1. Click `▼ diagrams` → full-height dashboard over a dimmed backdrop; current diagram's row bold; Modified shows "Today at …"; Created shows "Today at …" for fresh records and "—" for any record created before this branch (backward compat visible).
2. New Diagram → dashboard closes, editor shows the starter; reopen → two rows.
3. Search narrows live; clearing restores.
4. Kebab → Rename → inline input: Enter commits (row + toolbar name update when it's the current diagram), Escape cancels without closing the dashboard, clicking away cancels.
5. Kebab → Duplicate → a "<name> copy" row appears, current diagram unchanged.
6. Kebab → Delete → confirm ✓ removes; deleting the CURRENT diagram falls back per `removeDiagram` (next diagram or a fresh starter) — no resurrection after reload.
7. Row click opens that diagram and closes the overlay; backdrop click and ✕ close; Escape closes.
8. Dark theme pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: project dashboard overlay replaces diagrams dropdown (search, dates, kebab actions)"
```

---

### Task 9: Feature D core — visibility helpers, hidden-aware export bounds + ELK graph (pure, headless)

**Files:**
- Create: `src/core/model/visibility.ts`, `src/core/model/visibility.test.ts`
- Modify: `src/app/export/exportBounds.ts`, `src/core/layout/elkGraph.ts`, `src/core/layout/elkLayout.ts`
- Test: `src/app/export/exportBounds.test.ts` (append), `src/core/layout/elkGraph.test.ts` (append)

**Interfaces:**
- `visibility.ts` (pure core — imports only `./types` + `./geometry`):
  - `export function omitHidden(positions: Record<string, TablePosition>, hiddenTableIds: readonly string[]): Record<string, TablePosition>` — filtered view of the positions map; returns the input object unchanged when nothing is hidden (memo-friendly). Hidden tables KEEP their entries in `store.positions` — hiding is a view concern; this is the lens consumers use.
  - `export function visibleTableRects(schema: Schema, positions: Record<string, TablePosition>, hiddenTableIds: readonly string[]): Array<{ id: string; rect: Rect }>` — the ONE assembly of "positioned AND visible" used by zoom-to-fit, marquee hit-testing, and export bounds, so the three can't drift.
- `computeExportBounds(schema, positions, notePositions, hiddenTableIds: readonly string[] = [])` — tables via `visibleTableRects`; group rects via `computeGroupRect(g, schema, omitHidden(positions, hiddenTableIds))` so a group shrinks to its visible members and contributes nothing when all are hidden. Default `[]` keeps every existing caller/test green.
- `buildElkGraph(schema, hiddenTableIds: readonly string[] = [])` — children exclude hidden tables; the ref filter's id-set is built from the FILTERED children, so refs touching a hidden endpoint drop automatically. `runElkLayout(schema, hiddenTableIds = [])` passes through. `elkResultToPositions` already returns positions only for laid-out children → hidden tables keep their stored positions (the `autoLayout` commit only carries returned ids).

- [ ] **Step 1: Write the failing tests**

`src/core/model/visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { omitHidden, visibleTableRects } from './visibility';
import { parseDbml } from '../parse/parseDbml';

const r = parseDbml('Table a { id int }\nTable b { id int }\nTable c { id int }');
if (!r.ok) throw new Error('fixture parse failed');
const schema = r.schema;
const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 300, y: 0 } }; // c unpositioned

describe('omitHidden', () => {
  it('drops hidden ids, keeps the rest', () => {
    expect(Object.keys(omitHidden(positions, ['public.b']))).toEqual(['public.a']);
  });

  it('returns the SAME map object when nothing is hidden (memo-friendly)', () => {
    expect(omitHidden(positions, [])).toBe(positions);
  });

  it('ignores hidden ids with no position entry', () => {
    expect(omitHidden(positions, ['public.zzz'])).toEqual(positions);
  });
});

describe('visibleTableRects', () => {
  it('excludes hidden and unpositioned tables', () => {
    expect(visibleTableRects(schema, positions, ['public.a']).map((x) => x.id)).toEqual(['public.b']);
  });

  it('with nothing hidden, matches the positioned set', () => {
    expect(visibleTableRects(schema, positions, []).map((x) => x.id)).toEqual(['public.a', 'public.b']);
  });
});
```

Append to `src/app/export/exportBounds.test.ts` (add `import { parseDbml } from '../../core/parse/parseDbml';` if not already present):

```ts
describe('computeExportBounds — hidden tables (Plan 6)', () => {
  it('excludes hidden tables (and their group contribution) from the bounds', () => {
    const r = parseDbml('Table a { id int }\nTable b { id int }\nTableGroup g1 { a b }');
    if (!r.ok) throw new Error('fixture parse failed');
    const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 1000, y: 0 } };
    const full = computeExportBounds(r.schema, positions, {});
    const without = computeExportBounds(r.schema, positions, {}, ['public.b']);
    expect(full).not.toBeNull();
    expect(without).not.toBeNull();
    // b sits at x=1000: with it hidden, nothing (table OR group padding) may reach that far right
    expect(without!.x + without!.w).toBeLessThan(1000);
    expect(full!.x + full!.w).toBeGreaterThan(1000);
  });

  it('returns null when every table is hidden and nothing else is positioned', () => {
    const r = parseDbml('Table a { id int }\nTableGroup g1 { a }');
    if (!r.ok) throw new Error('fixture parse failed');
    expect(computeExportBounds(r.schema, { 'public.a': { x: 0, y: 0 } }, {}, ['public.a'])).toBeNull();
  });
});
```

Append to `src/core/layout/elkGraph.test.ts` (add `import { parseDbml } from '../parse/parseDbml';` if not already present):

```ts
describe('buildElkGraph — hidden tables (Plan 6)', () => {
  it('lays out only visible tables and drops refs touching hidden ones', () => {
    const r = parseDbml('Table a { id int }\nTable b { a_id int }\nTable c { id int }\nRef: b.a_id > a.id\n');
    if (!r.ok) throw new Error('fixture parse failed');
    const g = buildElkGraph(r.schema, ['public.a']);
    expect(g.children.map((c) => c.id)).toEqual(['public.b', 'public.c']);
    expect(g.edges).toEqual([]); // the only ref touches hidden public.a
  });

  it('default (nothing hidden) is unchanged', () => {
    const r = parseDbml('Table a { id int }\nTable b { a_id int }\nRef: b.a_id > a.id\n');
    if (!r.ok) throw new Error('fixture parse failed');
    const g = buildElkGraph(r.schema);
    expect(g.children).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/model/visibility.test.ts src/app/export/exportBounds.test.ts src/core/layout/elkGraph.test.ts` — Expected: FAIL (cannot resolve `./visibility`; extra arguments rejected by the current signatures).

- [ ] **Step 3: Implement**

`src/core/model/visibility.ts`:

```ts
import type { Rect, Schema, TablePosition } from './types';
import { getTableRect } from './geometry';

/** Feature D helpers. Hidden tables KEEP their entries in store.positions —
 *  hiding is a VIEW concern, never a layout mutation — so consumers that
 *  must not see them (group rects, export bounds) look through this lens. */

/** Positions map without the hidden tables' entries. Returns the input map
 *  unchanged when nothing is hidden (memo/referential-equality friendly). */
export function omitHidden(
  positions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[],
): Record<string, TablePosition> {
  if (hiddenTableIds.length === 0) return positions;
  const hidden = new Set(hiddenTableIds);
  const out: Record<string, TablePosition> = {};
  for (const id of Object.keys(positions)) {
    if (!hidden.has(id)) out[id] = positions[id];
  }
  return out;
}

/** id+rect of every VISIBLE positioned table — the one assembly shared by
 *  zoom-to-fit, marquee hit-testing, and export bounds, so "hidden tables
 *  don't count" cannot drift between them. */
export function visibleTableRects(
  schema: Schema,
  positions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[],
): Array<{ id: string; rect: Rect }> {
  const hidden = new Set(hiddenTableIds);
  return schema.tables
    .filter((t) => positions[t.id] && !hidden.has(t.id))
    .map((t) => ({ id: t.id, rect: getTableRect(t, positions[t.id]) }));
}
```

`src/app/export/exportBounds.ts` (complete replacement):

```ts
/** Pure export-bounds computation — no DOM access, unit-tested in vitest's
 *  node environment (see svgExport.ts for the DOM-touching serialization
 *  that consumes this). */
import type { Schema, TablePosition, Rect } from '../../core/model/types';
import { getNoteRect, unionRects } from '../../core/model/geometry';
import { computeGroupRect } from '../../core/layout/groups';
import { omitHidden, visibleTableRects } from '../../core/model/visibility';

/** Full-diagram export bounds: the union of every VISIBLE positioned table,
 *  every sticky note, and every group rect over visible members. Group rects
 *  are included explicitly (not just implied by their member tables) because
 *  computeGroupRect pads beyond its members — header strip + padding — so a
 *  group anchored at the diagram's edge would otherwise get clipped. Hidden
 *  tables (Plan 6, Feature D) are excluded from BOTH the table union and the
 *  group rects: a group whose members are all hidden contributes nothing. */
export function computeExportBounds(
  schema: Schema,
  positions: Record<string, TablePosition>,
  notePositions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[] = [],
): Rect | null {
  const tableRects = visibleTableRects(schema, positions, hiddenTableIds).map((x) => x.rect);
  const noteRects = schema.notes.filter((n) => notePositions[n.id]).map((n) => getNoteRect(notePositions[n.id]));
  const visPositions = omitHidden(positions, hiddenTableIds);
  const groupRects = schema.groups
    .map((g) => computeGroupRect(g, schema, visPositions))
    .filter((r): r is Rect => r !== null);
  return unionRects([...tableRects, ...noteRects, ...groupRects]);
}
```

`src/core/layout/elkGraph.ts` — replace `buildElkGraph` with:

```ts
export function buildElkGraph(schema: Schema, hiddenTableIds: readonly string[] = []): ElkGraphIn {
  // Feature D: lay out only VISIBLE tables. Hidden ones keep their stored
  // positions because elkResultToPositions only emits laid-out children and
  // the auto-layout commit only carries returned ids.
  const hidden = new Set(hiddenTableIds);
  const visible = schema.tables.filter((t) => !hidden.has(t.id));
  const ids = new Set(visible.map((t) => t.id));
  return {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: visible.map((t) => ({
      id: t.id,
      width: TABLE_WIDTH,
      height: tableHeight(t.fields.length),
    })),
    edges: schema.refs
      .filter(
        (r) =>
          ids.has(r.from.tableId) &&
          ids.has(r.to.tableId) &&
          r.from.tableId !== r.to.tableId,
      )
      .map((r) => ({ id: r.id, sources: [r.from.tableId], targets: [r.to.tableId] })),
  };
}
```

`src/core/layout/elkLayout.ts` — replace `runElkLayout`'s signature and first line:

```ts
export function runElkLayout(
  schema: Schema,
  hiddenTableIds: readonly string[] = [],
): Promise<Record<string, TablePosition>> {
  const graph = buildElkGraph(schema, hiddenTableIds);
```
(rest of the function unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/model/visibility.test.ts src/app/export/exportBounds.test.ts src/core/layout/elkGraph.test.ts src/core/layout/elkLayout.test.ts` — Expected: PASS (9 new; existing exportBounds/elkGraph/elkLayout tests green via the default parameters).

- [ ] **Step 5: Purity audit, full suite, commit**

```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output (`visibility.ts` is pure core).

```bash
npx vitest run && npx tsc --noEmit && git add -A && git commit -m "feat: hidden-aware visibility helpers, export bounds, and ELK graph (pure core)"
```

---

### Task 10: Feature D wiring — canvas/edge/minimap/fit/marquee/export filtering, `canvasNav` handle, Diagram Views sidebar

**Files:**
- Create: `src/canvas/canvasNav.ts`, `src/canvas/DiagramViewsSidebar.tsx`
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/canvas/EdgeLayer.tsx`, `src/canvas/MiniMap.tsx`, `src/canvas/GroupLayer.tsx`, `src/app/export/svgExport.ts`, `src/styles.css`

**Interfaces:**
- `canvasNav.ts` — the registered-handle pattern `editorNav` uses, canvas-side: `export interface CanvasHandle { centerOnTable(id: string): void }`, `registerCanvasHandle(h: CanvasHandle | null)`, `centerOnTable(id: string)` (no-op when no canvas is mounted). DiagramCanvas registers an implementation that recenters the committed viewport on the table's rect at the CURRENT zoom (single-rect reuse of the fit math idea) and flashes the focus outline by reusing `editorFocusTableId` (set, then clear after 1.5 s if still ours — the same store field the editor-cursor highlight drives, so no new highlight machinery).
- **Where the visibility filter runs (perf contract):** DiagramCanvas memoizes `hiddenSet` from committed `hiddenTableIds`; the tables `.map()` returns null for hidden ids BEFORE the culling check (O(1) per table, render-time only). EdgeLayer filters `specs` in its existing `useMemo` — everything downstream (render, `specsByTable`, the imperative `updateTablePositions`) inherits the filter with zero per-tick additions. MiniMap filters its `items` memo. Fit/marquee use `visibleTableRects`. Drag snap candidates exclude hidden tables (no ghost alignment guides). `buildDiagramSvg` passes `hiddenTableIds` to `computeExportBounds`; the serialized clone is already hidden-free because hidden tables/edges are simply not mounted.
- Group behavior (verified in Step 6, documented here): `GroupLayer` computes rects from `omitHidden` positions → a group shrinks around its visible members and **disappears when all members are hidden** (`computeGroupRect` → null). Group-header drags still move ALL members' stored positions, hidden ones included (`startDrag` reads the unfiltered store positions) — deliberate: group integrity survives hide/unhide, and this is the intentional exception to Task 1's hiding-deselects rule (group drags move members by GROUP MEMBERSHIP, not selection).
- Sticky notes are unaffected by design (visibility is per-table only).
- `DiagramViewsSidebar` — right-edge collapsible: collapsed = `.views-tab` chevron button at mid-right; expanded = `.views-panel` with search (filters listed table rows; schema counts always reflect the full schema), fixed "Group by: Schema" label, schema rows (`visibleCount/total` + eye toggling all member tables), table rows (eye toggle + name click → `centerOnTable`; centering works whether or not the table is hidden — the eye is the visibility control), and an "All" footer button (`setHiddenTables([])`). Collapse state is component-local session state. The panel overlays the canvas' right edge (above minimap/zoom controls) like dbdiagram.
- Eye icons: inline SVG (a filled eye; the "off" state dims it and adds a slash) — no icon library.

- [ ] **Step 1: canvasNav + sidebar components**

`src/canvas/canvasNav.ts`:

```ts
/** Registered-handle bridge into the live DiagramCanvas — the same pattern
 *  editorNav uses for the editor (single registered instance, callers no-op
 *  when nothing is mounted). Feature D's sidebar uses it to center a table. */
export interface CanvasHandle {
  centerOnTable(id: string): void;
}

let current: CanvasHandle | null = null;

export function registerCanvasHandle(h: CanvasHandle | null): void {
  current = h;
}

export function centerOnTable(id: string): void {
  current?.centerOnTable(id);
}
```

`src/canvas/DiagramViewsSidebar.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useAppStore } from '../app/store';
import { centerOnTable } from './canvasNav';
import type { Table } from '../core/model/types';

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Zm7 2.3A2.3 2.3 0 1 0 8 5.7a2.3 2.3 0 0 0 0 4.6Z"
        fill="currentColor"
        opacity={off ? 0.3 : 1}
      />
      {off && <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

/** Diagram Views (Feature D). Table visibility is VIEW state — hiddenTableIds
 *  in the store, persisted with the diagram, never written to DBML. Search
 *  filters which rows are LISTED; the schema counts and the schema-level eye
 *  always operate on the schema's FULL table set. */
export function DiagramViewsSidebar() {
  const [expanded, setExpanded] = useState(false); // session-local, deliberately not persisted
  const [query, setQuery] = useState('');
  const tables = useAppStore((s) => s.schema.tables);
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  const setHiddenTables = useAppStore((s) => s.setHiddenTables);
  const hidden = useMemo(() => new Set(hiddenTableIds), [hiddenTableIds]);

  const groups = useMemo(() => {
    const m = new Map<string, Table[]>();
    for (const t of tables) m.set(t.schemaName, [...(m.get(t.schemaName) ?? []), t]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tables]);
  const q = query.trim().toLowerCase();

  const toggleTable = (id: string) => {
    setHiddenTables(
      hidden.has(id) ? hiddenTableIds.filter((h) => h !== id) : [...hiddenTableIds, id],
    );
  };
  const toggleSchema = (members: Table[]) => {
    const ids = members.map((t) => t.id);
    if (ids.some((id) => !hidden.has(id))) {
      setHiddenTables([...new Set([...hiddenTableIds, ...ids])]); // hide all
    } else {
      const drop = new Set(ids);
      setHiddenTables(hiddenTableIds.filter((h) => !drop.has(h))); // show all
    }
  };

  if (!expanded) {
    return (
      <button className="views-tab" title="Diagram Views" onClick={() => setExpanded(true)}>
        ‹
      </button>
    );
  }

  return (
    <div className="views-panel">
      <div className="views-header">
        <span>Diagram Views</span>
        <button className="views-collapse" title="Collapse" onClick={() => setExpanded(false)}>›</button>
      </div>
      <input
        className="views-search"
        placeholder="Search tables…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="views-groupby">Group by: Schema</div>
      <div className="views-tree">
        {groups.map(([schemaName, members]) => {
          const listed = q ? members.filter((t) => t.name.toLowerCase().includes(q)) : members;
          if (q && listed.length === 0) return null;
          const visibleCount = members.filter((t) => !hidden.has(t.id)).length;
          return (
            <div key={schemaName}>
              <div className="views-schema">
                <span className="views-schema-name">{schemaName}</span>
                <span className="views-count">{visibleCount}/{members.length}</span>
                <button
                  className="views-eye"
                  aria-label="Toggle visibility"
                  title={visibleCount > 0 ? 'Hide all tables in this schema' : 'Show all tables in this schema'}
                  onClick={() => toggleSchema(members)}
                >
                  <EyeIcon off={visibleCount === 0} />
                </button>
              </div>
              {listed.map((t) => (
                <div key={t.id} className="views-table-row">
                  <button className="views-name" title="Center on this table" onClick={() => centerOnTable(t.id)}>
                    {t.name}
                  </button>
                  <button className="views-eye" aria-label="Toggle visibility" onClick={() => toggleTable(t.id)}>
                    <EyeIcon off={hidden.has(t.id)} />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="views-footer">
        <button className="views-all" title="Show every table" onClick={() => setHiddenTables([])}>
          All
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DiagramCanvas edits**

In `src/canvas/DiagramCanvas.tsx`:

1. Imports — add:
```ts
import { DiagramViewsSidebar } from './DiagramViewsSidebar';
import { registerCanvasHandle } from './canvasNav';
import { visibleTableRects } from '../core/model/visibility';
```
2. Selectors — after `const selectedSet = useMemo(…)`:
```ts
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  // Committed-state filter (perf contract): consulted only inside render
  // maps; the imperative pan/drag paths never see it because hidden
  // tables/edges are simply not mounted.
  const hiddenSet = useMemo(() => new Set(hiddenTableIds), [hiddenTableIds]);
```
3. In `handleLiveMove`'s drag-init block, exclude hidden tables from snap candidates — replace:
```ts
        otherRects: s.schema.tables
          .filter((t) => s.positions[t.id] && !memberSet.has(t.id))
          .map((t) => getTableRect(t, s.positions[t.id])),
```
with:
```ts
        // Snap candidates exclude hidden tables — no ghost alignment guides.
        otherRects: visibleTableRects(s.schema, s.positions, s.hiddenTableIds)
          .filter((x) => !memberSet.has(x.id))
          .map((x) => x.rect),
```
4. Tables render map — insert the hidden check as the FIRST line of the `.map()` callback body:
```ts
            if (hiddenSet.has(t.id)) return null; // Feature D: hidden = not mounted
```
5. Marquee `onPointerUp` — replace the `items` assembly:
```ts
    const items = store.schema.tables
      .filter((t) => store.positions[t.id])
      .map((t) => ({ id: t.id, rect: getTableRect(t, store.positions[t.id]) }));
```
with:
```ts
    const items = visibleTableRects(store.schema, store.positions, store.hiddenTableIds); // can't select hidden
```
6. `fit()` — replace the rects line:
```ts
    const { schema, positions } = useAppStore.getState();
    const rects = schema.tables.filter((t) => positions[t.id]).map((t) => getTableRect(t, positions[t.id]));
```
with:
```ts
    const { schema, positions, hiddenTableIds: hid } = useAppStore.getState();
    const rects = visibleTableRects(schema, positions, hid).map((x) => x.rect);
```
7. `autoLayout()` — replace its first two lines:
```ts
    const { schema } = useAppStore.getState();
    if (schema.tables.length === 0 || layoutBusy) return;
```
with:
```ts
    const { schema, hiddenTableIds: hid } = useAppStore.getState();
    if (schema.tables.length === 0 || layoutBusy) return;
```
and the layout call `const next = await runElkLayout(schema);` with:
```ts
      const next = await runElkLayout(schema, hid); // visible only; hidden keep their positions
```
8. Register the canvas handle — add this effect after the keyboard-shortcuts effect:
```ts
  // canvasNav registered handle (same pattern as editorNav): the Views
  // sidebar centers tables through it. Committed-viewport write → the
  // layout-effect subscription applies the transform before paint.
  useEffect(() => {
    registerCanvasHandle({
      centerOnTable(id) {
        const s = useAppStore.getState();
        const table = s.schema.tables.find((t) => t.id === id);
        const pos = s.positions[id];
        const svg = svgRef.current;
        if (!table || !pos || !svg) return;
        const rect = getTableRect(table, pos);
        const view = svg.getBoundingClientRect();
        const zoom = vpRef.current.zoom; // keep the user's zoom, just recenter
        s.setViewport({
          zoom,
          x: view.width / 2 - (rect.x + rect.w / 2) * zoom,
          y: view.height / 2 - (rect.y + rect.h / 2) * zoom,
        });
        // Flash the focus outline via the same store field the editor-cursor
        // highlight uses — no new highlight machinery.
        s.setEditorFocusTable(id);
        setTimeout(() => {
          const st = useAppStore.getState();
          if (st.editorFocusTableId === id) st.setEditorFocusTable(null);
        }, 1500);
      },
    });
    return () => registerCanvasHandle(null);
  }, []);
```
9. Render — after the `.zoom-controls` div, before the settings popover line:
```tsx
      <DiagramViewsSidebar />
```

- [ ] **Step 3: EdgeLayer, MiniMap, GroupLayer, svgExport**

`src/canvas/EdgeLayer.tsx` — replace the `specs` memo (and add the selector above it):

```ts
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  // Feature D: filtering HERE means render, specsByTable, and the imperative
  // updateTablePositions path all inherit it — an edge with a hidden endpoint
  // simply doesn't exist, and no per-tick code changes.
  const specs = useMemo(() => {
    const hidden = new Set(hiddenTableIds);
    return buildEdgeSpecs(schema).filter(
      (sp) => !hidden.has(sp.fromTableId) && !hidden.has(sp.toTableId),
    );
  }, [schema, hiddenTableIds]);
```

`src/canvas/MiniMap.tsx` — add the selector after `const positions = …`:
```ts
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
```
and replace the `items` memo with:
```ts
  const items = useMemo(() => {
    const hidden = new Set(hiddenTableIds);
    return schema.tables
      .filter((t) => positions[t.id] && !hidden.has(t.id))
      .map((t) => ({ id: t.id, rect: getTableRect(t, positions[t.id]), color: t.headerColor }));
  }, [schema, positions, hiddenTableIds]);
```

`src/canvas/GroupLayer.tsx` — add imports/selector:
```ts
import { useMemo } from 'react'; // extend the existing react import
import { omitHidden } from '../core/model/visibility';
```
after `const positions = …`:
```ts
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  // Group rects hug VISIBLE members only; all-hidden → computeGroupRect null
  // → the group disappears. Group-header drags still move ALL members'
  // stored positions (startDrag reads unfiltered store positions) —
  // deliberate: group integrity survives hide/unhide. This is the intentional
  // exception to hiding-deselects: membership, not selection, drives it.
  const visPositions = useMemo(() => omitHidden(positions, hiddenTableIds), [positions, hiddenTableIds]);
```
and in the render, change `computeGroupRect(g, schema, positions)` to `computeGroupRect(g, schema, visPositions)`.

`src/app/export/svgExport.ts` — replace the two bounds lines in `buildDiagramSvg`:
```ts
  const { schema, positions, notePositions } = useAppStore.getState();
  const bounds = computeExportBounds(schema, positions, notePositions);
```
with:
```ts
  const { schema, positions, notePositions, hiddenTableIds } = useAppStore.getState();
  // Hidden tables are not mounted, so the cloned scene is already free of
  // them — the bounds must agree or exports gain empty margins.
  const bounds = computeExportBounds(schema, positions, notePositions, hiddenTableIds);
```

- [ ] **Step 4: CSS**

Append to `src/styles.css`:

```css
/* Plan 6 Feature D: Diagram Views sidebar */
.views-tab {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%); z-index: 15;
  border: 1px solid var(--border); border-right: none; background: var(--bg-elev); color: var(--text);
  border-radius: 6px 0 0 6px; padding: 14px 4px; cursor: pointer; font-size: 13px;
}
.views-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 260px; z-index: 15;
  background: var(--bg-elev); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; font-size: 12px; color: var(--text);
}
.views-header {
  display: flex; align-items: center; justify-content: space-between;
  font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.views-collapse { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 14px; }
.views-search {
  margin: 10px 12px 0; padding: 6px 8px; font-size: 12px;
  border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text);
}
.views-groupby { color: var(--text-dim); padding: 8px 12px; border-bottom: 1px solid var(--border); }
.views-tree { flex: 1; overflow-y: auto; padding: 4px 0; }
.views-schema {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-weight: 600;
}
.views-schema-name { flex: 1; }
.views-count { color: var(--text-dim); font-weight: 400; }
.views-table-row { display: flex; align-items: center; gap: 8px; padding: 3px 12px 3px 22px; }
.views-table-row:hover { background: var(--selection-bg); }
.views-name {
  flex: 1; text-align: left; border: none; background: none; color: var(--text);
  cursor: pointer; padding: 3px 0; font-size: 12px;
}
.views-eye { border: none; background: none; color: var(--text); cursor: pointer; padding: 2px; display: flex; }
.views-footer { border-top: 1px solid var(--border); padding: 8px 12px; }
.views-all {
  width: 100%; font-size: 12px; padding: 5px 0; border: 1px solid var(--border);
  background: var(--bg-elev); color: var(--text); border-radius: 4px; cursor: pointer;
}
```

- [ ] **Step 5: Typecheck + unit regression**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: clean / green.

- [ ] **Step 6: Browser verification (incl. the group-shrink behavior this task documents)**

1. Chevron at mid-right → panel expands: "Diagram Views", search, "Group by: Schema", `public 3/3`, three table rows.
2. Eye on `comments` → table AND its two edges disappear; minimap loses its rect; count reads `2/3`; "fit" now frames only the two visible tables; marquee over the old spot selects nothing; drag `posts` near `comments`' position → no alignment guide to the hidden table. Marquee-select all three tables FIRST, then hide `comments` → the selection drops it (hiding deselects), and a subsequent multi-drag moves only the visible two.
3. Schema eye → all hidden (`0/3`, canvas empty but NOT the stale badge — this is view state, not a parse); schema eye again → all back. "All" restores from any state.
4. Search `po` lists only `posts` (counts still `x/3`).
5. Click a table NAME → viewport centers on it at the current zoom and its focus outline flashes ~1.5 s.
6. Add `TableGroup g1 { users posts }` to the DBML: hide `posts` → the group rect shrinks around `users`; hide both → the group disappears entirely (computeGroupRect null — the documented behavior). Unhide → it returns. Drag the group header while `posts` is hidden, then unhide: `posts` moved WITH the group (stored positions travel).
7. Sticky notes unaffected throughout. Export SVG with a table hidden → the file contains neither the table nor its edges, and the bounds hug the visible content.
8. ELK auto-layout with `comments` hidden → only visible tables move; unhide → `comments` is where it was.
9. Reload → hidden state restored (autosave threading from Task 2).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: diagram views sidebar — per-table/schema visibility, centerOnTable handle, hidden-aware canvas"
```

---

### Task 11: Feature E — bottom-left control cluster (shortcuts popover, snap toggle, Detail dropdown)

**Files:**
- Create: `src/canvas/CanvasControls.tsx`
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/styles.css`

**Interfaces:**
- `CanvasControls()` — a `.canvas-controls` bar bottom-left of `.canvas-wrap` (mirroring `.zoom-controls` bottom-right): (1) a `?` button (`aria-label="Keyboard shortcuts"`) toggling a static popover listing the app's REAL shortcuts; (2) a grid-icon snap toggle (`aria-pressed`) writing `setSnapEnabled`; (3) a native `<select>` (ponytail: platform dropdown over a custom one) for `lodOverride` — Auto/Full/Headers/Boxes. All three are session state (Global Constraints choice). No PRO badges.
- Drag pipeline consumption: `handleLiveMove` branches on `useAppStore.getState().snapEnabled` — off → raw positions, no guides. One `getState()` field read per move tick, zero React involvement (perf contract note in Global Constraints).
- LOD consumption: `const lod = effectiveLod(viewport.zoom, lodOverride)` — computed where the tier already was, on committed renders only. Culling untouched (documented interplay: an override changes per-table DETAIL, never which tables are mounted).

- [ ] **Step 1: Component**

`src/canvas/CanvasControls.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import type { LodOverride } from './lod';

// The app's REAL shortcuts (see DiagramCanvas keyboard effect + the editor
// keymap) — a static list, updated by hand when a shortcut changes.
const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/Cmd + Z', 'Undo canvas move'],
  ['Shift + Ctrl/Cmd + Z (or Ctrl/Cmd + Y)', 'Redo canvas move'],
  ['Ctrl/Cmd + Shift + F', 'Format DBML'],
  ['Space + drag / middle-drag', 'Pan the canvas'],
  ['Double-click a table', 'Reveal it in the editor'],
  ['Escape', 'Clear selection'],
];

/** Bottom-left control cluster (Feature E). snapEnabled/lodOverride are
 *  SESSION state: not persisted, untouched by diagram switches (documented
 *  plan choice — workbench preferences, not document state). */
export function CanvasControls() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const snapEnabled = useAppStore((s) => s.snapEnabled);
  const setSnapEnabled = useAppStore((s) => s.setSnapEnabled);
  const lodOverride = useAppStore((s) => s.lodOverride);
  const setLodOverride = useAppStore((s) => s.setLodOverride);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShortcutsOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setShortcutsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [shortcutsOpen]);

  return (
    <div className="canvas-controls" ref={rootRef}>
      <button
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        onClick={() => setShortcutsOpen((v) => !v)}
      >
        ?
      </button>
      <button
        aria-pressed={snapEnabled}
        className={snapEnabled ? 'active' : ''}
        aria-label="Toggle snap"
        title={snapEnabled ? 'Snap to grid/guides: on' : 'Snap to grid/guides: off'}
        onClick={() => setSnapEnabled(!snapEnabled)}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M1 5.5h14M1 10.5h14M5.5 1v14M10.5 1v14" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
      <label className="lod-select">
        Detail
        <select value={lodOverride} onChange={(e) => setLodOverride(e.target.value as LodOverride)}>
          <option value="auto">Auto</option>
          <option value="full">Full</option>
          <option value="headers">Headers</option>
          <option value="boxes">Boxes</option>
        </select>
      </label>
      {shortcutsOpen && (
        <div className="shortcuts-pop">
          <div className="shortcuts-title">Keyboard shortcuts</div>
          <dl>
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="shortcuts-row">
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: DiagramCanvas wiring**

In `src/canvas/DiagramCanvas.tsx`:

1. Imports — extend the lod import and add the component:
```ts
import { effectiveLod } from './lod';
import { CanvasControls } from './CanvasControls';
```
2. Replace the LOD line:
```ts
  const lod = lodLevel(viewport.zoom);
```
with:
```ts
  const lodOverride = useAppStore((s) => s.lodOverride);
  // Override wins over zoom (Feature E); culling below stays zoom/viewport-
  // based — the override changes per-table DETAIL, never what is mounted.
  const lod = effectiveLod(viewport.zoom, lodOverride);
```
(and drop `lodLevel` from the `./lod` import if now unused).
3. In `handleLiveMove`, replace the snap block:
```ts
    const tolerance = SNAP_TOLERANCE / (zoomRef.current ?? 1);
    const { pos, guides } = snapPosition(raw, drag.size, drag.otherRects, tolerance);
```
with:
```ts
    const tolerance = SNAP_TOLERANCE / (zoomRef.current ?? 1);
    // Feature E snap toggle: one getState() field read per move tick — no
    // subscription, no React work on the imperative drag path.
    const { pos, guides } = useAppStore.getState().snapEnabled
      ? snapPosition(raw, drag.size, drag.otherRects, tolerance)
      : { pos: raw, guides: [] as GuideLine[] };
```
4. Render — after the `.zoom-controls` div, before `<DiagramViewsSidebar />`:
```tsx
      <CanvasControls />
```

- [ ] **Step 3: CSS**

Append to `src/styles.css`:

```css
/* Plan 6 Feature E: bottom-left control cluster */
.canvas-controls {
  position: absolute; left: 12px; bottom: 12px; display: flex; gap: 6px; align-items: center;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 8px; font-size: 12px; z-index: 10; color: var(--text);
}
.canvas-controls > button {
  border: none; background: none; cursor: pointer; padding: 3px 6px;
  color: var(--text); border-radius: 4px; display: flex; align-items: center;
}
.canvas-controls > button.active { background: var(--selection-bg); color: var(--accent); }
.lod-select { display: flex; align-items: center; gap: 4px; color: var(--text-dim); }
.lod-select select {
  font-size: 12px; padding: 2px 4px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg); color: var(--text);
}
.shortcuts-pop {
  position: absolute; left: 0; bottom: calc(100% + 8px); width: 300px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18); padding: 12px; font-size: 12px;
}
.shortcuts-title { font-weight: 600; margin-bottom: 8px; }
.shortcuts-pop dl { margin: 0; }
.shortcuts-row { display: flex; gap: 8px; padding: 3px 0; }
.shortcuts-row dt { font-family: ui-monospace, monospace; color: var(--text-dim); flex: 1; }
.shortcuts-row dd { margin: 0; }
```

- [ ] **Step 4: Verify (typecheck, unit regression, browser)**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: clean / green (snap.test.ts untouched — `snapPosition` itself is unchanged; the toggle sits in the caller).

Browser check:
1. Bottom-left bar renders; `?` opens the shortcuts popover (contents match reality — try each listed shortcut); Escape/outside click closes.
2. Snap toggle OFF → dragging a table follows the pointer exactly (no 16 px grid steps, no pink guides); ON → snap + guides return. Toggle state survives a diagram switch, resets on reload (session).
3. Detail: Full at 10% zoom → mounted tables show fields (culling still prunes off-screen ones — pan to verify pop-in unchanged); Boxes at 100% → colored boxes; Headers → title bars; Auto → zoom-driven again.
4. e2e regression for the drag path: `npx playwright test e2e/persistence.spec.ts` — Expected: 4 passed (snap default is ON, so the grid-snap spec still holds).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bottom-left control cluster — shortcuts popover, snap toggle, detail override"
```

---

### Task 12: E2E — `e2e/ux.spec.ts` (hover menu, dashboard flow, visibility persistence, header-color bridge)

**Files:**
- Create: `e2e/ux.spec.ts`

**Interfaces:**
- Consumes selectors introduced by Tasks 4/6/8/10: `.export-menu .menu-list`, `.dash-row`/`.dash-search`/`.dash-modified`/kebab `aria-label="Row actions"`, `.views-tab`/`.views-panel`/`.views-schema`/`.views-table-row`/eye `aria-label="Toggle visibility"`/"All", `.table-gear`/`.table-settings`/`.swatch[data-color]`, plus the existing `.table-node`/`.edge`/`.table-header`/`.cm-content` and `helpers.ts`.
- Deterministic by construction: auto-retrying `expect` absorbs the 100 ms hover delay, the 250 ms close grace, and the 300 ms parse debounce; the visibility test polls IndexedDB for the exact persisted `hiddenTableIds` before reloading (no sleeps anywhere).

- [ ] **Step 1: Write the spec**

`e2e/ux.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { STARTER_TABLE_COUNT } from './helpers';

test('export menu opens on hover and closes after the pointer leaves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await page.getByRole('button', { name: /export/ }).hover();
  // 100 ms open delay — the auto-retrying expect absorbs it.
  await expect(page.locator('.export-menu .menu-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SQL — Oracle' })).toBeVisible();

  // Leave the menu root entirely (the brand sits far left; page.hover jumps
  // the mouse, so no other hover menu opens in passing).
  await page.locator('.brand').hover();
  // 250 ms close grace — again absorbed by the retrying expect.
  await expect(page.locator('.export-menu .menu-list')).toBeHidden();
});

test('dashboard: create, search, rename, delete', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await page.getByRole('button', { name: /diagrams/ }).click();
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await expect(page.locator('.dash-row .dash-modified')).toContainText('Today at'); // relative dates live

  // Create: switches to the new diagram and closes the overlay.
  await page.getByRole('button', { name: 'New Diagram' }).click();
  await expect(page.locator('.dashboard')).toBeHidden();
  await page.getByRole('button', { name: /diagrams/ }).click();
  await expect(page.locator('.dash-row')).toHaveCount(2);

  // Rename the newest row (first — list is sorted by updatedAt desc).
  const first = page.locator('.dash-row').first();
  await first.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await first.locator('input').fill('Renamed via dashboard');
  await first.locator('input').press('Enter');
  await expect(page.locator('.dash-row').filter({ hasText: 'Renamed via dashboard' })).toHaveCount(1);

  // Search filters by name.
  await page.locator('.dash-search').fill('Renamed');
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await page.locator('.dash-search').fill('');
  await expect(page.locator('.dash-row')).toHaveCount(2);

  // Delete the OTHER (non-current) row, with the two-step confirm.
  const other = page.locator('.dash-row').filter({ hasText: 'Untitled' }).first();
  await other.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await other.getByRole('button', { name: 'confirm ✓' }).click();
  await expect(page.locator('.dash-row')).toHaveCount(1);
});

test('visibility: eye toggle hides table + edges, persists across reload, All restores', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(3);

  await page.locator('.views-tab').click();
  await expect(page.locator('.views-panel')).toBeVisible();
  await expect(page.locator('.views-schema')).toContainText('3/3');

  // Hide `comments` — two of the three starter refs touch it.
  await page
    .locator('.views-table-row')
    .filter({ hasText: 'comments' })
    .getByRole('button', { name: 'Toggle visibility' })
    .click();
  await expect(page.locator('.table-node')).toHaveCount(2);
  await expect(page.locator('.edge')).toHaveCount(1);
  await expect(page.locator('.views-schema')).toContainText('2/3');

  // Await the 1 s debounced autosave by polling IndexedDB for the exact
  // persisted value — deterministic, no sleeps.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const req = indexedDB.open('dbdraft');
              req.onsuccess = () => {
                const db = req.result;
                const all = db.transaction('diagrams').objectStore('diagrams').getAll();
                all.onsuccess = () => {
                  db.close();
                  const rows = all.result as Array<{ hiddenTableIds?: string[] }>;
                  resolve(JSON.stringify(rows[0]?.hiddenTableIds ?? []));
                };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(JSON.stringify(['public.comments']));

  await page.reload();
  await expect(page.locator('.table-node')).toHaveCount(2); // hidden state survived
  await expect(page.locator('.edge')).toHaveCount(1);

  await page.locator('.views-tab').click(); // sidebar collapse is session state — reopen
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(3);
});

test('table settings popover writes headerColor into the DBML and repaints the header', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(3);

  const users = page.locator('.table-node').filter({
    has: page.locator('.table-title', { hasText: 'users' }),
  });
  await users.hover(); // CSS :hover reveals the gear
  await users.locator('.table-gear').click();
  await expect(page.locator('.table-settings')).toBeVisible();

  await page.locator('.swatch[data-color="#e91e63"]').click();

  // The popover routed a TEXT edit through editorNav — the DBML changed…
  await expect(page.locator('.cm-content')).toContainText('Table users [headerColor: #e91e63]');
  // …and the parse pipeline repainted the header fill (~300 ms debounce,
  // absorbed by the retrying expect).
  await expect(users.locator('.table-header')).toHaveAttribute('fill', '#e91e63');
});
```

- [ ] **Step 2: Run to verify**

```bash
npx playwright test e2e/ux.spec.ts
```
Expected: 4 passed. Then the full suite:

```bash
npm run test:e2e
```
Expected: **13 passed** (2 editing + 2 interop + 4 persistence + 1 perf + 4 ux).

- [ ] **Step 3: Commit**

```bash
git add e2e/ux.spec.ts && git commit -m "feat: ux e2e — hover menu, dashboard flow, visibility persistence, header-color bridge"
```

---

### Task 13: Integration pass — full verification, audits, CLAUDE.md bridge clarification, ledger, walkthrough; tag SKIPPED

**Files:**
- Modify: `CLAUDE.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1: Full verification**

```bash
npx vitest run        # Expected: all pass, ≈288 tests (237 baseline + 51 new: T1 8, T2 9, T3 2, T5 15, T7 8, T9 9)
npx tsc --noEmit      # Expected: clean
npm run test:e2e      # Expected: 13 passed
npm run check:bundle  # Expected: OK, ≤ 215,040 gzip bytes (baseline 206,739 + small UI additions), no lazy-lib markers
```
If `check:bundle` trips, trim CSS/markup duplication — never raise the budget.

- [ ] **Step 2: Constraint audits**

```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output (visibility.ts stayed pure; elkGraph/exportBounds changes added no cross-layer imports — note `exportBounds.ts` lives in `src/app/`, its imports FROM core are fine).

```bash
grep -rn "from '@dbml/core'" src/ | grep -v "src/core/parse/parseDbml.ts" || true
```
Expected: no output (Oracle rides the lazy convert facade).

```bash
grep -rn "setState\|set({" src/canvas/TableSettingsPopover.tsx | grep -v "useState" || true
```
Expected: no output (the popover never writes store state — the text-bridge rule holds mechanically).

```bash
grep -rn "from 'vitest'\|from \"vitest\"" e2e/ || true
```
Expected: no output.

- [ ] **Step 3: Update CLAUDE.md (exact edits)**

1. In the **Project** section, replace the sentence
   > Milestones are tagged `plan-N-complete`. All five milestones are complete.

   with:
   > Milestones are tagged `plan-N-complete`. All six milestones are complete (Plan 6: UX parity — hover menus, table settings popover, project dashboard, diagram-views visibility, canvas controls, Oracle dialect).

2. In **Architecture invariants**, insert a new invariant paragraph directly AFTER the **Text vs layout** paragraph:
   > **Canvas→text bridge:** canvas-origin UI may request TEXT edits only through `editorNav` (one CodeMirror transaction per user action; editor history owns undo; the parse pipeline re-renders the result). `applyTableSettings` (table rename / headerColor, `src/editor/tableSettings.ts` is the pure rewriter) is the first user, alongside `applyFormat`/`revealTable`. Renaming does not rewrite refs — dangling refs surface as ordinary parse errors. Drag, viewport, selection, and visibility (`hiddenTableIds`) stay layout-only and never touch DBML.

3. In the **Text vs layout** paragraph, replace
   > canvas interactions (drag, viewport, selection) write only layout state (`commitCanvasCommand`, `setViewport`, selection) — never DBML text.

   with:
   > canvas interactions (drag, viewport, selection, visibility) write only layout state (`commitCanvasCommand`, `setViewport`, selection, `setHiddenTables`) — never DBML text. `hiddenTableIds` is view state: persisted per diagram (optional field, like `notePositions`), pruned on parse like selection, filtered at render time (never on the imperative pan/drag paths).

- [ ] **Step 4: Ledger entry**

Append to `.superpowers/sdd/progress.md`:

```
# Plan 6 lane (feature/plan-6-ux)
P6 complete: hover menus via shared useHoverMenu (hover/click race guard: fresh hover-open ignores an immediate trigger-click) + menu restyle (T4); oracle dialect both directions, verified on installed 8.3.1 (T3); table settings popover — rename/headerColor as TEXT edits via editorNav.applyTableSettings, pure rewriter tableSettings.ts w/ real-parser round-trip tests incl. ]-inside-quoted-setting adversarial case (T5-T6); project dashboard w/ createdAt (optional, backward compat) + renameDiagramById/duplicateDiagramById, duplicateDiagram() DELETED (dead once the toolbar button went — dashboard owns duplication) (T7-T8); diagram views sidebar w/ hiddenTableIds threaded through store/repo/snapshots/project files like notePositions (setHiddenTables prunes selection — hiding deselects; group drags the intentional membership-based exception), hidden-aware render/edges/minimap/fit/marquee/export-bounds/ELK, canvasNav centerOnTable handle (T1-T2, T9-T10); bottom-left cluster snapEnabled/lodOverride session flags (T11); 4 ux e2e specs, 13 total (T12). Known ceilings: dashboard kebab has no dedicated outside-click closer; settings popover holds still during imperative pan until gesture-end commit; header rewriter refuses genuinely-unrecognized header shapes (comment mid-header) with a popover error rather than editing.
```

- [ ] **Step 5: Browser walkthrough (dev server)**

1. Regression sweep: type→render, break→stale badge, autocomplete, format, problems-panel jump, undo in both panes.
2. Feature A: hover open/close both menus, grouped export list, oracle items, dark theme.
3. Feature B: gear→popover, swatch, custom hex, clear, rename (refs error as documented, editor undo reverts), popover lifecycle (Escape/outside/switch/parse-delete).
4. Feature C: dashboard full flow incl. "—" for a pre-plan record (create one by briefly checking out `main` in another profile, or trust the unit test), delete-current fallback, relative dates.
5. Feature D: per-table + per-schema hide, search, center-on-table flash, All, group shrink/disappear, export/fit/minimap/marquee/ELK/reload behavior.
6. Feature E: shortcuts popover accuracy, snap off/on drag feel, all four detail levels + culling interplay at low zoom.
7. Storage-unavailable (private window): banner + dashboard/sidebar still function in-memory.

- [ ] **Step 6: Final commit; tag SKIPPED**

```bash
git add -A && git commit -m "chore: plan 6 complete — ux parity" --allow-empty
```

Tag step deliberately SKIPPED — the controller tags `plan-6-complete` after merge review.

---

## Self-review checklist (done at authoring time)

- **Scope map:** Feature A (hover-open w/ 100/250 ms timings, click-toggle + Escape + outside-click retained, one shared `useHoverMenu`, roomier grouped menus, no icon lib) → Tasks 4 (+3 for the Oracle group item); the third trigger (Diagrams) documented as click-open under Feature C's explicit "your call" — `useHoverMenu` still the only dropdown implementation. Feature B (gear on hover, ONE popover host in the HTML layer, stable `onOpenSettings`, 18 swatches, hex validation, TEXT-edit-only via `applyTableSettings`, one transaction, all header shapes, rename-doesn't-rewrite-refs documented, pure helpers + real-parser round-trips, `parseDbml` headerColor emission verified and cited) → Tasks 5–6. Feature C (dashboard overlay, left rail New Diagram + My Diagrams, search, Name/Modified/Created, row-click open, kebab Open/Rename/Duplicate/Delete-confirm, X/Escape/backdrop close, optional backward-compatible `createdAt` set on create/duplicate/import, relative-date helper with unit tests, no account/PRO chrome) → Tasks 1, 2, 7, 8. Feature D (chevron-collapsed sidebar, search, fixed "Group by: Schema", visibleCount/total + schema eye, per-table eye, name-click centers via registered `centerOnTable` handle + focus flash, All button, `hiddenTableIds` store state pruned on parse/loaded via loadDiagram/persisted optionally/threaded through snapshots + project files with string-array validation, excluded from TableNode/EdgeLayer/MiniMap/fit/export-bounds/marquee, ELK visible-only with hidden keeping positions, group shrink/disappear verified+documented, notes unaffected) → Tasks 1, 2, 9, 10. Feature E (shortcuts popover with the app's real shortcuts, snap toggle consumed at `snapPosition` call site, Detail dropdown via `effectiveLod` with culling interplay documented, session-only documented) → Tasks 1, 11. Oracle-only-if-supported → verified supported both ways, cited in Verified facts, Task 3.
- **Required e2e:** dashboard create/search/rename/delete; visibility eye-toggle hides table+edge, persists across reload (IDB-polled, no sleeps), All restores; header-color popover asserts BOTH the DBML text (`Table users [headerColor: #e91e63]`) and the rendered `fill` change; plus a hover-menu smoke. All bounded-poll/auto-retry, following `helpers.ts`/`persistence.spec.ts` idioms. Existing spec collisions found and fixed in-plan: `interop.spec.ts` `.diagram-list li` → `.dash-row` (Task 8) and oracle loop extensions (Task 3); trigger labels deliberately unchanged so `/export|history|diagrams/` locators keep matching.
- **Text-bridge rule** stated in Global Constraints AND added to CLAUDE.md (Task 13 exact edits), with a mechanical audit (`grep` over the popover for store writes) in the integration pass.
- **Perf contract:** gear passes id through a stable prop; popover/sidebar/controls live in `.canvas-wrap` HTML; visibility filters run in render maps/memos from committed state (locations named in Task 10); snap toggle is one `getState()` read per tick; culling untouched.
- **Backward compat tested:** store defaults for old records (T1), old snapshot restore clears hidden (T2), project files without the new key (T2), serializer omits empty (T2), dashboard renders "—" for missing createdAt (T8 walkthrough + code path), no DB version bump.
- **Placeholder scan:** every step carries complete code or exact byte-level edit instructions anchored to quoted current lines; no TODO/"similar to"/elided bodies. Known ceilings are called out as accepted behavior, not gaps.
- **Cross-task signature consistency:** `LodOverride`/`effectiveLod` (T1→T11), `PersistedDiagram.createdAt/hiddenTableIds` (T1→T2→T7/T8/T10), `serializeProject`'s `hiddenTableIds` param (T2→T4's ExportMenu replacement includes it), `SqlDialect` + oracle (T3→T4 menu), `rewriteTableHeader`/`TableHeaderEdit`/`HEX_COLOR_RE` (T5→T6), `renameDiagramById`/`duplicateDiagramById` (T7→T8), `omitHidden`/`visibleTableRects` (T9→T10 canvas + exportBounds), `computeExportBounds(...,hiddenTableIds=[])` and `runElkLayout(schema, hiddenTableIds=[])` defaults keep all existing callers/tests green, `registerCanvasHandle`/`centerOnTable` (T10 both sides), `onOpenSettings` prop (T6 TableNode replacement ↔ DiagramCanvas wiring). Task-4's ExportMenu full replacement already contains Task 2's `hiddenTableIds` serialize line and Task 3's oracle dialect — the file is edited in ascending task order and each later replacement includes the earlier edits.
- **No new deps / bundle:** zero package.json changes; budget checked in T13 with the trim-don't-raise rule; heavy libs untouched (oracle rides the existing lazy chunk).
- **Single lane:** tasks ordered by dependency (types → threading → dialect → menus → pure rewriter → popover → dashboard core → dashboard UI → pure visibility → canvas wiring → controls → e2e → integration); no two tasks are marked parallel-safe.

