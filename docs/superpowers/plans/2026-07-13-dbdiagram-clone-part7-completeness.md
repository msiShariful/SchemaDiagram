# dbdiagram Clone — Plan 7: Completeness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship every remaining locally-feasible dbdiagram.io feature. (A) **Ref authoring from the canvas** — the flagship: a hover handle on each field row starts a REF-DRAG gesture (imperative temp line, zero React per tick); dropping on another table's field row appends a standalone `Ref: src > dst` line through the canvas→text bridge, and clicking an edge opens a popover that rewrites the ref's cardinality operator or deletes its line — all TEXT edits located by a new pure scanner `findRefLine`, with an honest refusal path for inline-defined refs (a new normalizer flag `Ref.inline`, empirically required — the parsed ref object carries no such flag). (B) **Rendering parity**: NN/U/++ badges, note dots, default/enum tooltips via free SVG `<title>` elements (normalizer additively exposes `Field.enumValues`). (C) **Highlight/trace mode**: a CanvasControls toggle; clicking a table dims everything outside its 1-hop neighborhood (render-time memo, CSS opacity). (D) **Canvas quick-search**: Cmd/Ctrl+K palette (verified unbound in CodeMirror) + the magnifier button — Enter unhides, centers, and flashes. (E) **Group collapse**: chevron on group headers, collapsed groups render a compact pill; `collapsedGroupIds` persists exactly like `hiddenTableIds`, and the effective hidden set is derived (never mutated) at the existing memoized filter spots. (F) **Polish-backlog retirement**: a shared Escape overlay-stack replacing six ad-hoc listeners, toolbar undo/redo buttons driven by a `canvasStackVersion` counter that rides existing `set()` calls, kebab outside-click dismissal, the <800 px shortcuts-popover clip fix, perf-spec cold-start warmup, swatch-click history annotations, and a rich "New Sample Diagram" (parse-verified e-commerce DBML: 8 tables, 3 enums, 3 groups, a sticky note, header colors, composite + inline + named refs). (G) **Export completeness**: print-to-PDF via a popup window (no deps), and the Snowflake dialect for IMPORT ONLY — `exporter.export(…, 'snowflake')` returns an empty string in the installed 8.3.1 (same exclusion as sqlite), verified below.

**Controller-approved budget decision (Task 1, deliberate):** the entry chunk sits at **211,396 / 215,040 gzip bytes (~3.6 KiB headroom)** and this plan adds real UI. The bundle budget is raised **210 KiB → 230 KiB** in `scripts/check-bundle.mjs` + CLAUDE.md as an explicit, documented decision: the gate exists to catch accidental heavyweight imports — the `@dbml/core`/`elkjs` leak markers stay unchanged and still fail the build on a leak — not to cap deliberate feature growth across seven plans. Additions stay lean regardless: no icon libraries, inline SVG only, no new dependencies.

**Architecture:** Pure logic stays pure and unit-tested in vitest's node env: `blankNoise` moves to `src/core/parse/blankNoise.ts` (sourceMap re-exports it — one implementation) so the normalizer can classify inline refs; `src/editor/refEdit.ts` holds `findRefLine`/`buildRefLine`/`refOperator` with real-parser round-trip tests; `src/canvas/refDrag.ts` holds the geometric drop hit-test; `src/canvas/fieldMeta.ts` the badge/tooltip label helpers; `src/core/model/visibility.ts` gains `effectiveHiddenIds`; `src/app/overlayStack.ts` is a ~40-line module with one window listener. All DBML mutations go through `editorNav` (the bridge's second consumer: `appendRefLine`/`applyRefOperator`/`deleteRefLine` beside `applyTableSettings`) — one CodeMirror transaction per user action, editor history owns undo. Canvas gesture code follows the gesture-ledger rules already written down in `DiagramCanvas.tsx`: REF-DRAG is pointerId-owned, capture lives on the stable `<svg>`, the temp line is a persistent `<line>` updated via `setAttribute`, and the `[positions]` cleanup effect covers mid-gesture parses. Highlight/dim and collapse filtering are render-time memos off committed state; the imperative pan/drag paths never see them. New HTML UI (edge popover, quick-search palette) renders in `.canvas-wrap`'s HTML layer, following the `TableSettingsPopover` host pattern. React wiring is browser-verified per repo convention; 7 new Playwright specs pin the golden flows (13 existing + 7 = 20 total), with **e2e execution deferred to the integration task** (the user's dev server owns port 5173 — the controller handles the conflict there).

**Tech Stack:** Existing Plans 1–6 stack. **No new dependencies, runtime or dev.** Icons are inline SVG paths / unicode glyphs only.

**Explicitly OUT OF SCOPE:** share/embed links, dbdocs, accounts, tokens, realtime collaboration (all backend-dependent); edge-redirect-to-pill for collapsed groups — edges to collapsed members are **hidden**, consistent with the app's visibility semantics (accepted divergence from dbdiagram, documented in Task 11).

## Verified environment facts (checked empirically on 2026-07-13 against the working tree and the INSTALLED packages — do not trust memory)

- HEAD is `3688b59` on `main`, clean tree. **289/289** vitest unit tests pass (run today, 41 files). 13 Playwright e2e per the P6 ledger (2 editing + 2 interop + 4 persistence + 1 perf + 4 ux); not re-run during authoring — the user's dev server owns 5173. Last bundle gate: **211,396 / 215,040** gzip bytes (ledger "211.4kB gz", commit 3688b59) — ~3.6 KiB headroom, hence the Task 1 budget decision.
- **Snowflake in the installed `@dbml/core` 8.3.1** (run via `node --input-type=module`, importing the real package):
  - `importer.import('CREATE TABLE refunds (id NUMBER PRIMARY KEY, amount NUMBER(10,2) NOT NULL);', 'snowflake')` → works: `Table "refunds" {\n  "id" NUMBER [pk]\n  "amount" NUMBER(10,2) [not null]\n}\n`, and that output **re-parses cleanly with `new Parser().parse(text, 'dbmlv2')`** (our pipeline's format).
  - `exporter.export(dbml, 'snowflake')` → returns an **empty string** (`export snowflake OK: ""` for DBML that exports fine to postgres/oracle) — exactly the sqlite situation Plan 6 documented. **Snowflake ships IMPORT-ONLY** (Feature G); the export menu does not gain it.
- **Inline vs standalone refs in the parsed object model** (8.3.1, `'dbmlv2'`): a parsed ref's own keys are `token,name,color,onDelete,onUpdate,inactive,endpoints,injectedPartial,id` plus the back-references `schema`/`dbState` (filtered from the probe output) — **there is NO inline flag**, so the normalizer must add one (Task 2). What DOES distinguish them: `ref.token.start` carries `{offset, line, column}` (absolute char offset verified present), and:
  - inline `Table b { a_id int [pk, ref: > a.id] }` → token starts at the `ref:` inside the bracket (`offset 43, col 25`); the previous non-whitespace char is `,` (or `[` for a first setting).
  - standalone `  Ref: a.x <> b.p` (indented) → `col 3`; block form `Ref {\n a.x > b.p \n}` → `col 1`; the previous non-whitespace char is a `}`/`]`/nothing — never `[` or `,` **on comment/string-blanked text** (a `// comment,` line could otherwise fake it — the classifier runs on `blankNoise`d source).
  - **Duplicate endpoint pairs are a parse error** ("References with same endpoints exist"), verified in BOTH orders and for inline+standalone mixes → an endpoint-pair match in `findRefLine` is unambiguous, and Feature A must refuse drops that duplicate an existing ref (the append would otherwise just produce a stale-badge parse error).
  - Operators → relations: `>` = `*/1`, `<` = `1/*`, `-` = `1/1` , `<>` = `*/*` (all verified). Standalone lines keep their written endpoint order in `endpoints[]`; inline refs do NOT (the probe showed `[a.id '1', b.id '*']` for `b.a_id [ref: > a.id]` — the defining table came SECOND), so nothing may assume normalized order identifies the defining table — `Ref.pos` (token line/column) is what the popover's Reveal uses.
  - Composite `Ref: a.(x, y) > b.(p, q)`, `public.`-qualified endpoints (`Ref: public.a.x > public.b.p`), quoted table names (`Ref: "order items".x > b.p`) and quoted field names (`Ref: a."my field" > b.p`) ALL parse successfully.
- **Cmd/Ctrl+K is free** (checked in `node_modules/@codemirror/commands/dist/index.js`): `defaultKeymap` binds `Shift-Mod-k` (deleteLine) and `emacsStyleKeymap` — active only as macOS bindings inside `standardKeymap` — binds `Ctrl-k` (deleteToLineEnd, i.e. NOT Cmd-k). **Plain `Mod-k` appears in no keymap array.** `DbmlEditor` installs `basicSetup` (which includes `defaultKeymap`) plus one custom `Mod-Shift-f` binding. A global window listener for Cmd/Ctrl+K therefore shadows nothing, even while the editor is focused — dbdiagram-style global it is (Task 10).
- **The Feature F sample DBML parses today**: the exact `SAMPLE_DBML` in Task 12 was run through `new Parser().parse(src, 'dbmlv2')` → `PARSE OK. tables: 8 refs: 8 enums: 3 groups: 3 db.notes: 1`, all 8 headerColors emitted, and the composite ref normalizes to `shipments.(order_region, order_ordinal) → orders.(region, ordinal)` with relations `*/1`.
- **Name collisions:** `grep -rn "traceEnabled\|highlightTableId\|collapsedGroupIds\|canvasStackVersion\|refEdit\|overlayStack\|QuickSearch\|ref-handle\|edge-hit\|SAMPLE_DBML\|snowflake" src/ e2e/` returns **nothing** — every new name is unclaimed.
- **Hand-built fixtures Task 2's required fields break at `tsc`** (vitest alone won't catch them — esbuild strips types): TWO `Ref` construction sites (`src/core/layout/edges.test.ts:27` and the `mkRef`-style helper at `src/core/layout/placement.test.ts:15` → both gain `inline: false, pos: null`) and FIVE `Field` builder literals ending `…note: null, isEnum: false,` (`src/core/layout/groups.test.ts:9`, `src/core/layout/placement.test.ts:10`, `src/core/model/geometry.test.ts:10`, `src/core/model/reconcile.test.ts:9`, `src/app/export/exportBounds.test.ts:10` → each appends `enumValues: null,`). Every other fixture goes through `parseDbml` or uses `refs: []`.
- **Alias + wrapped ref forms** (checked for `findRefLine`): the parser RESOLVES aliases — `Table users as U { … }` + `Ref: posts.user_id > U.id` parses and the endpoints carry the REAL name (`{"t":"users","f":["id"]}`), so `findRefLine` must resolve aliases from the text side (via `buildTableRanges`' existing `alias` field) to locate alias-written lines. A ref WRAPPED across lines (`Ref: a.x >\n  b.p`) parses fine (refs: 1) but is refused by the line-anchored scanner — a documented, tested refusal (the popover shows the can't-locate error).
- **Escape listener inventory** (Feature F migrates all six to the overlay stack): `useHoverMenu.ts:56` (shared by ExportMenu + HistoryPanel), `ImportDialog.tsx:28` (gated on `!busy`), `DiagramDashboard.tsx:34`, `TableSettingsPopover.tsx:41`, `CanvasControls.tsx:30` (shortcuts popover), plus `DiagramCanvas.tsx:296`'s clear-selection — which stays a SEPARATE listener acting only when the stack is empty (last resort). The dashboard's rename-input Escape already `stopPropagation()`s and keeps working unchanged.
- **tsconfig `target: ES2022`** → the `d` regex flag and `RegExpExecArray.indices` are natively typed (`findRefLine` uses them for the operator span).
- **Current selectors/structure this plan builds on:** field rows are anonymous `<g key={f.name}>` inside `TableNode` (they gain `className="field-row"` + a transparent hit rect); edges are `g.edge > path` with a `pathRefs` map updated imperatively by `EdgeLayer.updateTablePositions` (the hit-path gains a parallel `hitRefs` map); the scene `<g>` already hosts persistent imperative elements (2 guide lines + marquee rect — the ref-drag temp line joins them); `CanvasControls` sits bottom-left, `.zoom-controls` bottom-right, `DiagramViewsSidebar` right edge; `getCanvasStack()` already exposes `canUndo()/canRedo()` (`src/core/layout/commands.ts:39-46`); `commitCanvasCommand`/`undoCanvas`/`redoCanvas` each already contain exactly one `set()` call for the version counter to ride; `.shortcuts-pop` is `width: 300px` at `src/styles.css:357` (the <800 px clip); `importDiagram` (usePersistence) is the create-with-content path the sample button reuses; `perf.spec.ts` marks `perf:edit` immediately after one cold `page.goto('/')` — the warmup inserts a reload before timing.
- **Group identity** is `${schemaName}.${name}` (`parseDbml.ts` groups loop) — `collapsedGroupIds` entries use it, and `applyParse` prunes against `schema.groups` exactly like selection prunes against tables.

## Global Constraints

- TypeScript `strict: true`; no new `any` (the `@dbml/core` normalizer boundary in `parseDbml.ts` remains the only exception).
- **Core purity (CLAUDE.md, verbatim):** `src/core/` must never import React, zustand, or anything from `src/app|editor|canvas`. New/moved core files (`blankNoise.ts`, `visibility.ts` additions) import only core. Audit stays: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` returns nothing. (`blankNoise` moves core-ward — editor importing core is fine; core importing editor never is.)
- **Canvas→text bridge (CLAUDE.md, verbatim + this plan's extension):** canvas-origin UI may request TEXT edits only through `editorNav` (one CodeMirror transaction per user action; editor history owns undo; the parse pipeline re-renders the result). **Feature A is the bridge's second consumer**: `appendRefLine`, `applyRefOperator`, `deleteRefLine` join `applyTableSettings`/`applyFormat`/`revealTable`. Every mutation is ONE transaction; refusal paths surface honestly (inline ref → "Defined inline" + Reveal, unlocatable line → error text, unrepresentable name → silent drop-cancel — never a mangled edit). The edge popover and ref-drag NEVER write `schema`, `positions`, or any store state to change a ref. Drag, viewport, selection, visibility (`hiddenTableIds`) and **collapse (`collapsedGroupIds`) stay layout-only** and never touch DBML.
- **Last good parse (CLAUDE.md):** untouched. `applyParse` on failure still sets only `errors`/`stale`; the failure branch must not touch `highlightTableId`, `collapsedGroupIds`, or `canvasStackVersion` either. A drop that appends a ref the parser rejects (e.g. a race with concurrent typing) degrades to the ordinary stale badge + problems panel — the canvas keeps rendering.
- **Canvas performance contract (CLAUDE.md):** pan/zoom/drag bypass React. REF-DRAG is fully imperative: pointerId-owned per the gesture-ledger rules, temp line via `setAttribute` on a persistent `<line>`, capture on the stable `<svg>`, hit-test math only at drop time. Highlight/dim is a render-time memo keyed `[schema.refs, highlightTableId, traceEnabled]`; the dim class is applied where tables/edges already render. `effectiveHiddenIds` is computed in the existing memos (committed renders) and once per gesture START on the getState() sites — never per tick. `canvasStackVersion` bumps ride the EXISTING `set()` calls in `commitCanvasCommand`/`undoCanvas`/`redoCanvas`/`loadDiagram` (+ restoreSnapshot's same-text patch): zero new hot-path writes; the undo/redo buttons re-render at gesture end only. `TableNode`'s two new props (`onRefDragStart`, `dimmed`) are a stable callback and a boolean — the memo contract holds.
- **Persistence safety (CLAUDE.md):** unchanged. `collapsedGroupIds` threads exactly like `hiddenTableIds` (currentRecord, autosave tuple, snapshot payload + `?? []`-normalized dedupe compare, restore incl. same-text patch, import, project file with array-of-strings trust-boundary validation, omit-when-empty serialization). Backward compatible: optional on `PersistedDiagram`/`DiagramSnapshot`/`ProjectFile`, pre-Plan-7 records load with `[]`, no DB version bump, both directions unit-tested.
- **@dbml/core pin (CLAUDE.md):** stay on `^8.3.x` / `'dbmlv2'`. The only static `from '@dbml/core'` import remains `src/core/parse/parseDbml.ts`; snowflake rides the existing lazy `convert.ts` facade and is **import-only** (verified — export emits an empty string).
- **Adapt-the-normalizer rule:** `Ref.inline`, `Ref.pos`, `Field.enumValues` are additive normalizer outputs with real-parser tests; our `Schema` stays the contract.
- **Session-only state (documented choice):** `traceEnabled` and `highlightTableId` are session state (like `snapEnabled`/`lodOverride`): not persisted, `highlightTableId` cleared by `loadDiagram` (it names a table of the OLD diagram) and pruned by `applyParse`. `collapsedGroupIds` IS persisted (document state, like `hiddenTableIds`).
- **Tests:** vitest node env, no DOM. Unit-tested this plan: `findRefLine`/`buildRefLine`/`refOperator` (real-parser round-trips for every case: named, settings-suffixed, flipped, quoted, composite, indented, inline-refused, block-refused), inline/pos/enumValues normalization, `fieldDropTarget`/`isDuplicateRef`, badge/tooltip helpers, `effectiveHiddenIds`, overlay-stack ordering, store additions (prunes, version bumps, collapse-deselects), persistence/project-file threading + backward compat, `SAMPLE_DBML` parses, snowflake import via the real facade. React wiring browser-verified per convention; editorNav's dispatch wrappers are thin shims over the fully-tested pure locators (an `EditorView` needs a DOM — same convention as `applyTableSettings`).
- **E2E:** 7 new specs in `e2e/completeness.spec.ts` (ref-create drag, edge-popover edit/delete, inline refusal, highlight mode, quick-search, collapse + reload persistence, PDF-menu presence + sample diagram — 13 existing + 7 = 20 total) plus a snowflake entry in `interop.spec.ts`'s import loop. Deterministic only: auto-retrying `expect`, `expect.poll` on IndexedDB, `dispatchEvent` for the edge hit-path (an L-shaped path's bbox center misses the stroke), zero sleeps. **E2E execution is deferred to Task 15** — the user's dev server owns port 5173 and `reuseExistingServer` would test the wrong build; the controller stops/restarts it there (P6 operational note precedent).
- **Bundle budget:** raised to **230 KiB** in Task 1 (controller-approved, see header). `npm run check:bundle` runs in Task 15; leak markers (`org.eclipse.elk`, `dbmlv2`) unchanged. Expected landing ~216–221 KiB.
- **No new dependencies.** PDF export = `window.open` + `window.print()`; icons inline SVG/unicode.
- Working dir `/Users/sharif/Documents/dbdiagram`, branch **`feature/plan-7-complete`** (created from `main` in Task 1). **Single lane — no parallel task execution** (the tasks share `store.ts`, `DiagramCanvas.tsx`, `TableNode.tsx`, `EdgeLayer.tsx`, `CanvasControls.tsx`, `usePersistence.ts`, `styles.css`).
- Commands exactly as in CLAUDE.md: `npm test`, `npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`, `npm run test:e2e`, `npm run check:bundle`.
- **Tag step SKIPPED** — the controller tags `plan-7-complete` at merge.

---

### Task 1: Branch + the deliberate budget decision (210 → 230 KiB)

**Files:**
- Modify: `scripts/check-bundle.mjs`, `CLAUDE.md`

**Why first:** the entry chunk has ~3.6 KiB headroom and Tasks 4–13 add real UI; without this, every mid-plan `check:bundle` run would fail and invite ad-hoc budget hacks. This is a controller-approved decision, not a workaround: the gate's real job — naming an accidental `@dbml/core` (~2.7 MB) or `elk.bundled` (~1.4 MB) static import via marker strings — is untouched.

- [ ] **Step 1: Branch**

```bash
cd /Users/sharif/Documents/dbdiagram && git checkout -b feature/plan-7-complete
```

- [ ] **Step 2: Raise the budget in `scripts/check-bundle.mjs`**

Replace the header comment block (lines 2–10) with:

```js
// Bundle budget guard (Plan 5; budget raised in Plan 7). Fails the build when
// the main chunk exceeds the gzip budget or when a lazy-only library's marker
// strings leak into it.
//
// Budget rationale: Plan 7 raised the ceiling 210 → 230 KiB (controller-
// approved): six → seven feature plans of deliberate UI growth had the entry
// chunk at 211,396 bytes with ~3.6 KiB headroom. The gate exists to catch
// ACCIDENTAL heavyweight imports — a static @dbml/core (~2.7 MB chunk) or
// elk.bundled (~1.4 MB) overshoots any sane budget by an order of magnitude,
// and the marker check below names the culprit even when minification shifts
// sizes — not to cap deliberate feature growth.
```

and replace:

```js
const BUDGET_BYTES = raw === undefined ? 210 * 1024 : Number(raw);
```

with:

```js
const BUDGET_BYTES = raw === undefined ? 230 * 1024 : Number(raw);
```

- [ ] **Step 3: CLAUDE.md — record the same decision**

In the **Data flow** invariant paragraph, replace:

> main chunk is ~206 kB gzip (budget 210 KiB, enforced by `npm run check:bundle`)

with:

> main chunk is ~211 kB gzip (budget 230 KiB, enforced by `npm run check:bundle` — raised 210→230 in Plan 7 as a deliberate decision: the gate catches accidental heavyweight imports via the unchanged @dbml/core/elkjs leak markers, it does not cap deliberate feature growth)

- [ ] **Step 4: Verify + commit**

```bash
node -e "const s=require('fs').readFileSync('scripts/check-bundle.mjs','utf8'); if(!s.includes('230 * 1024')) process.exit(1)" \
  && git add scripts/check-bundle.mjs CLAUDE.md \
  && git commit -m "chore: raise bundle budget 210->230 KiB for plan 7 (controller-approved; leak markers unchanged)"
```

(No build here — `check:bundle` runs against the finished branch in Task 15.)

---

### Task 2: Normalizer — `Ref.inline` + `Ref.pos`, `Field.enumValues`; `blankNoise` moves to core

**Files:**
- Create: `src/core/parse/blankNoise.ts`
- Modify: `src/core/model/types.ts`, `src/core/parse/parseDbml.ts`, `src/editor/sourceMap.ts`, plus SEVEN fixture touch-ups (`src/core/layout/edges.test.ts`, `src/core/layout/placement.test.ts` — Ref + Field builders; `src/core/layout/groups.test.ts`, `src/core/model/geometry.test.ts`, `src/core/model/reconcile.test.ts`, `src/app/export/exportBounds.test.ts` — Field builders)
- Test: `src/core/parse/parseDbml.test.ts` (append)

**Interfaces:**
- `src/core/parse/blankNoise.ts`: `export function blankNoise(source: string): string` — the function moves VERBATIM from `sourceMap.ts` (byte-identical body); `sourceMap.ts` re-exports it (`export { blankNoise } from '../core/parse/blankNoise';`) so `tableSettings.ts` and every other consumer keeps its import path. Motivation: the normalizer (core) needs it and core must not import editor.
- `types.ts` — `Ref` gains two REQUIRED fields (two hand-built fixtures updated, everything else goes through `parseDbml`):
  - `inline: boolean` — defined in a field's `[ref: …]` settings, not on a standalone `Ref` line. Drives the edge popover's refusal path (Feature A).
  - `pos: { line: number; column: number } | null` — 1-based token start. Needed because normalized endpoint order does NOT identify the defining table for inline refs (Verified facts) — the popover's Reveal jumps here via the existing `revealPosition`.
- `Field` gains `enumValues: string[] | null` — the enum's value list when `isEnum`, resolved at normalize time (bare-name lookup, matching the existing `enumNames` semantics including its known not-schema-scoped ceiling). Feature B's tooltip source; no new TableNode prop needed.
- `parseDbml.ts`: `normalizeDatabase(db, blanked)` — `parseDbml` passes `blankNoise(source)`; new private `isInlineRef(blanked, offset)` classifier (back-scan for `[`/`,` on blanked text, per Verified facts).

- [ ] **Step 1: Write the failing tests**

Append to `src/core/parse/parseDbml.test.ts`:

```ts
describe('ref origin: inline flag + pos (Plan 7 Feature A refusal path)', () => {
  const parse = (src: string) => {
    const r = parseDbml(src);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    return r.schema;
  };

  it('flags a field-settings ref inline and a standalone Ref line not', () => {
    const s = parse('Table a { id int }\nTable b { a_id int [pk, ref: > a.id] }\nTable c { a_id int }\nRef: c.a_id > a.id');
    expect(s.refs).toHaveLength(2);
    const inline = s.refs.find((r) => r.inline);
    const standalone = s.refs.find((r) => !r.inline);
    expect(inline).toBeDefined();
    expect(standalone).toBeDefined();
    // the standalone line is line 4
    expect(standalone!.pos?.line).toBe(4);
    // the inline token starts inside line 2's settings bracket
    expect(inline!.pos?.line).toBe(2);
    expect((inline!.pos?.column ?? 0) > 1).toBe(true);
  });

  it('an INDENTED standalone Ref stays standalone (column is not the signal)', () => {
    const s = parse('Table a { x int }\nTable b { p int }\n   Ref: a.x > b.p');
    expect(s.refs[0].inline).toBe(false);
  });

  it('a comment ending in a comma before a Ref line cannot fake inline (blanked scan)', () => {
    const s = parse('Table a { x int }\nTable b { p int }\n// note, with a comma,\nRef: a.x > b.p');
    expect(s.refs[0].inline).toBe(false);
  });

  it('named standalone refs with settings stay standalone', () => {
    const s = parse('Table a { x int }\nTable b { p int }\nRef fk_name: a.x > b.p [delete: cascade]');
    expect(s.refs[0].inline).toBe(false);
  });
});

describe('field enumValues (Plan 7 Feature B tooltips)', () => {
  it('resolves the enum value list onto enum-typed fields, null elsewhere', () => {
    const r = parseDbml('Enum status { draft\n live }\nTable t { s status\n n int }');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const [s, n] = r.schema.tables[0].fields;
    expect(s.isEnum).toBe(true);
    expect(s.enumValues).toEqual(['draft', 'live']);
    expect(n.isEnum).toBe(false);
    expect(n.enumValues).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/parse/parseDbml.test.ts` — Expected: FAIL (`inline`/`pos`/`enumValues` undefined on the normalized objects).

- [ ] **Step 3: Implement**

1. Create `src/core/parse/blankNoise.ts` — move the ENTIRE `blankNoise` function (with its doc comment) byte-identically from `src/editor/sourceMap.ts`, prefixed with:

```ts
/** Lives in core (moved from editor/sourceMap in Plan 7) so the normalizer
 *  can classify inline refs; sourceMap re-exports it — one implementation. */
```

2. In `src/editor/sourceMap.ts`, delete the moved function and add at the top (after the `TableRange` interface):

```ts
export { blankNoise } from '../core/parse/blankNoise';
```

and add the matching import for sourceMap's own use:

```ts
import { blankNoise } from '../core/parse/blankNoise';
```

(Both lines are needed: the re-export preserves `tableSettings.ts`'s `import { blankNoise } from './sourceMap'`; the import serves `buildTableRanges`.)

3. In `src/core/model/types.ts`, replace the `Ref` interface with:

```ts
export interface Ref {
  id: string;
  from: RefEndpoint;
  to: RefEndpoint;
  inline: boolean; // defined in a field's [ref: …] settings — the edge popover refuses text edits and offers Reveal instead
  pos: { line: number; column: number } | null; // 1-based parse-token start (Reveal target); null if the parser gave no token
}
```

and in `Field`, after `note: string | null;`:

```ts
  enumValues: string[] | null; // the enum's values when isEnum (bare-name lookup) — Feature B tooltips
```

4. In `src/core/parse/parseDbml.ts`:
- add the import: `import { blankNoise } from './blankNoise';`
- change the success return to `return { ok: true, schema: normalizeDatabase(db, blankNoise(source)) };`
- change the signature to `function normalizeDatabase(db: any, blanked: string): Schema {`
- add the classifier above `normalizeDatabase`:

```ts
// Empirical (8.3.1): parsed refs carry NO inline flag — only `token`. An
// inline ref's token starts at the `ref:` INSIDE a field's settings bracket,
// so the previous non-whitespace character is `[` or `,`. A standalone
// `Ref…` statement is preceded by `}`/`]`/nothing. The scan runs on
// comment/string-blanked text so `// a comment,` can't fake an inline ref.
function isInlineRef(blanked: string, offset: number | undefined): boolean {
  if (offset === undefined) return false; // no token info — standalone; findRefLine still refuses safely
  let i = offset - 1;
  while (i >= 0 && /\s/.test(blanked[i])) i--;
  return i >= 0 && (blanked[i] === '[' || blanked[i] === ',');
}
```

- after the first schemas loop (which fills `enums`/`enumNames`), add:

```ts
  const enumsByName = new Map(enums.map((e) => [e.name, e]));
```

- in the field mapping, replace the `isEnum` line with:

```ts
        isEnum: enumNames.has(f.type?.type_name ?? ''),
        enumValues: enumsByName.get(f.type?.type_name ?? '')?.values ?? null,
```

- in the refs loop, replace the push with:

```ts
      if (eps.length === 2) {
        const tokenStart = r.token?.start;
        refs.push({
          id: `ref-${refs.length}-${eps[0].tableId}-${eps[1].tableId}`,
          from: eps[0],
          to: eps[1],
          inline: isInlineRef(blanked, tokenStart?.offset),
          pos: typeof tokenStart?.line === 'number'
            ? { line: tokenStart.line, column: tokenStart.column ?? 1 }
            : null,
        });
      }
```

5. Fixture updates (the seven hand-built sites, per Verified facts — `tsc` is the gate that catches these, NOT vitest, since esbuild strips types):
- `src/core/layout/edges.test.ts:27` — add `inline: false, pos: null,` after `id: 'x',`.
- `src/core/layout/placement.test.ts` — in the ref-building helper at line ~13, add `inline: false as const, pos: null,` alongside `id`/`from`/`to`.
- FIVE `Field` builder literals, each currently ending `increment: false, defaultValue: null, note: null, isEnum: false,` — append `enumValues: null,` to each: `src/core/layout/groups.test.ts:9` (`mkTable`), `src/core/layout/placement.test.ts:10` (`mkTable`), `src/core/model/geometry.test.ts:10` (`table`), `src/core/model/reconcile.test.ts:9` (`mkTable`), `src/app/export/exportBounds.test.ts:10` (`mkTable`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/parse src/core/layout src/core/model src/app/export src/editor` — Expected: PASS (5 new; the seven touched fixtures still pass — but remember vitest strips types, so Step 5's `npx tsc --noEmit` is the gate that actually proves the fixture updates are complete).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npx vitest run && npx tsc --noEmit && git add -A && git commit -m "feat: normalizer emits Ref.inline/pos + Field.enumValues; blankNoise moves to core"
```

---

### Task 3: State spine — trace/highlight, `collapsedGroupIds` (+ full persistence threading), `canvasStackVersion`, `effectiveHiddenIds`

**Files:**
- Modify: `src/app/store.ts`, `src/core/persist/repository.ts` (type fields), `src/app/usePersistence.ts`, `src/core/convert/projectFile.ts`, `src/app/ImportDialog.tsx` (one line), `src/app/ExportMenu.tsx` (one line), `src/core/model/visibility.ts`
- Test: `src/app/store.test.ts` (extend `reset()` + append), `src/app/snapshotFlow.test.ts` (extend `resetStore()` + append), `src/core/convert/projectFile.test.ts` (append), `src/core/model/visibility.test.ts` (append)

**Interfaces:**
- `store.ts` (`AppState`) — new state: `traceEnabled: boolean` (default `false`, session), `highlightTableId: string | null` (default `null`, session), `collapsedGroupIds: string[]` (default `[]`, PERSISTED like `hiddenTableIds`), `canvasStackVersion: number` (default `0` — a change counter for the module-level command stack so toolbar buttons can subscribe; the stack itself deliberately stays out of zustand).
- New actions: `setTraceEnabled(v)` (turning OFF also clears `highlightTableId`), `setHighlightTable(id)`, `setCollapsedGroups(ids)` (prunes newly-collapse-hidden tables from `selectedTableIds` — same hiding-deselects rationale as `setHiddenTables`; group drags remain the membership-based exception).
- `applyParse` success branch prunes `highlightTableId` (null if its table vanished) and `collapsedGroupIds` (against `schema.groups` ids). Failure branch untouched.
- `canvasStackVersion` bumps ride EXISTING `set()` calls only: `commitCanvasCommand`, `undoCanvas`, `redoCanvas`, `loadDiagram` (which resets the stack), and `restoreSnapshot`'s same-text patch in `usePersistence.ts`. No new hot-path writes — this is the perf-contract trace: version writes happen exactly where position-map writes already happen (gesture end / undo / redo / load), never per tick.
- `loadDiagram`: `collapsedGroupIds: rec.collapsedGroupIds ?? []`, `highlightTableId: null` (it names a table of the OLD diagram); `traceEnabled` untouched (session).
- `visibility.ts`: `export function effectiveHiddenIds(schema: Schema, hiddenTableIds: readonly string[], collapsedGroupIds: readonly string[]): readonly string[]` — union of explicit hides and collapsed groups' members; returns the INPUT array when nothing is collapsed (referential stability for memos).
- Persistence threading = the `hiddenTableIds` precedent, byte-for-byte pattern: `PersistedDiagram.collapsedGroupIds?: string[]`, `DiagramSnapshot.collapsedGroupIds?: string[]`, `currentRecord()` emits it, autosave tuple gains `s.collapsedGroupIds`, `snapshotIfChanged` compares `?? []`-normalized on both sides + adds it to the payload, `restoreSnapshot` restores `snap.collapsedGroupIds ?? []` in BOTH branches, `ImportedDiagram`/`importDiagram` thread it, `ProjectFile.collapsedGroupIds?` serialized only when non-empty and validated as an all-strings array, `ImportDialog`/`ExportMenu` pass it through.

- [ ] **Step 1: Write the failing tests**

In `src/app/store.test.ts`, extend the file-scope `reset()` state object with:

```ts
    traceEnabled: false, highlightTableId: null, collapsedGroupIds: [], canvasStackVersion: 0,
```

then append at the end of the file:

```ts
describe('trace/highlight + collapse + stack version (Plan 7)', () => {
  beforeEach(reset);

  it('defaults: trace off, no highlight, nothing collapsed, version 0', () => {
    const s = useAppStore.getState();
    expect(s.traceEnabled).toBe(false);
    expect(s.highlightTableId).toBeNull();
    expect(s.collapsedGroupIds).toEqual([]);
    expect(s.canvasStackVersion).toBe(0);
  });

  it('disabling trace clears the highlight', () => {
    useAppStore.getState().setTraceEnabled(true);
    useAppStore.getState().setHighlightTable('public.a');
    useAppStore.getState().setTraceEnabled(false);
    expect(useAppStore.getState().highlightTableId).toBeNull();
  });

  it('applyParse prunes a highlight whose table vanished, keeps a live one', () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setHighlightTable('public.b');
    const next = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(next), next);
    expect(useAppStore.getState().highlightTableId).toBeNull();
  });

  it('applyParse prunes collapsedGroupIds of deleted groups, keeps live ones', () => {
    const src = 'Table a { id int }\nTable b { id int }\nTableGroup g1 { a }\nTableGroup g2 { b }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setCollapsedGroups(['public.g1', 'public.g2']);
    const next = 'Table a { id int }\nTable b { id int }\nTableGroup g1 { a }';
    useAppStore.getState().applyParse(parseDbml(next), next);
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);
  });

  it('a failed parse leaves highlight and collapse untouched (last-good-parse contract)', () => {
    const src = 'Table a { id int }\nTableGroup g1 { a }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setHighlightTable('public.a');
    useAppStore.getState().setCollapsedGroups(['public.g1']);
    useAppStore.getState().applyParse(parseDbml('Table a {'), 'Table a {');
    expect(useAppStore.getState().highlightTableId).toBe('public.a');
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);
  });

  it('collapsing a group deselects its members (hiding deselects)', () => {
    const src = 'Table a { id int }\nTable b { id int }\nTableGroup g1 { a }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().setSelectedTables(['public.a', 'public.b']);
    useAppStore.getState().setCollapsedGroups(['public.g1']);
    expect(useAppStore.getState().selectedTableIds).toEqual(['public.b']);
  });

  it('canvasStackVersion bumps on commit/undo/redo and load, not on zero-delta commits', () => {
    const src = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    const v0 = useAppStore.getState().canvasStackVersion;
    useAppStore.getState().commitCanvasCommand({
      label: 'noop', tables: [{ id: 'public.a', before: { x: 1, y: 1 }, after: { x: 1, y: 1 } }], notes: [],
    });
    expect(useAppStore.getState().canvasStackVersion).toBe(v0); // pruned to no-op: no bump
    useAppStore.getState().commitCanvasCommand({
      label: 'move', tables: [{ id: 'public.a', before: { x: 1, y: 1 }, after: { x: 9, y: 9 } }], notes: [],
    });
    expect(useAppStore.getState().canvasStackVersion).toBe(v0 + 1);
    useAppStore.getState().undoCanvas();
    expect(useAppStore.getState().canvasStackVersion).toBe(v0 + 2);
    useAppStore.getState().redoCanvas();
    expect(useAppStore.getState().canvasStackVersion).toBe(v0 + 3);
    useAppStore.getState().loadDiagram({
      id: 'x', name: 'X', dbml: '', positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().canvasStackVersion).toBe(v0 + 4); // stack was reset — buttons must re-read
  });

  it('loadDiagram loads collapsedGroupIds (defaulting for pre-Plan-7 records) and clears the highlight', () => {
    useAppStore.getState().setHighlightTable('public.a');
    useAppStore.getState().loadDiagram({
      id: 'x', name: 'X', dbml: '', positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
      collapsedGroupIds: ['public.g1'],
    });
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);
    expect(useAppStore.getState().highlightTableId).toBeNull();
    useAppStore.getState().loadDiagram({
      id: 'y', name: 'Y', dbml: '', positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1, // pre-Plan-7 record
    });
    expect(useAppStore.getState().collapsedGroupIds).toEqual([]);
  });
});
```

Append to `src/core/model/visibility.test.ts` (add `effectiveHiddenIds` to the import, and reuse the file's schema-building helper if one exists; otherwise parse inline as below):

```ts
describe('effectiveHiddenIds (Plan 7 group collapse)', () => {
  const schema = (() => {
    const r = parseDbml('Table a { id int }\nTable b { id int }\nTable c { id int }\nTableGroup g1 { a b }');
    if (!r.ok) throw new Error('fixture parse failed');
    return r.schema;
  })();

  it('returns the input array untouched when nothing is collapsed (referential stability)', () => {
    const hidden = ['public.c'];
    expect(effectiveHiddenIds(schema, hidden, [])).toBe(hidden);
  });

  it('unions collapsed-group members with explicit hides, without duplicates', () => {
    const out = effectiveHiddenIds(schema, ['public.a', 'public.c'], ['public.g1']);
    expect([...out].sort()).toEqual(['public.a', 'public.b', 'public.c']);
  });

  it('ignores collapsed ids that name no live group', () => {
    expect([...effectiveHiddenIds(schema, [], ['public.ghost'])]).toEqual([]);
  });
});
```

(If `visibility.test.ts` does not already import `parseDbml`, add `import { parseDbml } from '../parse/parseDbml';`.)

In `src/app/snapshotFlow.test.ts`, extend `resetStore()`'s state object with:

```ts
    collapsedGroupIds: [],
```

then append at the end of the file:

```ts
describe('collapsedGroupIds threading (Plan 7 — the hiddenTableIds precedent)', () => {
  beforeEach(async () => {
    await __resetForTests();
    resetStore();
    invalidatePendingAutosave();
  });

  it('importDiagram threads collapsedGroupIds', async () => {
    await importDiagram({ name: 'Imp', dbml: BASE, collapsedGroupIds: ['public.g1'] });
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);
    const all = await listDiagrams();
    expect(all[0].collapsedGroupIds).toEqual(['public.g1']);
  });

  it('collapsedGroupIds travel through snapshot restore; old snapshots clear them', async () => {
    const a: PersistedDiagram = { ...diagramA(), collapsedGroupIds: ['public.g1'] };
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a);
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g1']);

    const snap: DiagramSnapshot = {
      id: 'snap-c1', diagramId: a.id, takenAt: 5, name: 'A', dbml: EDITED,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, collapsedGroupIds: ['public.g2'],
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap);
    expect(useAppStore.getState().collapsedGroupIds).toEqual(['public.g2']);

    const old: DiagramSnapshot = {
      id: 'snap-c2', diagramId: a.id, takenAt: 6, name: 'A', dbml: BASE,
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, // pre-Plan-7 row
    };
    await putSnapshot(old);
    await restoreSnapshot(old);
    expect(useAppStore.getState().collapsedGroupIds).toEqual([]);
  });

  it('restore-checkpoint dedupe treats a pre-Plan-7 snapshot (no collapsedGroupIds) as []', async () => {
    const a = diagramA();
    await putDiagram(a);
    useAppStore.getState().loadDiagram(a); // collapsedGroupIds → []
    const snap: DiagramSnapshot = {
      id: 'snap-pre7', diagramId: a.id, takenAt: 5, name: 'A', dbml: BASE,
      positions: {}, notePositions: {}, hiddenTableIds: [], viewport: { x: 0, y: 0, zoom: 1 },
    };
    await putSnapshot(snap);
    await restoreSnapshot(snap); // identical text+layout → must dedupe, not checkpoint
    expect(await listSnapshots(a.id)).toHaveLength(1);
  });
});
```

Append to `src/core/convert/projectFile.test.ts`:

```ts
describe('collapsedGroupIds (Plan 7, optional — backward compatible)', () => {
  it('round-trips, omits when empty, and rejects malformed values', () => {
    const r = parseProject(serializeProject({ ...input, collapsedGroupIds: ['public.g1'] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.collapsedGroupIds).toEqual(['public.g1']);

    expect(serializeProject({ ...input, collapsedGroupIds: [] })).not.toContain('collapsedGroupIds');
    const old = parseProject(serializeProject(input));
    expect(old.ok && !('collapsedGroupIds' in old.project)).toBe(true);

    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.collapsedGroupIds = 'public.g1';
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
    raw.collapsedGroupIds = ['public.g1', 7];
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/store.test.ts src/app/snapshotFlow.test.ts src/core/convert/projectFile.test.ts src/core/model/visibility.test.ts` — Expected: FAIL (unknown actions/fields everywhere; `effectiveHiddenIds` not exported).

- [ ] **Step 3: Implement**

`src/core/model/visibility.ts` — append:

```ts
/** Effective hidden set (Plan 7): explicit hides ∪ members of collapsed
 *  groups. DERIVED, never written back into hiddenTableIds — expanding a
 *  group must not resurrect explicit hides or vice versa. Returns the input
 *  array untouched when nothing is collapsed so memos keyed on it stay
 *  referentially stable. */
export function effectiveHiddenIds(
  schema: Schema,
  hiddenTableIds: readonly string[],
  collapsedGroupIds: readonly string[],
): readonly string[] {
  if (collapsedGroupIds.length === 0) return hiddenTableIds;
  const collapsed = new Set(collapsedGroupIds);
  const out = new Set(hiddenTableIds);
  for (const g of schema.groups) {
    if (!collapsed.has(g.id)) continue;
    for (const id of g.tableIds) out.add(id);
  }
  return [...out];
}
```

`src/core/persist/repository.ts` — in `PersistedDiagram`, after the `hiddenTableIds?` line:

```ts
  collapsedGroupIds?: string[]; // optional: pre-Plan-7 records lack it (view state, group collapse)
```

and the same line (with `rows` wording) in `DiagramSnapshot` after its `hiddenTableIds?` line.

`src/app/store.ts`:

1. `AppState` interface — after `lodOverride: LodOverride;`:

```ts
  traceEnabled: boolean; // session-only: highlight/trace mode toggle (Feature C)
  highlightTableId: string | null; // session-only: the traced table; cleared on diagram switch, pruned on parse
  collapsedGroupIds: string[]; // view state: collapsed table groups — persisted like hiddenTableIds, never DBML
  canvasStackVersion: number; // change counter for the module-level command stack (toolbar undo/redo buttons subscribe to this, never to the stack itself)
```

and after `setLodOverride(v: LodOverride): void;`:

```ts
  setTraceEnabled(v: boolean): void;
  setHighlightTable(id: string | null): void;
  setCollapsedGroups(ids: string[]): void;
```

2. Initial state — after `lodOverride: 'auto',`:

```ts
    traceEnabled: false,
    highlightTableId: null,
    collapsedGroupIds: [],
    canvasStackVersion: 0,
```

3. `applyParse` — widen the destructure:

```ts
      const { schema: prev, positions, notePositions, selectedTableIds, hiddenTableIds, collapsedGroupIds, highlightTableId } = get();
```

and inside the success `set({ … })`, after the `hiddenTableIds:` line:

```ts
        collapsedGroupIds: (() => {
          const groupIds = new Set(result.schema.groups.map((g) => g.id));
          return collapsedGroupIds.filter((id) => groupIds.has(id));
        })(),
        highlightTableId: highlightTableId !== null && tableIds.has(highlightTableId) ? highlightTableId : null,
```

4. `commitCanvasCommand` — replace the `set` call with:

```ts
      set((s) => ({
        positions: applyDeltas(s.positions, cmd.tables, 'after'),
        notePositions: applyDeltas(s.notePositions, cmd.notes, 'after'),
        canvasStackVersion: s.canvasStackVersion + 1, // rides the existing gesture-end set()
      }));
```

5. `undoCanvas`/`redoCanvas` — replace each `set` call with (`'before'` / `'after'` respectively):

```ts
      set((s) => ({ ...applyCommandSide(s, cmd, 'before'), canvasStackVersion: s.canvasStackVersion + 1 }));
```

6. New setters, next to `setLodOverride`:

```ts
    setTraceEnabled: (traceEnabled) =>
      set((s) => ({ traceEnabled, highlightTableId: traceEnabled ? s.highlightTableId : null })),
    setHighlightTable: (highlightTableId) => set({ highlightTableId }),
    setCollapsedGroups: (collapsedGroupIds) =>
      set((s) => {
        // Collapsing hides members ⇒ deselect them (same rationale as
        // setHiddenTables: a hidden table left selected would be silently
        // moved by the next multi-select drag). Group-header drags remain
        // the membership-based exception.
        const collapsed = new Set(collapsedGroupIds);
        const hiddenByCollapse = new Set(
          s.schema.groups.filter((g) => collapsed.has(g.id)).flatMap((g) => g.tableIds),
        );
        return {
          collapsedGroupIds,
          selectedTableIds: s.selectedTableIds.filter((id) => !hiddenByCollapse.has(id)),
        };
      }),
```

7. `loadDiagram` — convert the `set({ … })` to the function form `set((s) => ({ … }))` and add, after the `diagramCreatedAt:` line:

```ts
        collapsedGroupIds: rec.collapsedGroupIds ?? [], // pre-Plan-7 records: nothing collapsed
        highlightTableId: null, // it named a table of the OLD diagram
        canvasStackVersion: s.canvasStackVersion + 1, // resetCanvasStack() above emptied the stack — buttons must re-read
        // traceEnabled / snapEnabled / lodOverride deliberately untouched: session state.
```

`src/app/usePersistence.ts` — six edits (each mirrors the existing `hiddenTableIds` line beside it):

1. `currentRecord()` — after `hiddenTableIds: s.hiddenTableIds,`:
```ts
    collapsedGroupIds: s.collapsedGroupIds,
```
2. `snapshotIfChanged` — extend `sameLayout` with (directly after the hiddenTableIds comparison, inside the same `(...)`):
```ts
      &&
      JSON.stringify(newest?.collapsedGroupIds ?? []) === JSON.stringify(rec.collapsedGroupIds ?? [])
```
and the `putSnapshot({ … })` payload — after `hiddenTableIds: rec.hiddenTableIds,`:
```ts
      collapsedGroupIds: rec.collapsedGroupIds,
```
3. `ImportedDiagram` — after `hiddenTableIds?: string[];`:
```ts
  collapsedGroupIds?: string[];
```
4. `importDiagram`'s `rec` — after `hiddenTableIds: imp.hiddenTableIds ?? [],`:
```ts
    collapsedGroupIds: imp.collapsedGroupIds ?? [],
```
5. `restoreSnapshot` — the `rec` construction, after `hiddenTableIds: snap.hiddenTableIds ?? [],`:
```ts
    collapsedGroupIds: snap.collapsedGroupIds ?? [],
```
and the same-text `setState` patch becomes:
```ts
    useAppStore.setState({
      diagramName: rec.name, positions: rec.positions, notePositions: rec.notePositions,
      hiddenTableIds: rec.hiddenTableIds, collapsedGroupIds: rec.collapsedGroupIds, viewport: rec.viewport,
      canvasStackVersion: useAppStore.getState().canvasStackVersion + 1, // resetCanvasStack() just ran
    });
```
6. The autosave subscription tuple — replace with:
```ts
      (s) => [s.source, s.positions, s.viewport, s.diagramName, s.notePositions, s.hiddenTableIds, s.collapsedGroupIds] as const,
```

`src/core/convert/projectFile.ts` — four edits, each the exact `hiddenTableIds` pattern one line below it:

1. `ProjectFile` — after `hiddenTableIds?: string[];`:
```ts
  collapsedGroupIds?: string[]; // optional: pre-Plan-7 files lack it (group-collapse view state)
```
2. `serializeProject` — parameter type gains `collapsedGroupIds?: string[];` and the `file` literal gains (after the `hiddenTableIds:` line):
```ts
    collapsedGroupIds: p.collapsedGroupIds && p.collapsedGroupIds.length > 0 ? p.collapsedGroupIds : undefined,
```
3. `parseProject` — duplicate the `hiddenTableIds` validation block directly below itself, renaming every occurrence to `collapsedGroupIds` and the error to `'Project file "collapsedGroupIds" must be an array of group ids.'`.
4. Thread into the returned project next to the hiddenTableIds spread:
```ts
      ...(collapsedGroupIds !== undefined ? { collapsedGroupIds } : {}),
```

`src/app/ImportDialog.tsx` — in the project branch's `importDiagram({ … })`, after `hiddenTableIds: r.project.hiddenTableIds,`:
```ts
          collapsedGroupIds: r.project.collapsedGroupIds,
```

`src/app/ExportMenu.tsx` — in `exportProject`'s `serializeProject({ … })`, after `hiddenTableIds: s.hiddenTableIds,`:
```ts
        collapsedGroupIds: s.collapsedGroupIds,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/store.test.ts src/app/snapshotFlow.test.ts src/core/convert/projectFile.test.ts src/core/model/visibility.test.ts` — Expected: PASS (8 store + 3 snapshotFlow + 1 projectFile + 3 visibility new; every pre-existing dedupe/threading test still green — the added compares are `[] === []` after normalization).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npx vitest run && npx tsc --noEmit && git add -A && git commit -m "feat: state spine — trace/highlight, collapsedGroupIds threading, canvasStackVersion, effectiveHiddenIds"
```

---

### Task 4: Escape overlay-stack + the six listener migrations + kebab outside-click

**Files:**
- Create: `src/app/overlayStack.ts`
- Modify: `src/app/useHoverMenu.ts`, `src/app/ImportDialog.tsx`, `src/app/DiagramDashboard.tsx`, `src/canvas/TableSettingsPopover.tsx`, `src/canvas/CanvasControls.tsx`, `src/canvas/DiagramCanvas.tsx`
- Test: `src/app/overlayStack.test.ts` (new)

**Interfaces:**
- `overlayStack.ts`: `pushOverlay(close) → dispose` (LIFO stack; ONE window keydown listener, attached while the stack is non-empty; Escape closes the TOPMOST overlay only), `overlayDepth(): number`, `handleEscape(): boolean` (exported so node tests can drive it without a DOM event), and the React wrapper `useOverlayEscape(active: boolean, onClose: () => void)` — latest-ref on `onClose` so identity churn (inline arrows from parents) never re-pushes and reorders the stack.
- Migration rule: each component DELETES only the `e.key === 'Escape'` branch of its window-keydown effect and calls `useOverlayEscape(<open>, <close>)` instead; outside-pointerdown listeners stay component-local (only Escape is centralized). `ImportDialog` keeps its busy gate by passing `active = !busy`.
- `DiagramCanvas`'s Escape (clear selection) is deliberately NOT on the stack: it becomes the LAST RESORT — it acts only when `overlayDepth() === 0`. This retires the P6 double-effect (Escape closing a popover AND clearing the selection in the same keypress).
- Dashboard kebab: a window pointerdown listener active while `menuId !== null` closes the row menu unless the press lands inside `.dash-menu`/`.dash-kebab` (P6 deferred item).

- [ ] **Step 1: Write the failing tests**

`src/app/overlayStack.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushOverlay, overlayDepth, handleEscape } from './overlayStack';

// The stack is MODULE state — every test must drain what it pushed or the
// next test starts dirty (order-dependence). All pushes go through `push`,
// which records the disposer; beforeEach drains leftovers BEFORE stubbing a
// fresh window, so drain-time removeEventListener calls hit the OLD stub and
// each test's listener counts stay isolated.
const disposers: Array<() => void> = [];
const push = (close: () => void) => {
  const d = pushOverlay(close);
  disposers.push(d);
  return d;
};

beforeEach(() => {
  while (disposers.length > 0) disposers.pop()!();
  // node env: stub just enough window for the listener add/remove calls.
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe('overlayStack', () => {
  it('escape closes the TOPMOST overlay only, in LIFO order', () => {
    const closed: string[] = [];
    const a = push(() => { closed.push('a'); a(); });
    const b = push(() => { closed.push('b'); b(); });
    expect(overlayDepth()).toBe(2);
    expect(handleEscape()).toBe(true);
    expect(closed).toEqual(['b']); // a untouched
    expect(overlayDepth()).toBe(1);
    expect(handleEscape()).toBe(true);
    expect(closed).toEqual(['b', 'a']);
    expect(overlayDepth()).toBe(0);
    expect(handleEscape()).toBe(false); // empty stack: not handled (canvas last-resort may act)
  });

  it('dispose is idempotent and removes from the middle without disturbing order', () => {
    const closed: string[] = [];
    const a = push(() => { closed.push('a'); });
    const b = push(() => { closed.push('b'); });
    push(() => { closed.push('c'); }); // c stays undisposed — beforeEach drains it
    b();
    b(); // idempotent
    expect(overlayDepth()).toBe(2);
    handleEscape();
    expect(closed).toEqual(['c']); // c was topmost; b is gone, a still below
    a();
    expect(overlayDepth()).toBe(1);
  });

  it('attaches the window listener on first push and detaches on last dispose', () => {
    expect(overlayDepth()).toBe(0); // hermetic start — the drain guarantees it
    const w = window as unknown as { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
    const a = push(() => {});
    const b = push(() => {});
    expect(w.addEventListener).toHaveBeenCalledTimes(1);
    a();
    expect(w.removeEventListener).not.toHaveBeenCalled();
    b();
    expect(w.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/overlayStack.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the module**

`src/app/overlayStack.ts`:

```ts
import { useEffect, useRef } from 'react';

/** Escape overlay-stack (Plan 7, Feature F): ONE window keydown listener,
 *  Escape closes the TOPMOST open overlay only. Replaces six per-component
 *  Escape listeners whose firing order was DOM-registration luck (the P6
 *  "double-effect": one Escape closed a popover AND cleared the selection).
 *  Only Escape is centralized — outside-click dismissal stays local to each
 *  component. DiagramCanvas's clear-selection Escape is deliberately NOT an
 *  overlay: it checks overlayDepth() === 0 and acts as the last resort. */
type Close = () => void;

const stack: Close[] = [];

/** Close the topmost overlay. Returns false when the stack is empty (the
 *  caller — or the canvas's last-resort handler — may act instead). */
export function handleEscape(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top(); // the overlay closes itself; its effect cleanup pops the entry
  return true;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') handleEscape();
}

export function overlayDepth(): number {
  return stack.length;
}

export function pushOverlay(close: Close): () => void {
  if (stack.length === 0) window.addEventListener('keydown', onKeyDown);
  stack.push(close);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const i = stack.indexOf(close);
    if (i !== -1) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener('keydown', onKeyDown);
  };
}

/** While `active`, `onClose` sits on the Escape stack. Latest-ref so parents
 *  passing inline arrows don't re-push (and re-ORDER) the entry per render. */
export function useOverlayEscape(active: boolean, onClose: Close): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    return pushOverlay(() => ref.current());
  }, [active]);
}
```

Run: `npx vitest run src/app/overlayStack.test.ts` — Expected: PASS (3).

- [ ] **Step 4: Migrate the six listeners**

1. `src/app/useHoverMenu.ts` — add `import { useOverlayEscape } from './overlayStack';`; inside `useHoverMenu` add `useOverlayEscape(open, close);` right after the `toggle` definition; in the open-effect DELETE the `onKey` handler, its `addEventListener('keydown', …)` and matching remove (the effect keeps only the outside-`pointerdown` listener).
2. `src/app/ImportDialog.tsx` — add the import; REPLACE the whole Escape `useEffect` (lines 25–31) with:
```ts
  // Busy gate preserved: while an import is in flight the dialog is not on
  // the stack, so Escape must not close it. The canvas last-resort checks
  // for a mounted .dialog (see the DiagramCanvas edit below) so this Escape
  // doesn't fall through and clear the selection behind the modal.
  useOverlayEscape(!busy, onClose);
```
3. `src/app/DiagramDashboard.tsx` — add the import; replace its Escape `useEffect` (lines 32–38) with `useOverlayEscape(true, onClose);` (the dashboard exists only while open — `true` is correct). The rename-input's own Escape/stopPropagation handling is untouched (React's stopPropagation stops the native event before the window listener).
4. `src/canvas/TableSettingsPopover.tsx` — add `import { useOverlayEscape } from '../app/overlayStack';`; in its listeners effect DELETE the `onKey` handler + keydown add/remove (keep `onDown`); add `useOverlayEscape(true, onClose);` above the effect.
5. `src/canvas/CanvasControls.tsx` — same surgery for the shortcuts popover: keep the outside-pointerdown listener, delete the Escape branch, add `useOverlayEscape(shortcutsOpen, () => setShortcutsOpen(false));`.
6. `src/canvas/DiagramCanvas.tsx` — add `import { overlayDepth } from '../app/overlayStack';`; in the keyboard effect replace:
```ts
      if (e.key === 'Escape') {
        useAppStore.getState().setSelectedTables([]);
        return;
      }
```
with:
```ts
      if (e.key === 'Escape') {
        // Last resort: overlays own Escape while any is open (overlayStack),
        // and a busy ImportDialog is modal-but-off-stack (its busy gate) —
        // the .dialog check keeps this from acting behind it.
        if (overlayDepth() > 0 || document.querySelector('.dialog')) return;
        useAppStore.getState().setSelectedTables([]);
        return;
      }
```

- [ ] **Step 5: Dashboard kebab outside-click**

In `src/app/DiagramDashboard.tsx`, add after the (now replaced) Escape hook:

```ts
  // P6 deferred item: the row kebab had no outside-click dismissal. Class-
  // based containment check — rows are mapped, a per-row ref would be noise.
  useEffect(() => {
    if (menuId === null) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('.dash-menu') && !el?.closest?.('.dash-kebab')) setMenuId(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuId]);
```

- [ ] **Step 6: Verify (unit, typecheck, browser)**

```bash
npx vitest run && npx tsc --noEmit
```
Expected: green/clean. Browser (dev server on 5173, MAIN build differs — quick sanity only, full walkthrough in Task 15): open Export menu → table settings popover on top of it → Escape closes the popover FIRST, second Escape closes the menu, third clears selection; kebab menu in the dashboard closes on a click anywhere else; Import dialog Escape still blocked while busy.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: escape overlay-stack (topmost-only) + six listener migrations + kebab outside-click"
```

---

### Task 5: The ref text machinery — `refEdit.ts` (pure) + `editorNav` bridge additions + history annotations

**Files:**
- Create: `src/editor/refEdit.ts`
- Modify: `src/editor/tableSettings.ts` (export `emitIdent`), `src/editor/editorNav.ts`
- Test: `src/editor/refEdit.test.ts` (new)

**Interfaces:**
- `tableSettings.ts`: the private `emitName` is renamed to `emitIdent` and EXPORTED (bare identifier | `"quoted"` | `null` when unrepresentable) — one emitter shared with refEdit; `rewriteTableHeader` updates its one call site.
- `refEdit.ts` (pure, fully unit-tested — the editorNav wrappers below are thin dispatch shims, browser-verified per repo convention like `applyTableSettings`):
  - `type RefOperator = '>' | '<' | '-' | '<>'`; `MIRRORED` map; `refOperator(ref): RefOperator` (from the endpoints' relations, read as `from OP to`).
  - `findRefLine(source, ref): RefLineMatch | null` — line-anchored scan of `blankNoise`d source for the standalone single-line form `Ref[ name]: <ep> <op> <ep> [settings]?`; matches the ref by endpoint pair (either textual direction — `flipped`), which is unambiguous because dbmlv2 REJECTS duplicate endpoint pairs (Verified facts). Handles optional names, quoted schema/table/field tokens, **alias-written endpoints** (the parser resolves `U.id` to the real table — verified — so the scanner resolves the text side via `buildTableRanges`' existing `alias` field), composite `(a, b)` lists, indentation/whitespace, `[delete/update: …]` suffixes (untouched by an operator swap). Returns `null` for inline refs (no standalone line exists), for the block form `Ref { … }` (no `:` on the line), and for a ref WRAPPED across lines (parses fine, verified — documented, tested refusal) — the popover's honest refusal paths.
  - `RefLineMatch = { lineFrom, lineTo, opFrom, opTo, operator, flipped }` — `lineTo` includes the trailing newline (the delete span); `opFrom/opTo` is the swap span (regex `d` flag indices, natively typed at ES2022).
  - `buildRefLine(from, to): string | null` with `RefLineEndpoint = { schemaName, tableName, fieldName }` — emits `Ref: a.b > c.d` (`>` = many-to-one source>target, dbdiagram's drag default); `public.` omitted (normalizer default; qualified form also parses — Verified facts); null when a name is unrepresentable (caller cancels, never mangles).
  - `formatRefText(ref): string` — display-only popover summary (`posts.user_id > users.id`).
- `editorNav.ts` gains the bridge's second consumer (each: one transaction, `userEvent` annotated so CodeMirror history never merges canvas actions into adjacent typing):
  - `appendRefLine(line: string): boolean` — append at doc end, newline-managed.
  - `applyRefOperator(ref: Ref, op: RefOperator): boolean` — locate via `findRefLine` on the CURRENT doc, mirror the operator when the line is written in the flipped direction, no-op when unchanged; false when unlocatable (popover shows the error).
  - `deleteRefLine(ref: Ref): boolean` — remove `[lineFrom, lineTo)`.
  - `applyTableSettings`'s dispatch gains `userEvent: 'canvas.settings'` (the P6 swatch-click history-merging ledger item — two swatch clicks become two undo steps; verified in the browser step).

- [ ] **Step 1: Write the failing tests**

`src/editor/refEdit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDbml } from '../core/parse/parseDbml';
import type { Ref } from '../core/model/types';
import { findRefLine, buildRefLine, refOperator, MIRRORED, formatRefText } from './refEdit';

const schemaOf = (src: string) => {
  const r = parseDbml(src);
  if (!r.ok) throw new Error(r.errors[0]?.message);
  return r.schema;
};
const refOf = (src: string, i = 0): Ref => schemaOf(src).refs[i];

const TABLES = 'Table a { x int \n y int }\nTable b { p int \n q int }\n';

describe('findRefLine', () => {
  it('locates a simple line with exact spans; a swap round-trips through the real parser', () => {
    const src = `${TABLES}Ref: a.x > b.p`;
    const ref = refOf(src);
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    expect(src.slice(m!.lineFrom, m!.lineTo)).toBe('Ref: a.x > b.p');
    expect(m!.operator).toBe('>');
    expect(m!.flipped).toBe(false);
    const swapped = src.slice(0, m!.opFrom) + '<' + src.slice(m!.opTo);
    const re = schemaOf(swapped).refs[0];
    expect(re.from.relation).toBe('1'); // a.x < b.p: one-side left
    expect(re.to.relation).toBe('*');
  });

  it('preserves a name and on-delete settings around an operator swap, byte-for-byte', () => {
    const src = `${TABLES}Ref order_fk: a.x > b.p [delete: cascade, update: no action]`;
    const ref = refOf(src);
    const m = findRefLine(src, ref)!;
    const swapped = src.slice(0, m.opFrom) + '<>' + src.slice(m.opTo);
    expect(swapped).toContain('Ref order_fk: a.x <> b.p [delete: cascade, update: no action]');
    expect(schemaOf(swapped).refs[0].from.relation).toBe('*'); // many-to-many now
  });

  it('deleting lineFrom..lineTo removes exactly the line and re-parses clean', () => {
    const src = `${TABLES}Ref: a.x > b.p\nRef: a.y > b.q\n`;
    const ref = refOf(src, 0); // a.x > b.p
    const m = findRefLine(src, ref)!;
    const after = src.slice(0, m.lineFrom) + src.slice(m.lineTo);
    const s = schemaOf(after);
    expect(s.refs).toHaveLength(1);
    expect(after).toContain('Ref: a.y > b.q');
    expect(after).not.toContain('a.x > b.p');
  });

  it('tolerates indentation, spacing, quoted tables/fields, and public-qualification', () => {
    const src = 'Table "or der" { "f 1" int }\nTable b { p int }\n   Ref:  public."or der"."f 1"   >   b.p';
    const ref = refOf(src);
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    expect(src.slice(m!.opFrom, m!.opTo)).toBe('>');
  });

  it('matches composite endpoints exactly (order-sensitive field lists)', () => {
    const src = `${TABLES}Ref: a.(x, y) > b.(p, q)`;
    const ref = refOf(src);
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    expect(m!.operator).toBe('>');
  });

  it('reports flipped when the normalized endpoints are reversed vs the written line', () => {
    const src = `${TABLES}Ref: a.x > b.p`;
    const ref = refOf(src);
    const reversed: Ref = { ...ref, from: ref.to, to: ref.from };
    const m = findRefLine(src, reversed);
    expect(m).not.toBeNull();
    expect(m!.flipped).toBe(true);
  });

  it('resolves alias-written endpoints (the parser resolves aliases — verified — so must the scanner)', () => {
    const src = 'Table users as U { id int }\nTable posts { user_id int }\nRef: posts.user_id > U.id';
    const ref = refOf(src); // normalized endpoints carry the REAL name: public.users
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    const swapped = src.slice(0, m!.opFrom) + '<' + src.slice(m!.opTo);
    expect(schemaOf(swapped).refs[0].from.relation).toBe('1'); // alias line rewritten in place
  });

  it('refuses a ref WRAPPED across lines (parses fine — the line-anchored scanner cannot own it)', () => {
    const src = 'Table a { x int }\nTable b { p int }\nRef: a.x >\n  b.p';
    expect(schemaOf(src).refs).toHaveLength(1); // the parser accepts the wrapped form (verified)…
    expect(findRefLine(src, refOf(src))).toBeNull(); // …we refuse honestly (popover shows the can't-locate error)
  });

  it('returns null for inline refs and for the block form (the refusal paths)', () => {
    const inlineSrc = 'Table a { id int }\nTable b { a_id int [ref: > a.id] }';
    expect(findRefLine(inlineSrc, refOf(inlineSrc))).toBeNull();
    const blockSrc = `${TABLES}Ref {\n  a.x > b.p\n}`;
    expect(findRefLine(blockSrc, refOf(blockSrc))).toBeNull();
  });

  it('tolerates a trailing // comment and never reads operator noise from it (blanked scan)', () => {
    // note: `note:` is NOT a valid ref setting in 8.3.1 ("Unknown ref setting")
    // — comments are where operator noise realistically lives.
    const src = `${TABLES}Ref: a.x - b.p // not < a real > op`;
    const ref = refOf(src);
    const m = findRefLine(src, ref)!;
    expect(src.slice(m.opFrom, m.opTo)).toBe('-');
  });
});

describe('buildRefLine / refOperator / formatRefText', () => {
  it('builds a parseable many-to-one line, omitting public', () => {
    const line = buildRefLine(
      { schemaName: 'public', tableName: 'posts', fieldName: 'user_id' },
      { schemaName: 'public', tableName: 'users', fieldName: 'id' },
    );
    expect(line).toBe('Ref: posts.user_id > users.id');
    const s = schemaOf(`Table posts { user_id int }\nTable users { id int }\n${line}`);
    expect(s.refs[0].from.relation).toBe('*');
    expect(s.refs[0].to.relation).toBe('1');
  });

  it('quotes non-identifier names, prefixes non-public schemas, parses back', () => {
    const line = buildRefLine(
      { schemaName: 'auth', tableName: 'user sessions', fieldName: 'user id' },
      { schemaName: 'public', tableName: 'users', fieldName: 'id' },
    );
    expect(line).toBe('Ref: auth."user sessions"."user id" > users.id');
    const src = `Table auth."user sessions" { "user id" int }\nTable users { id int }\n${line}`;
    expect(schemaOf(src).refs).toHaveLength(1);
  });

  it('returns null for unrepresentable names (embedded quote)', () => {
    expect(buildRefLine(
      { schemaName: 'public', tableName: 'a"b', fieldName: 'x' },
      { schemaName: 'public', tableName: 'c', fieldName: 'y' },
    )).toBeNull();
  });

  it('refOperator maps all four relation pairs; MIRRORED is an involution', () => {
    const src = `${TABLES}Ref: a.x > b.p\nRef: a.y < b.q\nTable c { m int \n n int }\nRef: c.m - b.p\nRef: c.n <> a.x`;
    const s = schemaOf(src);
    expect(s.refs.map(refOperator)).toEqual(['>', '<', '-', '<>']);
    for (const op of ['>', '<', '-', '<>'] as const) expect(MIRRORED[MIRRORED[op]]).toBe(op);
  });

  it('formatRefText strips public. and shows composite field lists', () => {
    const s = schemaOf(`${TABLES}Ref: a.(x, y) > b.(p, q)`);
    expect(formatRefText(s.refs[0])).toBe('a.(x, y) > b.(p, q)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/editor/refEdit.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

In `src/editor/tableSettings.ts`, rename `emitName` → `emitIdent`, export it, and update its call site in `rewriteTableHeader` (`const emitted = emitIdent(edit.name.trim());`). The doc comment moves with it:

```ts
/** Bare identifier when possible, double-quoted otherwise; null when the
 *  name can't be represented on a single line at all. Shared by the header
 *  rewriter and refEdit's line builder. */
export function emitIdent(name: string): string | null {
```

`src/editor/refEdit.ts`:

```ts
import { blankNoise } from '../core/parse/blankNoise';
import { buildTableRanges } from './sourceMap';
import { emitIdent } from './tableSettings';
import type { Ref, RefEndpoint } from '../core/model/types';

/** Feature A's pure ref-line machinery — the text half of the bridge's
 *  second consumer. findRefLine LOCATES a standalone `Ref:` line for a
 *  normalized ref; the editorNav wrappers dispatch the actual transactions.
 *  Endpoint-pair matching is unambiguous: dbmlv2 rejects duplicate endpoint
 *  pairs as a parse error (verified on the installed 8.3.1). */

export type RefOperator = '>' | '<' | '-' | '<>';

export const MIRRORED: Record<RefOperator, RefOperator> = { '>': '<', '<': '>', '-': '-', '<>': '<>' };

/** Cardinality of a normalized ref read as `from OP to`. */
export function refOperator(ref: Ref): RefOperator {
  if (ref.from.relation === '*' && ref.to.relation === '1') return '>';
  if (ref.from.relation === '1' && ref.to.relation === '*') return '<';
  if (ref.from.relation === '*') return '<>';
  return '-';
}

export interface RefLineMatch {
  lineFrom: number; // offset of the line's first character
  lineTo: number; // offset AFTER the trailing newline (line end at EOF) — the delete span
  opFrom: number; // operator span — the swap target
  opTo: number;
  operator: RefOperator; // as written on the line
  flipped: boolean; // the textual LEFT endpoint is ref.to (line written in the other direction)
}

const IDENT = String.raw`(?:"[^"\n]+"|[A-Za-z_]\w*)`;
const FIELDS = String.raw`(?:${IDENT}|\(\s*${IDENT}(?:\s*,\s*${IDENT})*\s*\))`;
// endpoint = [schema .] table . fields — captures: table-path, fields
const ENDPOINT = String.raw`((?:${IDENT}[ \t]*\.[ \t]*)?${IDENT})[ \t]*\.[ \t]*(${FIELDS})`;
// The standalone SINGLE-LINE form: `Ref[ name]: <ep> <op> <ep> [settings]?`.
// Runs on blankNoise'd text (strings/comments blanked, quoted identifiers
// preserved) so a `>` inside a note string can't fake an operator and a `]`
// inside a quoted setting can't break the tail. The block form `Ref { … }`
// has no `:` on this line → no match → null → the popover refuses honestly.
// Capture groups: 1 = left table-path, 2 = left fields, 3 = operator,
// 4 = right table-path, 5 = right fields. /d for the operator span indices.
const REF_LINE_RE = new RegExp(
  String.raw`^[ \t]*Ref(?:[ \t]+${IDENT})?[ \t]*:[ \t]*${ENDPOINT}[ \t]*(<>|[<>-])[ \t]*${ENDPOINT}[ \t]*(?:\[[^\]\n]*\])?[ \t]*$`,
  'id',
);

function unquote(tok: string): string {
  return tok.startsWith('"') ? tok.slice(1, -1) : tok;
}

/** "schema.table" | "table" (either token quotable) → CANDIDATE normalizer
 *  identities. An unqualified bare token may also be a table ALIAS — the
 *  parser resolves aliases in ref endpoints (verified: `Ref: … > U.id`
 *  normalizes to `users`), so the text side must resolve them too;
 *  buildTableRanges already extracts aliases. A schema-qualified path is
 *  never an alias. */
function tableCandidates(raw: string, aliasToId: Map<string, string>): string[] {
  const m = new RegExp(String.raw`^(?:(${IDENT})[ \t]*\.[ \t]*)?(${IDENT})$`).exec(raw.trim());
  if (!m) return [raw.trim()];
  const table = unquote(m[2]);
  if (m[1]) return [`${unquote(m[1])}.${table}`];
  const out = [`public.${table}`];
  const viaAlias = aliasToId.get(table);
  if (viaAlias !== undefined && viaAlias !== out[0]) out.push(viaAlias);
  return out;
}

function parseFields(raw: string): string[] {
  const t = raw.trim();
  const inner = t.startsWith('(') ? t.slice(1, -1) : t;
  return inner.split(',').map((f) => unquote(f.trim()));
}

function sameEndpoint(tableIds: string[], fields: string[], ep: RefEndpoint): boolean {
  return (
    tableIds.includes(ep.tableId) &&
    fields.length === ep.fieldNames.length &&
    fields.every((f, i) => f === ep.fieldNames[i])
  );
}

export function findRefLine(source: string, ref: Ref): RefLineMatch | null {
  const blanked = blankNoise(source);
  const aliasToId = new Map(
    buildTableRanges(source)
      .filter((r) => r.alias !== null)
      .map((r) => [r.alias as string, r.tableId] as const),
  );
  let lineFrom = 0;
  for (;;) {
    const nl = blanked.indexOf('\n', lineFrom);
    const lineEnd = nl === -1 ? blanked.length : nl;
    const m = REF_LINE_RE.exec(blanked.slice(lineFrom, lineEnd));
    if (m) {
      const [, t1, f1, op, t2, f2] = m;
      const left = { ids: tableCandidates(t1, aliasToId), fields: parseFields(f1) };
      const right = { ids: tableCandidates(t2, aliasToId), fields: parseFields(f2) };
      const direct = sameEndpoint(left.ids, left.fields, ref.from) && sameEndpoint(right.ids, right.fields, ref.to);
      const flipped = !direct && sameEndpoint(left.ids, left.fields, ref.to) && sameEndpoint(right.ids, right.fields, ref.from);
      if (direct || flipped) {
        const [opStart, opEnd] = m.indices![3]!;
        return {
          lineFrom,
          lineTo: nl === -1 ? lineEnd : lineEnd + 1,
          opFrom: lineFrom + opStart,
          opTo: lineFrom + opEnd,
          operator: op as RefOperator,
          flipped,
        };
      }
    }
    if (nl === -1) return null;
    lineFrom = nl + 1;
  }
}

export interface RefLineEndpoint {
  schemaName: string;
  tableName: string;
  fieldName: string;
}

/** `Ref: a.b > c.d` — the appended standalone line (ref-drag). `>` =
 *  many-to-one source>target, dbdiagram's drag default. Null when a name is
 *  unrepresentable (contains `"` or a newline) — the caller cancels, never
 *  writes a mangled line. `public.` is omitted (normalizer default; the
 *  qualified form also parses — plan Verified facts). */
export function buildRefLine(from: RefLineEndpoint, to: RefLineEndpoint): string | null {
  const fmt = (e: RefLineEndpoint): string | null => {
    const t = emitIdent(e.tableName);
    const f = emitIdent(e.fieldName);
    if (t === null || f === null) return null;
    if (e.schemaName === 'public') return `${t}.${f}`;
    const s = emitIdent(e.schemaName);
    return s === null ? null : `${s}.${t}.${f}`;
  };
  const a = fmt(from);
  const b = fmt(to);
  return a === null || b === null ? null : `Ref: ${a} > ${b}`;
}

/** Display-only summary for the edge popover. */
export function formatRefText(ref: Ref): string {
  const ep = (e: RefEndpoint): string => {
    const table = e.tableId.startsWith('public.') ? e.tableId.slice('public.'.length) : e.tableId;
    const fields = e.fieldNames.length === 1 ? e.fieldNames[0] : `(${e.fieldNames.join(', ')})`;
    return `${table}.${fields}`;
  };
  return `${ep(ref.from)} ${refOperator(ref)} ${ep(ref.to)}`;
}
```

In `src/editor/editorNav.ts`:

1. Add imports:
```ts
import { findRefLine, MIRRORED, type RefOperator } from './refEdit';
import type { Ref } from '../core/model/types';
```
2. In `applyTableSettings`, extend the dispatch (the P6 swatch-history ledger item — an explicit non-input userEvent keeps CodeMirror history from merging canvas edits with adjacent events):
```ts
  view.dispatch({
    changes: { from: range.headerFrom, to: range.headerTo, insert: `${rewritten} ` },
    userEvent: 'canvas.settings',
  });
```
3. Append:
```ts
/** Feature A (canvas→text bridge, second consumer): append a standalone Ref
 *  line at the end of the document. ONE transaction; editor history owns
 *  undo; the parse pipeline renders the new edge ~300 ms later. */
export function appendRefLine(line: string): boolean {
  const view = currentView;
  if (!view) return false;
  const len = view.state.doc.length;
  const prefix = len === 0 || view.state.doc.sliceString(len - 1, len) === '\n' ? '' : '\n';
  view.dispatch({
    changes: { from: len, insert: `${prefix}${line}\n` },
    userEvent: 'canvas.ref',
  });
  return true;
}

/** Rewrite a standalone ref's cardinality operator in place, preserving the
 *  rest of the line (name, settings, spacing) byte-for-byte. False when the
 *  line can't be located (inline/block-form ref) — the popover surfaces it. */
export function applyRefOperator(ref: Ref, op: RefOperator): boolean {
  const view = currentView;
  if (!view) return false;
  const m = findRefLine(view.state.doc.toString(), ref);
  if (!m) return false;
  const written = m.flipped ? MIRRORED[op] : op;
  if (written === m.operator) return true; // no-op: nothing to dispatch
  view.dispatch({
    changes: { from: m.opFrom, to: m.opTo, insert: written },
    userEvent: 'canvas.ref',
  });
  return true;
}

/** Delete a standalone ref's whole line (incl. its trailing newline). */
export function deleteRefLine(ref: Ref): boolean {
  const view = currentView;
  if (!view) return false;
  const m = findRefLine(view.state.doc.toString(), ref);
  if (!m) return false;
  view.dispatch({ changes: { from: m.lineFrom, to: m.lineTo }, userEvent: 'canvas.ref' });
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor` — Expected: PASS (15 new refEdit tests; tableSettings suite green with the rename).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npx vitest run && npx tsc --noEmit && git add -A && git commit -m "feat: refEdit pure locator/builder + editorNav ref bridge (append/operator/delete) + history annotations"
```

---

### Task 6: Feature B — field badges, note dots, SVG-native tooltips

**Files:**
- Create: `src/canvas/fieldMeta.ts`
- Modify: `src/canvas/TableNode.tsx`, `src/styles.css`, `src/app/export/exportCss.ts` (badge styling in exports)
- Test: `src/canvas/fieldMeta.test.ts` (new)

**Interfaces:**
- `fieldMeta.ts` (pure, imports only core types): `fieldBadges(f: Field): string` — compact `NN` (notNull), `U` (unique), `++` (increment), space-joined (pk keeps its existing 🔑 name prefix — not duplicated); `fieldTooltip(f: Field): string | null` — newline-joined note / `default: …` / `enum: a | b | c` lines, null when empty (no `<title>` mounted).
- `TableNode` render additions are PURE — the schema already carries everything (`note`, `defaultValue`, `enumValues` from Task 2); **no new props, the memo contract is untouched.** Each field row gains `className="field-row"`, a full-width transparent hit `<rect>` (tooltip hover target + Task 7's handle hover area; pointer events bubble to the table `<g>`, so drag/click behavior is unchanged), an SVG `<title>` when `fieldTooltip` is non-null, a note dot `<tspan>`, and badges as a leading `<tspan>` inside the right-anchored type text (right-aligned before the type with zero text-measurement code). The header gains a wrapping `<g>` with a `<title>` for `table.note`.
- Layout inside 220 px: name stays left-anchored at x=10, badges+type right-anchored at x=210 — long name/type pairs could already collide before this plan; badges add a few characters to the same accepted ceiling (documented, not new machinery).

- [ ] **Step 1: Write the failing tests**

`src/canvas/fieldMeta.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Field } from '../core/model/types';
import { fieldBadges, fieldTooltip } from './fieldMeta';

const base: Field = {
  name: 'f', type: 'int', pk: false, unique: false, notNull: false,
  increment: false, defaultValue: null, note: null, isEnum: false, enumValues: null,
};

describe('fieldBadges', () => {
  it('emits compact badges in NN U ++ order, empty when unconstrained', () => {
    expect(fieldBadges(base)).toBe('');
    expect(fieldBadges({ ...base, notNull: true })).toBe('NN');
    expect(fieldBadges({ ...base, notNull: true, unique: true, increment: true })).toBe('NN U ++');
  });
});

describe('fieldTooltip', () => {
  it('is null when there is nothing to say', () => {
    expect(fieldTooltip(base)).toBeNull();
  });

  it('stacks note, default, and enum values in that order', () => {
    expect(
      fieldTooltip({
        ...base, note: 'markdown supported', defaultValue: "'draft'",
        isEnum: true, enumValues: ['draft', 'published'],
      }),
    ).toBe("markdown supported\ndefault: 'draft'\nenum: draft | published");
  });

  it('shows a default of empty-string/zero correctly (null check, not truthiness)', () => {
    expect(fieldTooltip({ ...base, defaultValue: '0' })).toBe('default: 0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/canvas/fieldMeta.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/canvas/fieldMeta.ts`:

```ts
import type { Field } from '../core/model/types';

/** Feature B label helpers — pure, unit-tested; TableNode renders the
 *  results. pk is NOT a badge here: the name already carries the 🔑 prefix. */

export function fieldBadges(f: Field): string {
  const out: string[] = [];
  if (f.notNull) out.push('NN');
  if (f.unique) out.push('U');
  if (f.increment) out.push('++');
  return out.join(' ');
}

/** Body for the row's SVG <title> (native tooltip — zero positioning code);
 *  null means "mount no title". defaultValue uses a null check: '0' and ''
 *  are real defaults. */
export function fieldTooltip(f: Field): string | null {
  const lines: string[] = [];
  if (f.note) lines.push(f.note);
  if (f.defaultValue !== null) lines.push(`default: ${f.defaultValue}`);
  if (f.enumValues && f.enumValues.length > 0) lines.push(`enum: ${f.enumValues.join(' | ')}`);
  return lines.length > 0 ? lines.join('\n') : null;
}
```

In `src/canvas/TableNode.tsx`:

1. Add the import: `import { fieldBadges, fieldTooltip } from './fieldMeta';`
2. Replace the header rect + title pair with a wrapped group (table-note tooltip):

```tsx
          <g className="table-header-g">
            {table.note !== null && <title>{table.note}</title>}
            <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} className="table-header" fill={table.headerColor ?? undefined} />
            <text x={10} y={HEADER_HEIGHT / 2} dominantBaseline="central" className="table-title">
              {table.name}
            </text>
          </g>
```

3. Replace the `lod === 'full'` fields map with:

```tsx
          {lod === 'full' &&
            table.fields.map((f, i) => {
              const badges = fieldBadges(f);
              const tip = fieldTooltip(f);
              return (
                <g key={f.name} className="field-row" transform={`translate(0, ${HEADER_HEIGHT + i * ROW_HEIGHT})`}>
                  {tip !== null && <title>{tip}</title>}
                  {/* Full-width transparent hit rect: hover target for the
                      tooltip and (Task 7) the ref handle. Events bubble to
                      the table <g> — drag/click behavior unchanged. */}
                  <rect width={TABLE_WIDTH} height={ROW_HEIGHT} fill="transparent" />
                  <line x1={0} y1={0} x2={TABLE_WIDTH} y2={0} className="row-line" />
                  <text x={10} y={ROW_HEIGHT / 2} dominantBaseline="central" className={`field-name${f.pk ? ' pk' : ''}`}>
                    {f.pk ? '🔑 ' : ''}{f.name}
                    {f.note !== null && <tspan className="field-note-dot"> ●</tspan>}
                  </text>
                  <text x={TABLE_WIDTH - 10} y={ROW_HEIGHT / 2} dominantBaseline="central" textAnchor="end" className="field-type">
                    {badges !== '' && <tspan className="field-badges">{badges} </tspan>}
                    {f.type}
                  </text>
                </g>
              );
            })}
```

4. `src/styles.css` — append:

```css
/* Plan 7 Feature B: field badges + note dots */
.field-badges { font-size: 8px; fill: var(--text-dim); letter-spacing: 0.03em; }
.field-note-dot { font-size: 7px; fill: var(--accent); }
```

5. `src/app/export/exportCss.ts` — append the same two rules to `EXPORT_CSS` (SVG/PNG exports clone the live scene; unstyled badges would render browser-default black at full size):

```css
.field-badges { font-size: 8px; fill: var(--text-dim); letter-spacing: 0.03em; }
.field-note-dot { font-size: 7px; fill: var(--accent); }
```

(Match the file's existing string-building style; `resolveCssVars` already substitutes `--text-dim`/`--accent` — grep `EXPORT_CSS` for the insertion point and confirm both variables appear in existing rules; if `--accent` does not, add it alongside however `--text-dim` is resolved there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/canvas/fieldMeta.test.ts src/app/export` — Expected: PASS (4 new; export CSS tests still green).

- [ ] **Step 5: Full suite, typecheck, browser check, commit**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: starter diagram — `users.username` shows `NN U` before `varchar`; `users.role` shows `NN` and hovering the row shows note-free tooltip with `default: 'member'` + `enum: admin | member`; `posts.body` shows a colored dot after the name and its note in the tooltip; hovering the `users` header shows no tooltip (no table note) — add `Note: 'test'` to a table in the editor and confirm the header tooltip appears; rows still drag/double-click normally; a 220 px row with all three badges + `timestamp` stays readable.

```bash
git add -A && git commit -m "feat: field badges, note dots, svg-native tooltips (fieldMeta helpers)"
```

---

### Task 7: Feature A (part 1) — REF-DRAG: field handle → temp line → append through the bridge

**Files:**
- Create: `src/canvas/refDrag.ts`
- Modify: `src/canvas/TableNode.tsx`, `src/canvas/DiagramCanvas.tsx`, `src/styles.css`
- Test: `src/canvas/refDrag.test.ts` (new)

**Interfaces:**
- `refDrag.ts` (pure, unit-tested): 
  - `fieldDropTarget(schema, positions, hiddenTableIds, pt: Point): DropField | null` with `DropField = { tableId, schemaName, tableName, fieldName }` — the TOPMOST (last in schema order — tables paint in map order) visible positioned table whose rect contains `pt`, resolved to a field row by `floor((pt.y - pos.y - HEADER_HEIGHT) / ROW_HEIGHT)`; the header strip and out-of-range rows return null. **Geometric lookup, not `elementFromPoint`** (justified): pure math over committed state — unit-testable in node, immune to overlays/temp-line/pointer-events interference, and works for CULLED (unmounted but geometrically present) targets, which `elementFromPoint` cannot see.
  - `isDuplicateRef(refs: readonly Ref[], a: FieldRefLite, b: FieldRefLite): boolean` — an existing single-field ref already joins `a↔b` in EITHER direction (dbmlv2 rejects duplicate endpoint pairs as a parse error — the drop must refuse up front rather than manufacture a stale badge).
- `TableNode`: each field row (Task 6 structure) gains a `ref-handle` circle at the row's right edge, CSS-revealed on ROW hover (the gear pattern); `onPointerDown` stops propagation (never a table drag) and calls the new stable prop `onRefDragStart(tableId: string, fieldName: string, e: React.PointerEvent)`. One new referentially-stable prop — memo contract holds.
- `DiagramCanvas` owns the gesture per the ledger rules: `refDragRef` carries the owning `pointerId` + source endpoint + start anchor; **pointer capture goes to the stable `<svg>`** (the handle's row can be unmounted by a mid-gesture parse; the svg cannot), so the existing svg `onPointerMove`/`onPointerUp`/`onPointerCancel` handlers host the new branches; the temp line is a persistent `<line ref={refLineRef}>` beside the guide lines, updated only via `setAttribute` (perf contract — zero React per tick); `e.buttons === 0` bail + the `[positions]` cleanup effect cover ghost gestures; pan capture (`onPointerDownCapture`) and marquee (`onPointerDown`) each early-return while a ref-drag owns the canvas, and vice versa.
- Drop policy (all cancel SILENTLY — temp line removed, nothing written): empty canvas, header strip, hidden/culled-and-hidden table, same source field, duplicate endpoint pair, unrepresentable name (`buildRefLine` null). A valid drop calls `appendRefLine(buildRefLine(from, to))` — ONE transaction; the edge appears when the parse pipeline lands (~300 ms).

- [ ] **Step 1: Write the failing tests**

`src/canvas/refDrag.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDbml } from '../core/parse/parseDbml';
import { HEADER_HEIGHT, ROW_HEIGHT, TABLE_WIDTH } from '../core/model/geometry';
import { fieldDropTarget, isDuplicateRef } from './refDrag';

const schema = (() => {
  const r = parseDbml('Table a { x int \n y int }\nTable b { p int }\nRef: a.x > b.p');
  if (!r.ok) throw new Error('fixture parse failed');
  return r.schema;
})();
const positions = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: 400, y: 0 } };

describe('fieldDropTarget', () => {
  it('resolves a point inside a field row to that field', () => {
    const pt = { x: 10, y: HEADER_HEIGHT + ROW_HEIGHT * 1.5 }; // a's second row
    expect(fieldDropTarget(schema, positions, [], pt)).toEqual({
      tableId: 'public.a', schemaName: 'public', tableName: 'a', fieldName: 'y',
    });
  });

  it('returns null on the header strip, outside all tables, and below the last row', () => {
    expect(fieldDropTarget(schema, positions, [], { x: 10, y: HEADER_HEIGHT / 2 })).toBeNull();
    expect(fieldDropTarget(schema, positions, [], { x: -50, y: 10 })).toBeNull();
    expect(fieldDropTarget(schema, positions, [], { x: 10, y: HEADER_HEIGHT + ROW_HEIGHT * 5 })).toBeNull();
  });

  it('ignores hidden tables and unpositioned tables', () => {
    const pt = { x: 410, y: HEADER_HEIGHT + ROW_HEIGHT / 2 };
    expect(fieldDropTarget(schema, positions, ['public.b'], pt)).toBeNull();
    expect(fieldDropTarget(schema, { 'public.a': positions['public.a'] }, [], pt)).toBeNull();
  });

  it('prefers the TOPMOST table when rects overlap (later in schema order paints on top)', () => {
    const overlapping = { 'public.a': { x: 0, y: 0 }, 'public.b': { x: TABLE_WIDTH / 2, y: 0 } };
    const pt = { x: TABLE_WIDTH / 2 + 10, y: HEADER_HEIGHT + ROW_HEIGHT / 2 };
    expect(fieldDropTarget(schema, overlapping, [], pt)?.tableId).toBe('public.b');
  });
});

describe('isDuplicateRef', () => {
  const A = { tableId: 'public.a', fieldName: 'x' };
  const B = { tableId: 'public.b', fieldName: 'p' };
  it('detects the existing pair in both directions', () => {
    expect(isDuplicateRef(schema.refs, A, B)).toBe(true);
    expect(isDuplicateRef(schema.refs, B, A)).toBe(true);
  });
  it('a different field pair is not a duplicate', () => {
    expect(isDuplicateRef(schema.refs, { tableId: 'public.a', fieldName: 'y' }, B)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/canvas/refDrag.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the pure module**

`src/canvas/refDrag.ts`:

```ts
import type { Point, Ref, Schema, TablePosition } from '../core/model/types';
import { getTableRect, HEADER_HEIGHT, ROW_HEIGHT } from '../core/model/geometry';

/** REF-DRAG drop hit-test (Feature A). GEOMETRIC lookup, not
 *  elementFromPoint: pure math over committed state is unit-testable, immune
 *  to overlay/temp-line pointer-events interference, and sees CULLED targets
 *  (mounted-ness is a render optimization, not a semantic). */

export interface DropField {
  tableId: string;
  schemaName: string;
  tableName: string;
  fieldName: string;
}

export function fieldDropTarget(
  schema: Schema,
  positions: Record<string, TablePosition>,
  hiddenTableIds: readonly string[],
  pt: Point,
): DropField | null {
  const hidden = new Set(hiddenTableIds);
  // Reverse order: tables render in schema order, so the LAST hit paints on top.
  for (let i = schema.tables.length - 1; i >= 0; i--) {
    const t = schema.tables[i];
    const pos = positions[t.id];
    if (!pos || hidden.has(t.id)) continue;
    const r = getTableRect(t, pos);
    if (pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y || pt.y > r.y + r.h) continue;
    const row = Math.floor((pt.y - pos.y - HEADER_HEIGHT) / ROW_HEIGHT);
    if (row < 0 || row >= t.fields.length) return null; // header strip / rounding edge — invalid, and this table occludes anything below
    return { tableId: t.id, schemaName: t.schemaName, tableName: t.name, fieldName: t.fields[row].name };
  }
  return null;
}

export interface FieldRefLite {
  tableId: string;
  fieldName: string;
}

/** dbmlv2 rejects duplicate endpoint pairs (either order) as a parse error —
 *  a drop that would duplicate an existing single-field ref must cancel. */
export function isDuplicateRef(refs: readonly Ref[], a: FieldRefLite, b: FieldRefLite): boolean {
  const matches = (ep: { tableId: string; fieldNames: string[] }, x: FieldRefLite) =>
    ep.tableId === x.tableId && ep.fieldNames.length === 1 && ep.fieldNames[0] === x.fieldName;
  return refs.some(
    (r) => (matches(r.from, a) && matches(r.to, b)) || (matches(r.from, b) && matches(r.to, a)),
  );
}
```

Run: `npx vitest run src/canvas/refDrag.test.ts` — Expected: PASS (6).

- [ ] **Step 4: TableNode — the handle**

In `src/canvas/TableNode.tsx`:

1. Extend `Props` (after `onOpenSettings`):

```ts
  onRefDragStart: (tableId: string, fieldName: string, e: React.PointerEvent) => void; // stable (memo contract) — REF-DRAG hand-off to DiagramCanvas
```

(and add `onRefDragStart` to the destructuring.)

2. Inside the Task 6 field-row `<g>`, after the type `<text>`:

```tsx
                  <circle
                    className="ref-handle"
                    cx={TABLE_WIDTH - 6}
                    cy={ROW_HEIGHT / 2}
                    r={5}
                    onPointerDown={(e) => {
                      // REF-DRAG start: never a table drag. stopPropagation
                      // before the table <g>'s onPointerDown; DiagramCanvas
                      // owns the gesture (capture on the stable <svg>).
                      e.stopPropagation();
                      onRefDragStart(table.id, f.name, e);
                    }}
                  />
```

3. `src/styles.css` — append:

```css
/* Plan 7 Feature A: field-row ref handle (gear-pattern visibility) */
.ref-handle { fill: var(--accent); stroke: var(--bg-elev); stroke-width: 1.5; opacity: 0; cursor: crosshair; }
.field-row:hover .ref-handle { opacity: 1; }
.ref-drag-line { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
```

- [ ] **Step 5: DiagramCanvas — the gesture**

In `src/canvas/DiagramCanvas.tsx`:

1. Imports:

```ts
import { fieldDropTarget, isDuplicateRef, type DropField } from './refDrag';
import { buildRefLine } from '../editor/refEdit';
import { appendRefLine } from '../editor/editorNav';
import { effectiveHiddenIds } from '../core/model/visibility';
import { fieldRowY } from '../core/model/geometry';
```

(merge `fieldRowY` into the existing geometry import; `effectiveHiddenIds` becomes load-bearing canvas-wide in Task 11 — here it already feeds the drop test so collapse composes for free.)

2. Refs, next to `marqueeState`:

```ts
  const refLineRef = useRef<SVGLineElement>(null);
  const refDragRef = useRef<{ pointerId: number; from: DropField } | null>(null);
```

3. Stable start handler, next to `handleOpenSettings`:

```ts
  // REF-DRAG (Feature A): capture on the stable <svg> — a mid-gesture parse
  // can unmount the source row, but the svg outlives it; the svg's own
  // pointer handlers below then own move/drop. Gesture ledger rules apply:
  // pointerId-owned, buttons===0 bail, [positions] cleanup effect.
  const handleRefDragStart = useCallback((tableId: string, fieldName: string, e: React.PointerEvent) => {
    // One canvas gesture at a time — incl. an in-flight TABLE drag (dragRef):
    // a second pointer's handle press must not start a ref-drag mid-move.
    if (refDragRef.current || panRef.current || marqueeState.current || dragRef.current) return;
    const s = useAppStore.getState();
    const table = s.schema.tables.find((t) => t.id === tableId);
    const pos = s.positions[tableId];
    const idx = table?.fields.findIndex((f) => f.name === fieldName) ?? -1;
    if (!table || !pos || idx < 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    refDragRef.current = {
      pointerId: e.pointerId,
      from: { tableId, schemaName: table.schemaName, tableName: table.name, fieldName },
    };
    const x = pos.x + TABLE_WIDTH;
    const y = pos.y + fieldRowY(idx);
    const line = refLineRef.current;
    if (line) {
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(y));
      line.setAttribute('visibility', 'visible');
    }
  }, []);
```

4. Gesture-end helper, below it:

```ts
  const endRefDrag = useCallback((commit: boolean, clientX: number, clientY: number) => {
    const rd = refDragRef.current;
    refDragRef.current = null;
    refLineRef.current?.setAttribute('visibility', 'hidden');
    if (!rd || !commit) return;
    const s = useAppStore.getState();
    const eff = effectiveHiddenIds(s.schema, s.hiddenTableIds, s.collapsedGroupIds);
    const target = fieldDropTarget(s.schema, s.positions, eff, toWorld(clientX, clientY));
    // Every refusal cancels SILENTLY (scope rule): no toast, no text written.
    if (!target) return; // empty canvas / header strip / hidden table
    if (target.tableId === rd.from.tableId && target.fieldName === rd.from.fieldName) return; // dropped on itself
    if (isDuplicateRef(s.schema.refs, { tableId: rd.from.tableId, fieldName: rd.from.fieldName }, target)) return; // dbmlv2 parse-error otherwise
    const line = buildRefLine(rd.from, target);
    if (line !== null) appendRefLine(line); // ONE transaction; the pipeline draws the edge ~300 ms later
  }, []);
  // (toWorld reads refs only — the [] closure stays correct, same as handleMinimapNav.)
```

5. Branch the svg handlers. At the TOP of `onPointerMove`:

```ts
    const rd = refDragRef.current;
    if (rd) {
      if (e.pointerId !== rd.pointerId) return;
      if (e.buttons === 0) { endRefDrag(false, e.clientX, e.clientY); return; } // ghost gesture backstop
      const w = toWorld(e.clientX, e.clientY);
      refLineRef.current?.setAttribute('x2', String(w.x));
      refLineRef.current?.setAttribute('y2', String(w.y));
      return;
    }
```

At the TOP of `onPointerUp`:

```ts
    if (refDragRef.current) {
      if (e.pointerId !== refDragRef.current.pointerId) return;
      endRefDrag(e.type === 'pointerup', e.clientX, e.clientY); // pointercancel → silent cancel
      return;
    }
```

Guard the other gesture starters — first line of `onPointerDownCapture` becomes:

```ts
    if (panRef.current || marqueeState.current || refDragRef.current) return; // a gesture already owns the canvas
```

and the same three-way guard replaces the pan/marquee check in `onPointerDown`.

6. Mid-gesture parse cleanup — extend the existing `[positions]` effect body:

```ts
    if (refDragRef.current && !positions[refDragRef.current.from.tableId]) {
      refDragRef.current = null;
      refLineRef.current?.setAttribute('visibility', 'hidden');
    }
```

7. Render — add the temp line beside the guide lines (inside the scene `<g>`, before the marquee rect):

```tsx
          <line ref={refLineRef} className="ref-drag-line" visibility="hidden" vectorEffect="non-scaling-stroke" />
```

and pass the new prop in the TableNode map (after `onOpenSettings`):

```tsx
                onRefDragStart={handleRefDragStart}
```

- [ ] **Step 6: Verify (unit, typecheck, browser)**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: hover `posts.title` → handle dot appears at the row's right edge; drag it — dashed line follows the pointer with zero React renders (React DevTools highlight off = no flashing); drop on `users.username` → `Ref: posts.title > users.username` appears at the DBML's end, edge renders ~300 ms later, `Cmd+Z` IN THE EDITOR removes it (editor history owns undo); drop on empty canvas / a header / `posts.title` itself → nothing written; drag `posts.user_id` onto `users.id` (existing ref) → silently cancelled; mid-drag Space+click pan does not start; table drag from a NON-handle part of the row still works.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: ref authoring by drag — field handles, imperative temp line, append via the bridge"
```

---

### Task 8: Feature A (part 2) — edge popover: cardinality radios, delete, inline refusal + Reveal

**Files:**
- Create: `src/canvas/EdgeRefPopover.tsx`
- Modify: `src/canvas/EdgeLayer.tsx`, `src/canvas/DiagramCanvas.tsx`, `src/styles.css`

**Interfaces:**
- `EdgeLayer` gains a widened hit target per edge: a SECOND `<path className="edge-hit">` sharing the same `d` (transparent stroke, `stroke-width: 12`, `pointer-events: stroke`, pointer cursor) rendered after the visible path, wired to a new stable prop `onEdgeClick(refId: string, clientX: number, clientY: number)`. A parallel `hitRefs` map keeps the hit path in sync inside the imperative `updateTablePositions` (both paths get the same `setAttribute('d', …)` — the popover hit area cannot drift during a drag).
- `DiagramCanvas` hosts the single popover instance in the HTML layer (the `TableSettingsPopover` host pattern): `const [edgePopover, setEdgePopover] = useState<{ refId: string; x: number; y: number } | null>(null)` — x/y are the click point in WORLD coordinates (via the existing `toWorld`); `EdgeRefPopover` recomputes screen px from the committed `viewport` each render (TableSettingsPopover's formula), so a pan/zoom commit re-syncs its position. Like the settings popover, it holds still during an imperative pan until the gesture-end commit (same accepted ceiling). *(Task-8 review fix: the original screen-px capture never re-synced after a committed pan/zoom.)*
- `EdgeRefPopover({ refId, x, y, onClose })`: looks the ref up by id in the last-good schema each render and CLOSES when it vanishes (parse deleted it / diagram switched — the TableSettingsPopover lifecycle rule). Ref ids are `ref-${index}-${fromId}-${toId}` — an operator swap keeps index and endpoint tables, so the SAME popover stays open across its own edit and the radio re-checks from the fresh parse.
  - Standalone ref: shows `formatRefText(ref)`, four cardinality radios (`<` one-to-many, `>` many-to-one, `-` one-to-one, `<>` many-to-many; checked = `refOperator(ref)`), and **Delete ref**. Radio change → `applyRefOperator(ref, op)`; Delete → `deleteRefLine(ref)` then close. Both are TEXT edits via the bridge; a `false` return (line unlocatable — e.g. the block form `Ref { … }`) surfaces as an inline error line, never a silent no-op.
  - `ref.inline === true` (Task 2's flag): radios and Delete are NOT rendered; the popover shows *"Defined inline — edit it in the DBML."* with a **Reveal** button → `revealPosition(ref.pos.line, ref.pos.column)` (the token start — chosen over `revealTable` because normalized endpoint order does NOT identify the defining table for inline refs, per Verified facts; falls back to `revealTable(ref.from.tableId)` when `pos` is null) and closes.
  - Escape via `useOverlayEscape`; outside-pointerdown closes (component-local, per Task 4's rule).

- [ ] **Step 1: EdgeLayer — hit paths + click prop**

In `src/canvas/EdgeLayer.tsx`:

1. Extend the props:

```ts
interface EdgeLayerProps {
  viewRect: Rect | null;
  onEdgeClick: (refId: string, clientX: number, clientY: number) => void; // stable (DiagramCanvas useCallback)
}
```

(and add `onEdgeClick` to the destructuring in the `forwardRef` render function.)

2. Add the parallel ref map, next to `pathRefs`:

```ts
  const hitRefs = useRef(new Map<string, SVGPathElement>());
```

3. In `updateTablePositions`, replace the path write with BOTH writes:

```ts
        if (p) {
          pathRefs.current.get(spec.id)?.setAttribute('d', p.d);
          hitRefs.current.get(spec.id)?.setAttribute('d', p.d); // popover hit area tracks the drag
        }
```

4. In the render, after the visible `<path …/>` inside the edge `<g>`, add:

```tsx
            <path
              className="edge-hit"
              d={p.d}
              ref={(el) => { if (el) hitRefs.current.set(spec.id, el); else hitRefs.current.delete(spec.id); }}
              onClick={(e) => onEdgeClick(spec.id, e.clientX, e.clientY)}
            />
```

(EdgeLayer re-renders on committed changes only; a per-edge closure here costs nothing per tick — the perf contract concerns the imperative paths, which receive only `setAttribute` writes.)

5. `src/styles.css` — append:

```css
/* Plan 7 Feature A: widened edge hit target + popover.
   Selector must be .edge .edge-hit (0-2-0): the pre-existing `.edge path`
   rule is 0-1-1 and would otherwise win, rendering the hit target 1.5px
   colored instead of 12px transparent. (Task-8 review fix.) */
.edge .edge-hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; cursor: pointer; }
```

- [ ] **Step 2: The popover component**

`src/canvas/EdgeRefPopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { useOverlayEscape } from '../app/overlayStack';
import { applyRefOperator, deleteRefLine, revealPosition, revealTable } from '../editor/editorNav';
import { formatRefText, refOperator, type RefOperator } from '../editor/refEdit';

const OPERATORS: Array<{ op: RefOperator; label: string }> = [
  { op: '<', label: 'one-to-many' },
  { op: '>', label: 'many-to-one' },
  { op: '-', label: 'one-to-one' },
  { op: '<>', label: 'many-to-many' },
];

interface Props {
  refId: string;
  x: number; // click point in WORLD coordinates — screen px are recomputed
  y: number; // from the committed viewport each render, so a pan/zoom commit
  onClose: () => void; // re-syncs the popover (TableSettingsPopover's pattern)
}

/** Edge popover (Feature A). CRITICAL architecture rule: every mutation is a
 *  TEXT edit through editorNav (applyRefOperator/deleteRefLine — one
 *  CodeMirror transaction; editor history owns undo; the parse pipeline
 *  repaints ~300 ms later). This component never writes schema state.
 *  Inline-defined refs are REFUSED with a Reveal jump — there is no
 *  standalone line to rewrite, and rewriting field settings is out of scope. */
export function EdgeRefPopover({ refId, x, y, onClose }: Props) {
  const ref = useAppStore((s) => s.schema.refs.find((r) => r.id === refId));
  const viewport = useAppStore((s) => s.viewport);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The ref can vanish under us: a parse removed it, our own Delete landed,
  // or the diagram switched. Close instead of orphaning.
  useEffect(() => {
    if (!ref) onClose();
  }, [ref, onClose]);

  useOverlayEscape(true, onClose);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);

  if (!ref) return null;

  const current = refOperator(ref);
  const setOp = (op: RefOperator) => {
    setErr(applyRefOperator(ref, op) ? null : "Couldn't locate this ref's line — edit it in the DBML.");
  };
  const del = () => {
    if (deleteRefLine(ref)) onClose();
    else setErr("Couldn't locate this ref's line — edit it in the DBML.");
  };
  const reveal = () => {
    if (ref.pos) revealPosition(ref.pos.line, ref.pos.column);
    else revealTable(ref.from.tableId); // no token info — land near one endpoint
    onClose();
  };

  return (
    <div
      ref={rootRef}
      className="edge-popover"
      style={{
        left: viewport.x + x * viewport.zoom + 8,
        top: viewport.y + y * viewport.zoom + 8,
      }}
    >
      <div className="ep-title">{formatRefText(ref)}</div>
      {ref.inline ? (
        <>
          <div className="ep-inline-note">Defined inline — edit it in the DBML.</div>
          <button className="ep-reveal" onClick={reveal}>Reveal</button>
        </>
      ) : (
        <>
          <div className="ep-ops" role="radiogroup" aria-label="Cardinality">
            {OPERATORS.map(({ op, label }) => (
              <label key={op} title={label} className="ep-op">
                <input
                  type="radio"
                  name="ref-cardinality"
                  checked={current === op}
                  onChange={() => setOp(op)}
                />
                <span className="ep-op-glyph">{op}</span>
              </label>
            ))}
          </div>
          <button className="ep-delete" onClick={del}>Delete ref</button>
        </>
      )}
      {err !== null && <div className="ep-error">{err}</div>}
    </div>
  );
}
```

- [ ] **Step 3: DiagramCanvas wiring**

In `src/canvas/DiagramCanvas.tsx`:

1. Imports: `import { EdgeRefPopover } from './EdgeRefPopover';`
2. State, next to `settingsTableId`:

```ts
  const [edgePopover, setEdgePopover] = useState<{ refId: string; x: number; y: number } | null>(null);
```

3. Stable handlers, next to `handleOpenSettings` (world coords via the existing `toWorld`; it reads refs only, so the `[]` closure stays correct — same as `endRefDrag`):

```ts
  const handleEdgeClick = useCallback((refId: string, clientX: number, clientY: number) => {
    const w = toWorld(clientX, clientY);
    setEdgePopover({ refId, x: w.x, y: w.y });
  }, []);
  const closeEdgePopover = useCallback(() => setEdgePopover(null), []);
```

4. Pass `onEdgeClick={handleEdgeClick}` to `<EdgeLayer …>` and render next to the settings popover:

```tsx
      {edgePopover && (
        <EdgeRefPopover refId={edgePopover.refId} x={edgePopover.x} y={edgePopover.y} onClose={closeEdgePopover} />
      )}
```

5. `src/styles.css` — append:

```css
.edge-popover {
  position: absolute; z-index: 25; min-width: 200px; max-width: 260px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16); padding: 10px; font-size: 12px; color: var(--text);
}
.ep-title { font-family: ui-monospace, monospace; font-size: 11px; margin-bottom: 8px; word-break: break-all; }
.ep-ops { display: flex; gap: 10px; margin-bottom: 8px; }
.ep-op { display: flex; align-items: center; gap: 3px; cursor: pointer; }
.ep-op-glyph { font-family: ui-monospace, monospace; font-weight: 600; }
.ep-delete { border: 1px solid var(--border); background: none; color: var(--error); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
.ep-inline-note { color: var(--text-dim); margin-bottom: 8px; }
.ep-reveal { border: 1px solid var(--border); background: none; color: var(--text); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
.ep-error { color: var(--error); margin-top: 6px; }
```

- [ ] **Step 4: Verify (unit, typecheck, browser)**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: click near (not exactly on) the `posts→users` edge — the 12 px hit stroke opens the popover reading `posts.user_id > users.id` with `>` checked; pick `<` → the DBML line flips to `Ref: posts.user_id < users.id`, the edge's cardinality labels swap after the parse, the popover STAYS OPEN with `<` now checked; editor Cmd+Z reverts it (one undo step); Delete ref → the line vanishes, edge count drops, popover closes; add `Table x { a_id int [ref: > users.id] }` → click that new edge → "Defined inline" + Reveal jumps the editor to the `[ref:` settings, no radios; Escape closes the popover WITHOUT clearing the canvas selection (overlay stack); drag a table while the popover is open → the hit path tracks the edge (click it again where it lands).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: edge popover — cardinality/delete as text edits, inline refusal with reveal"
```

---

### Task 9: Feature C — highlight/trace mode

**Files:**
- Modify: `src/app/store.ts` (no new fields — Task 3 added them; only this note), `src/canvas/DiagramCanvas.tsx`, `src/canvas/TableNode.tsx`, `src/canvas/EdgeLayer.tsx`, `src/canvas/CanvasControls.tsx`, `src/styles.css`

**Interfaces:**
- CanvasControls gains a trace toggle button (crosshair/target inline SVG, `aria-label="Toggle highlight mode"`, `aria-pressed`) wired to `setTraceEnabled` (Task 3: turning off clears the highlight).
- Click semantics: `handleCommitMove`'s CLICK branch (a gesture under the 3 px threshold) additionally sets `highlightTableId` when trace is on — selection still happens (dimming is visual only, composes with selection); the marquee's click-on-empty branch clears the highlight; the Escape last-resort clears highlight alongside selection.
- Dim computation: ONE memo in DiagramCanvas keyed `[schema.refs, highlightTableId, traceEnabled]` producing `keepSet: Set<string> | null` (highlighted table + 1-hop ref neighbors; null = trace inactive → nothing dims). `TableNode` gains a `dimmed: boolean` prop (memo contract: a boolean); `EdgeLayer` derives per-edge dimming from its own two subscribed fields (an edge stays lit iff it TOUCHES the highlighted table; an edge between two neighbors that bypasses the hub dims — that is what "trace THIS table" means). Dimming is a CSS class (`opacity`), applied where tables/edges already render — render-time only, zero per-tick work. Groups and sticky notes deliberately do not dim (out of the named scope; visual noise is low since edges/tables carry the trace).

- [ ] **Step 1: CanvasControls toggle**

In `src/canvas/CanvasControls.tsx`, add the store wires next to the snap ones:

```ts
  const traceEnabled = useAppStore((s) => s.traceEnabled);
  const setTraceEnabled = useAppStore((s) => s.setTraceEnabled);
```

and the button after the snap button:

```tsx
      <button
        aria-pressed={traceEnabled}
        className={traceEnabled ? 'active' : ''}
        aria-label="Toggle highlight mode"
        title={traceEnabled ? 'Highlight mode: on — click a table to trace its refs' : 'Highlight mode: off'}
        onClick={() => setTraceEnabled(!traceEnabled)}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
```

- [ ] **Step 2: DiagramCanvas — memo + click wiring**

1. Subscriptions, next to `hiddenTableIds`:

```ts
  const traceEnabled = useAppStore((s) => s.traceEnabled);
  const highlightTableId = useAppStore((s) => s.highlightTableId);
  // Feature C: the KEEP set (highlight + 1-hop neighbors), render-time memo
  // — recomputed only when refs/highlight change, never on the pan/drag paths.
  const keepSet = useMemo(() => {
    if (!traceEnabled || highlightTableId === null) return null;
    const keep = new Set([highlightTableId]);
    for (const r of schema.refs) {
      if (r.from.tableId === highlightTableId) keep.add(r.to.tableId);
      if (r.to.tableId === highlightTableId) keep.add(r.from.tableId);
    }
    return keep;
  }, [schema.refs, highlightTableId, traceEnabled]);
```

(add `schema.refs` via the existing `schema` subscription — write the dep exactly as `[schema, highlightTableId, traceEnabled]` if the lint setup complains about a property dep; the memo body reads `schema.refs` either way.)

2. `handleCommitMove` — in the `!drag || !drag.moved` click branch, after `store.setSelectedTables([id]);`:

```ts
      if (store.traceEnabled) store.setHighlightTable(id); // dimming composes with selection
```

3. Marquee click-on-empty (`onPointerUp`, the `sel.w < minSize` branch), after `store.setSelectedTables([]);`:

```ts
      if (store.highlightTableId !== null) store.setHighlightTable(null);
```

4. Escape last-resort (the Task 4 block), after `setSelectedTables([])`:

```ts
        useAppStore.getState().setHighlightTable(null);
```

5. TableNode map — pass the boolean (after `selected={…}`):

```tsx
                dimmed={keepSet !== null && !keepSet.has(t.id)}
```

- [ ] **Step 3: TableNode + EdgeLayer + CSS**

1. `TableNode` props gain `dimmed: boolean;` (destructure it) and the root `<g>` className becomes:

```tsx
      className={`table-node${focused ? ' focused' : ''}${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
```

2. `EdgeLayer` — subscribe next to `hoveredTableId`:

```ts
  const traceEnabled = useAppStore((s) => s.traceEnabled);
  const highlightTableId = useAppStore((s) => s.highlightTableId);
```

and in the edge `<g>`'s class computation, after `hot`:

```ts
        const dimmed =
          traceEnabled && highlightTableId !== null &&
          spec.fromTableId !== highlightTableId && spec.toTableId !== highlightTableId;
```

```tsx
          <g key={spec.id} className={`edge${hot ? ' hot' : ''}${dimmed ? ' dimmed' : ''}`}>
```

3. `src/styles.css` — append:

```css
/* Plan 7 Feature C: highlight/trace dimming (visual only — selection, drag,
   and hit-testing are unaffected; hidden ≠ dimmed) */
.table-node.dimmed, .edge.dimmed { opacity: 0.15; transition: opacity 0.15s ease; }
```

- [ ] **Step 4: Verify (unit, typecheck, browser)**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: toggle trace on → click `users` — with the starter triangle nothing dims (all three tables touch users; the edges between posts↔comments DO dim — they bypass the hub); add `Table isolated { id int }` → it dims; click `isolated` → everything else dims, its zero edges keep their state trivially; a dimmed table still drags, selects, opens its gear; click empty canvas → dim clears, selection clears; Escape (no overlays open) → same; toggle off → dim clears; switch diagrams → highlight gone (loadDiagram), trace toggle still on (session).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: highlight/trace mode — 1-hop dimming, controls toggle, click/escape wiring"
```

---

### Task 10: Feature D — canvas quick-search (Cmd/Ctrl+K + magnifier)

**Files:**
- Create: `src/canvas/QuickSearch.tsx`
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/canvas/CanvasControls.tsx`, `src/styles.css`

**Interfaces:**
- **Binding decision (global, cited):** Cmd/Ctrl+K opens the palette even while the editor is focused — dbdiagram-style. Safe because the installed `@codemirror/commands` binds `Shift-Mod-k` (deleteLine) and, on macOS only, `Ctrl-k` (emacs deleteToLineEnd) — **plain `Mod-k` appears in no keymap array** (Verified facts), so the window listener shadows nothing. It `preventDefault()`s to beat browser defaults. The listener is a separate effect from the canvas keyboard effect, which deliberately IGNORES editor-focused events — quick-search must not.
- `QuickSearch({ onClose })` — centered palette in `.canvas-wrap`'s HTML layer: autofocused input, live match list (case-insensitive substring on `name` and `schemaName.name`, first 8), ArrowUp/Down + Enter, click. Choosing a table: un-hides it if explicitly hidden (`setHiddenTables` minus id), expands any collapsed group containing it (`setCollapsedGroups` minus those groups — composes with Task 11's Feature E), then `centerOnTable(id)` (existing canvasNav handle — it already flashes the focus outline). Escape closes via the overlay stack; backdrop click closes.
- CanvasControls gains a magnifier button wired to a new `onOpenSearch: () => void` prop (CanvasControls is not memoized — a plain prop is fine; DiagramCanvas passes a stable callback anyway).

- [ ] **Step 1: The palette component**

`src/canvas/QuickSearch.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useAppStore } from '../app/store';
import { useOverlayEscape } from '../app/overlayStack';
import { centerOnTable } from './canvasNav';

const MAX_MATCHES = 8;

/** Cmd/Ctrl+K quick-search (Feature D). Pure session UI: choosing a table
 *  writes only view state (unhide/expand) and navigates — never DBML. */
export function QuickSearch({ onClose }: { onClose: () => void }) {
  const tables = useAppStore((s) => s.schema.tables);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);

  useOverlayEscape(true, onClose);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return tables.slice(0, MAX_MATCHES);
    return tables
      .filter((t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [tables, query]);
  const sel = Math.min(idx, Math.max(matches.length - 1, 0));

  const choose = (tableId: string) => {
    const s = useAppStore.getState();
    if (s.hiddenTableIds.includes(tableId)) {
      s.setHiddenTables(s.hiddenTableIds.filter((id) => id !== tableId)); // "show me this table"
    }
    const collapsedHiding = s.schema.groups
      .filter((g) => s.collapsedGroupIds.includes(g.id) && g.tableIds.includes(tableId))
      .map((g) => g.id);
    if (collapsedHiding.length > 0) {
      s.setCollapsedGroups(s.collapsedGroupIds.filter((id) => !collapsedHiding.includes(id)));
    }
    centerOnTable(tableId); // centers at the current zoom + flashes the focus outline
    onClose();
  };

  return (
    <div className="qs-backdrop" onPointerDown={onClose}>
      <div className="qs-panel" onPointerDown={(e) => e.stopPropagation()}>
        <input
          className="qs-input"
          autoFocus
          placeholder="Jump to table…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((v) => Math.min(v + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter' && matches[sel]) choose(matches[sel].id);
          }}
        />
        <ul className="qs-list">
          {matches.map((t, i) => (
            <li key={t.id}>
              <button className={i === sel ? 'qs-item active' : 'qs-item'} onClick={() => choose(t.id)}>
                <span className="qs-name">{t.name}</span>
                <span className="qs-schema">{t.schemaName}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="qs-empty">No tables match.</li>}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DiagramCanvas + CanvasControls wiring**

1. `DiagramCanvas.tsx` — import `QuickSearch`; state next to `edgePopover`:

```ts
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
```

a dedicated effect (NOT inside the canvas keyboard effect — that one skips editor-focused events; this binding is global by decision, see Interfaces):

```ts
  // Cmd/Ctrl+K quick-search — global, incl. while the editor is focused:
  // CodeMirror binds Shift-Mod-k and mac Ctrl-k, never plain Mod-k (verified
  // against the installed @codemirror/commands — plan Verified facts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        // Gate (decision): not while the dashboard or import dialog is up —
        // a canvas palette opening over a full-screen modal is noise.
        if (document.querySelector('.dialog, .dashboard')) return;
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

render, next to the popovers: `{searchOpen && <QuickSearch onClose={closeSearch} />}` and pass `<CanvasControls onOpenSearch={openSearch} />`.

2. `CanvasControls.tsx` — props become `{ onOpenSearch }: { onOpenSearch: () => void }`; append the new binding to the hand-maintained `SHORTCUTS` list (its comment says "updated by hand when a shortcut changes" — this is that):

```ts
  ['Ctrl/Cmd + K', 'Find table'],
```

and add the magnifier button before the `?` button:

```tsx
      <button aria-label="Find table" title="Find table (Ctrl/Cmd+K)" onClick={onOpenSearch}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
```

3. `src/styles.css` — append:

```css
/* Plan 7 Feature D: quick-search palette */
.qs-backdrop { position: absolute; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.18); display: flex; justify-content: center; align-items: flex-start; }
.qs-panel {
  margin-top: 10vh; width: min(420px, calc(100% - 32px));
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); padding: 8px;
}
.qs-input {
  width: 100%; box-sizing: border-box; font-size: 14px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);
}
.qs-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 40vh; overflow-y: auto; }
.qs-item { display: flex; width: 100%; justify-content: space-between; gap: 8px; border: none; background: none; color: var(--text); padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.qs-item.active, .qs-item:hover { background: var(--selection-bg); }
.qs-schema { color: var(--text-dim); font-size: 11px; }
.qs-empty { color: var(--text-dim); padding: 8px 10px; font-size: 12px; }
```

- [ ] **Step 3: Verify (unit, typecheck, browser)**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: Cmd/Ctrl+K with the CURSOR IN THE EDITOR opens the palette (and deletes no line — the CM binding check); type `po` → `posts` listed; Enter → viewport centers on posts, outline flashes ~1.5 s; hide `comments` in the Views sidebar → Cmd+K, `com`, Enter → comments UN-hides, centers, flashes; magnifier button opens the same palette; Escape closes it (topmost only — selection intact); ArrowDown/Up walk the list.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: canvas quick-search — global cmd/ctrl+k palette + magnifier button"
```

---

### Task 11: Feature E — group collapse: pill, chevrons, effective-hidden consumers, sidebar semantics

**Files:**
- Modify: `src/canvas/GroupLayer.tsx`, `src/canvas/DiagramCanvas.tsx`, `src/canvas/EdgeLayer.tsx`, `src/canvas/MiniMap.tsx`, `src/canvas/DiagramViewsSidebar.tsx`, `src/app/ExportMenu.tsx`, `src/app/export/svgExport.ts`, `src/styles.css`

**Interfaces:**
- Every visibility consumer switches from raw `hiddenTableIds` to `effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds)` (Task 3) — **derived at the existing memoized filter spots** (DiagramCanvas render memo, EdgeLayer `specs` memo, MiniMap `items` memo) and computed once per gesture/action on the `getState()` sites (`handleLiveMove`'s drag start, marquee release, `fit`, `autoLayout`, `endRefDrag` — already effective from Task 7, `buildDiagramSvg`, ExportMenu's `imageDisabled`). The per-tick imperative paths never see it: hidden/collapsed tables are simply not mounted. `hiddenTableIds` is NEVER mutated by collapse (derive, don't write).
- `GroupLayer`: expanded groups render as today (rect from `omitHidden(positions, effectiveHidden)` — a member collapsed away by a DIFFERENT overlapping group shrinks this group's rect too) plus a chevron button (`.group-collapse`, `▾`) on the header. Collapsed groups render a compact PILL (`GROUP_PILL_W×GROUP_PILL_H`, local constants 200×36) anchored at the top-left of the member-positions bbox computed from `omitHidden(positions, hiddenTableIds)` — EXPLICIT hides only, deliberately not the effective set: the collapsed members' own membership must not null the rect; positions persist while hidden, so `computeGroupRect` works. Pill shows `▸ name (memberCount)`; the whole pill is the drag header (same `startDrag(g.tableIds)` — moving a collapsed group moves its members' stored positions); the chevron toggles via `setCollapsedGroups`. A collapsed group whose members are ALL explicitly hidden has no rect → no pill (documented; the sidebar still lists them).
- Edges touching a collapsed member disappear (they're in the effective hidden set) — the **accepted divergence** from dbdiagram's edge-redirect-to-pill, stated in the plan header.
- Sidebar semantics (simplest coherent, specified): a row whose table is hidden **by collapse** shows the eye OFF and DISABLED with `title="Hidden by collapsed group — expand it on the canvas"`; explicit hides keep the normal toggle; the schema `visibleCount` counts EFFECTIVE visibility (what the canvas shows); the schema eye and "All" keep operating on explicit `hiddenTableIds` only.

- [ ] **Step 1: GroupLayer**

Replace the body of `src/canvas/GroupLayer.tsx`'s render logic with (imports first):

```ts
import { effectiveHiddenIds } from '../core/model/visibility';
```

inside the component, after the existing `hiddenTableIds` subscription:

```ts
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const collapsedSet = useMemo(() => new Set(collapsedGroupIds), [collapsedGroupIds]);
  // Expanded rects hug members visible on the CANVAS (explicit hides ∪ other
  // groups' collapses); pill rects use EXPLICIT hides only — a collapsed
  // group's own members must not null its rect (positions persist).
  const effectiveHidden = useMemo(
    () => effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds),
    [schema, hiddenTableIds, collapsedGroupIds],
  );
  const visPositions = useMemo(() => omitHidden(positions, effectiveHidden), [positions, effectiveHidden]);
  const pillPositions = useMemo(() => omitHidden(positions, hiddenTableIds), [positions, hiddenTableIds]);

  const toggleCollapse = (groupId: string) => {
    const cur = useAppStore.getState().collapsedGroupIds;
    useAppStore.getState().setCollapsedGroups(
      cur.includes(groupId) ? cur.filter((id) => id !== groupId) : [...cur, groupId],
    );
  };
```

(No subscription to the ACTION — actions are stable; the `collapsedGroupIds` subscription is what re-renders this layer when quick-search expands a group externally.)

local constants above the component:

```ts
const GROUP_PILL_W = 200;
const GROUP_PILL_H = 36;
```

and the per-group render becomes:

```tsx
      {schema.groups.map((g) => {
        const collapsed = collapsedSet.has(g.id);
        const rect = computeGroupRect(g, schema, collapsed ? pillPositions : visPositions);
        if (!rect) return null;
        const color = g.color ?? 'var(--table-header)';
        if (collapsed) {
          return (
            <g key={g.id} className="table-group collapsed">
              <g
                className="group-header"
                onPointerDown={startDrag(g.tableIds)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onLostPointerCapture={onPointerUp}
              >
                <rect className="group-pill" x={rect.x} y={rect.y} width={GROUP_PILL_W} height={GROUP_PILL_H} rx={8} stroke={color} fill={color} />
                <text x={rect.x + 30} y={rect.y + GROUP_PILL_H / 2} dominantBaseline="central" className="group-title">
                  {g.name} ({g.tableIds.length})
                </text>
              </g>
              <g
                className="group-collapse"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleCollapse(g.id)}
              >
                <rect x={rect.x + 6} y={rect.y + GROUP_PILL_H / 2 - 8} width={16} height={16} rx={3} className="group-collapse-bg" />
                <text x={rect.x + 14} y={rect.y + GROUP_PILL_H / 2} textAnchor="middle" dominantBaseline="central" className="group-collapse-glyph">▸</text>
              </g>
            </g>
          );
        }
        return (
          <g key={g.id} className="table-group">
            <rect className="group-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={8} stroke={color} fill={color} />
            <g
              className="group-header"
              onPointerDown={startDrag(g.tableIds)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onLostPointerCapture={onPointerUp}
            >
              <rect x={rect.x} y={rect.y} width={rect.w} height={GROUP_HEADER_HEIGHT} rx={8} fill={color} fillOpacity={0.18} />
              <circle cx={rect.x + 12} cy={rect.y + GROUP_HEADER_HEIGHT / 2} r={5} fill={color} />
              <text x={rect.x + 24} y={rect.y + GROUP_HEADER_HEIGHT / 2} dominantBaseline="central" className="group-title">
                {g.name}
              </text>
            </g>
            <g
              className="group-collapse"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => toggleCollapse(g.id)}
            >
              <rect x={rect.x + rect.w - 22} y={rect.y + GROUP_HEADER_HEIGHT / 2 - 8} width={16} height={16} rx={3} className="group-collapse-bg" />
              <text x={rect.x + rect.w - 14} y={rect.y + GROUP_HEADER_HEIGHT / 2} textAnchor="middle" dominantBaseline="central" className="group-collapse-glyph">▾</text>
            </g>
          </g>
        );
      })}
```

(`useMemo` joins the react import. The drag handlers are untouched — a pill drag IS a group drag.)

CSS — append:

```css
/* Plan 7 Feature E: collapsed-group pill + chevrons */
.group-pill { fill-opacity: 0.22; stroke-width: 1.5; cursor: grab; }
.group-collapse { cursor: pointer; }
.group-collapse-bg { fill: var(--bg-elev); stroke: var(--border); }
.group-collapse-glyph { font-size: 10px; fill: var(--text); user-select: none; }
```

- [ ] **Step 2: Switch every consumer to the effective set**

1. `DiagramCanvas.tsx` — after the `hiddenTableIds` subscription, replace the `hiddenSet` memo with:

```ts
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  // Committed-state filter (perf contract): the EFFECTIVE hidden set
  // (explicit ∪ collapsed-group members), derived here once per committed
  // render — the imperative pan/drag paths never see it because hidden
  // tables/edges are simply not mounted.
  const effectiveHidden = useMemo(
    () => effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds),
    [schema, hiddenTableIds, collapsedGroupIds],
  );
  const hiddenSet = useMemo(() => new Set(effectiveHidden), [effectiveHidden]);
```

and update the four `getState()` sites to derive once per gesture/action (each currently reads `s.hiddenTableIds` / destructures `hiddenTableIds: hid`):
- `handleLiveMove` drag-start `otherRects`: `visibleTableRects(s.schema, s.positions, effectiveHiddenIds(s.schema, s.hiddenTableIds, s.collapsedGroupIds))` — once per drag START, never per tick.
- marquee release (`onPointerUp`): the `items` line becomes `visibleTableRects(store.schema, store.positions, effectiveHiddenIds(store.schema, store.hiddenTableIds, store.collapsedGroupIds))`.
- `fit()` — complete replacement:
```ts
  const fit = () => {
    const { schema, positions, hiddenTableIds, collapsedGroupIds } = useAppStore.getState();
    const rects = visibleTableRects(schema, positions, effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds)).map((x) => x.rect);
    const rect = svgRef.current!.getBoundingClientRect();
    useAppStore.getState().setViewport(fitViewport(rects, rect.width, rect.height));
  };
```
- `autoLayout()` — the destructure becomes `const { schema, hiddenTableIds, collapsedGroupIds } = useAppStore.getState();` and the layout call becomes `const next = await runElkLayout(schema, [...effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds)]);` (collapsed members keep their positions exactly like hidden ones — `elkResultToPositions` returns only laid-out children).

2. `EdgeLayer.tsx` — the `specs` memo:

```ts
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const specs = useMemo(() => {
    const hidden = new Set(effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds));
    return buildEdgeSpecs(schema).filter(
      (sp) => !hidden.has(sp.fromTableId) && !hidden.has(sp.toTableId),
    );
  }, [schema, hiddenTableIds, collapsedGroupIds]);
```

(+ the import. Edges to collapsed members are hidden — the documented accepted divergence.)

3. `MiniMap.tsx` — same shape in its `items` memo (+ subscription + import): `const hidden = new Set(effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds));`.

4. `ExportMenu.tsx` — replace the `hiddenCount` line with:

```ts
  const schema = useAppStore((s) => s.schema);
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const hiddenCount = effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds).length;
```

(keep `tableCount` from `schema.tables.length`; add the visibility import. Menu renders rarely — no memo needed.)

5. `svgExport.ts` — in `buildDiagramSvg`, replace the bounds call with:

```ts
  const { schema, positions, notePositions, hiddenTableIds, collapsedGroupIds } = useAppStore.getState();
  const bounds = computeExportBounds(
    schema, positions, notePositions,
    effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds),
  );
```

(+ import. The cloned scene already lacks collapsed members — they are unmounted; the PILL is cloned and EXPORT_CSS gets the pill rules — append the `.group-pill`/`.group-collapse-*` rules from Step 1 to `EXPORT_CSS` too, so exports of a collapsed diagram render the pill styled.)

- [ ] **Step 3: Sidebar semantics**

In `src/canvas/DiagramViewsSidebar.tsx`:

add subscriptions after the existing ones (the `groups`-by-schema memo already in the file is untouched):

```ts
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const schemaGroups = useAppStore((s) => s.schema.groups);
  // tableId → collapsed group name (first wins) — rows hidden BY COLLAPSE
  // show a disabled eye: the eye edits hiddenTableIds, and flipping that
  // would do nothing visible while the group stays collapsed.
  const collapsedBy = useMemo(() => {
    const collapsed = new Set(collapsedGroupIds);
    const m = new Map<string, string>();
    for (const g of schemaGroups) {
      if (!collapsed.has(g.id)) continue;
      for (const id of g.tableIds) if (!m.has(id)) m.set(id, g.name);
    }
    return m;
  }, [collapsedGroupIds, schemaGroups]);
```

- `visibleCount` switches to effective: `members.filter((t) => !hidden.has(t.id) && !collapsedBy.has(t.id)).length`.
- `centerOn` mirrors QuickSearch's `choose()` (decision: expand-then-center — "show me this table" wins over the collapse, exactly like it already wins over an explicit hide). Replace the existing function with:

```ts
  const centerOn = (id: string) => {
    if (hidden.has(id)) setHiddenTables(hiddenTableIds.filter((h) => h !== id));
    if (collapsedBy.has(id)) {
      const s = useAppStore.getState();
      s.setCollapsedGroups(
        s.collapsedGroupIds.filter(
          (gid) => !s.schema.groups.some((g) => g.id === gid && g.tableIds.includes(id)),
        ),
      );
    }
    centerOnTable(id);
  };
```
- The per-table eye button becomes:

```tsx
                  {collapsedBy.has(t.id) ? (
                    <button
                      className="views-eye"
                      aria-label="Toggle visibility"
                      disabled
                      title={`Hidden by collapsed group "${collapsedBy.get(t.id)}" — expand it on the canvas`}
                    >
                      <EyeIcon off />
                    </button>
                  ) : (
                    <button className="views-eye" aria-label="Toggle visibility" onClick={() => toggleTable(t.id)}>
                      <EyeIcon off={hidden.has(t.id)} />
                    </button>
                  )}
```

- CSS: `.views-eye:disabled { opacity: 0.5; cursor: not-allowed; }` (append).

- [ ] **Step 4: Verify (unit, typecheck, browser)**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: add a group to the starter — `TableGroup g1 {` newline `users` newline `posts` newline `}` (NOTE: single-line multi-member TableGroup is a PARSE ERROR on 8.3.1, code 3017 — members must be newline-separated) → chevron on the group header; collapse → users+posts unmount, pill `▸ g1 (2)` at the old bbox top-left, ALL starter edges disappear (each touches users/posts — comments' edges too: accepted divergence), minimap loses both rects, fit frames comments+pill area, marquee can't select collapsed members; drag the pill → expand → members moved together (stored positions traveled); Views sidebar: users/posts rows show disabled eyes with the group hint, `public 1/3`; quick-search `users` + Enter → group expands + centers; export SVG while collapsed → pill + comments only, bounds hug them; ELK auto-layout while collapsed → only comments moves; reload → still collapsed (Task 3 threading); expand → exactly as before.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: group collapse — pill + chevrons, effective-hidden consumers, sidebar hidden-by-group"
```

---

### Task 12: Feature F chrome — undo/redo toolbar buttons, <800 px clip fix, perf warmup, sample diagram

**Files:**
- Modify: `src/canvas/CanvasControls.tsx`, `src/styles.css`, `e2e/perf.spec.ts`, `src/app/starter.ts`, `src/app/DiagramDashboard.tsx`
- Test: `src/app/starter.test.ts` (append)

**Interfaces:**
- **Undo/redo buttons (perf-contract trace, explicit):** the command stack is module-level by design (nothing subscribes to it). Task 3 added `canvasStackVersion`, bumped ONLY inside the `set()` calls that already fire at commit/undo/redo/load — zero new hot-path writes, and per-tick drag code never touches the store. `CanvasControls` subscribes to the VERSION (re-rendering at those same commit points only) and reads `getCanvasStack().canUndo()/canRedo()` for disabled state; clicks call the existing `undoCanvas`/`redoCanvas` actions. During a live drag nothing re-renders (the commit lands at gesture end — exactly when the buttons should update).
- **<800 px shortcuts clip (P6 T13 finding):** `.shortcuts-pop`'s fixed `width: 300px` overflows a narrow canvas pane and gets clipped. Fix: `width: min(300px, calc(100vw - 48px));` + `z-index: 30;` (above the minimap/panel stack). No JS.
- **Perf-spec cold-start warmup:** the timed run currently starts right after ONE cold `page.goto('/')` — on CI the mark absorbs dev-server transform + worker-chunk compile. Insert a reload (same URL, warm HTTP cache) between boot and timing; budgets unchanged.
- **Sample diagram:** `SAMPLE_DBML` in `starter.ts` (the exact text below was parse-verified against the installed parser — Verified facts) + a "New Sample Diagram" rail button in the dashboard that reuses `importDiagram` (the existing create-with-content path: flushes the current diagram, invalidates autosave, creates + switches).

- [ ] **Step 1: Undo/redo buttons**

In `src/canvas/CanvasControls.tsx`:

1. Imports: `import { useAppStore, getCanvasStack } from '../app/store';` (extend the existing import).
2. Subscriptions, above the return:

```ts
  // Toolbar undo/redo (Feature F). The stack is module-level (not store
  // state) by design; canvasStackVersion is its change counter — bumped only
  // inside the existing commit/undo/redo/load set() calls, so this component
  // re-renders at gesture end, never per drag tick (perf contract).
  const stackVersion = useAppStore((s) => s.canvasStackVersion);
  void stackVersion; // the subscription IS the point — canUndo/canRedo below re-read on each bump
  const stack = getCanvasStack();
```

3. Buttons, after the trace toggle:

```tsx
      <button
        aria-label="Undo canvas move"
        title="Undo canvas move (Ctrl/Cmd+Z)"
        disabled={!stack.canUndo()}
        onClick={() => useAppStore.getState().undoCanvas()}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M6 3L2 7l4 4M2 7h8a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        aria-label="Redo canvas move"
        title="Redo canvas move (Shift+Ctrl/Cmd+Z)"
        disabled={!stack.canRedo()}
        onClick={() => useAppStore.getState().redoCanvas()}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M10 3l4 4-4 4M14 7H6a4 4 0 0 0 0 8h3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
```

4. CSS — append: `.canvas-controls > button:disabled { opacity: 0.4; cursor: default; }`

- [ ] **Step 2: Clip fix**

In `src/styles.css`, in the `.shortcuts-pop` rule, replace `width: 300px;` with:

```css
  width: min(300px, calc(100vw - 48px)); z-index: 30;
```

(P6 T13 finding: a fixed 300 px popover clips inside a <800 px window's canvas pane.)

- [ ] **Step 3: Perf warmup**

In `e2e/perf.spec.ts`, after the boot wait (`await expect(page.locator('.table-node').first()).toBeVisible();`), insert:

```ts
  // CI cold-start warmup: the FIRST load pays vite transform + the worker
  // chunk compile; without this the perf:edit→perf:rendered measure charges
  // dev-server costs to the app. Reload = same URL, warm caches.
  await page.reload();
  await expect(page.locator('.table-node').first()).toBeVisible();
```

- [ ] **Step 4: Sample diagram (failing test first)**

Append to `src/app/starter.test.ts` (inside the existing describe; add `SAMPLE_DBML` to the import and `parseDbml` if absent):

```ts
  it('SAMPLE_DBML parses clean with the real pipeline and carries the full feature surface', () => {
    const r = parseDbml(SAMPLE_DBML);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const s = r.schema;
    expect(s.tables).toHaveLength(8);
    expect(s.refs).toHaveLength(8);
    expect(s.enums).toHaveLength(3);
    expect(s.groups).toHaveLength(3);
    expect(s.notes).toHaveLength(1);
    expect(s.tables.every((t) => t.headerColor !== null)).toBe(true);
    expect(s.refs.some((x) => x.from.fieldNames.length === 2)).toBe(true); // composite
    expect(s.refs.some((x) => x.inline)).toBe(true); // categories self-ref (inline)
    expect(s.refs.some((x) => x.from.relation === '1' && x.to.relation === '1')).toBe(true); // one-to-one
  });
```

Run: `npx vitest run src/app/starter.test.ts` — Expected: FAIL (`SAMPLE_DBML` not exported).

Append to `src/app/starter.ts` (this exact text is parse-verified — Verified facts):

```ts
/** "New Sample Diagram" (Plan 7): a rich e-commerce schema exercising every
 *  canvas feature — enums, groups, notes, header colors, and one ref of each
 *  shape (one-to-many, one-to-one, named+on-delete, composite, inline self-
 *  ref). Parse-verified against the installed @dbml/core 8.3.1. */
export const SAMPLE_DBML = `// E-commerce sample — exercises enums, groups, notes, header colors,
// and every ref shape the canvas can render.

Table customers [headerColor: #2196f3] {
  id integer [pk, increment]
  email varchar [not null, unique]
  full_name varchar [not null]
  tier customer_tier [not null, default: 'standard']
  created_at timestamp [default: \`now()\`]
}

Table customer_profiles [headerColor: #2196f3] {
  customer_id integer [pk]
  bio text [note: 'shown on public reviews']
  marketing_opt_in boolean [default: false]
}

Table products [headerColor: #4caf50] {
  id integer [pk, increment]
  sku varchar [not null, unique]
  name varchar [not null]
  price_cents integer [not null, note: 'always in the shop currency']
  status product_status [not null, default: 'draft']
}

Table categories [headerColor: #4caf50] {
  id integer [pk, increment]
  name varchar [not null]
  parent_id integer [ref: > categories.id, note: 'self-reference: subcategories']
}

Table product_categories [headerColor: #4caf50] {
  product_id integer [not null]
  category_id integer [not null]
  Note: 'join table: a product sits in many categories'
}

Table orders [headerColor: #ff9800] {
  id integer [pk, increment]
  customer_id integer [not null]
  status order_status [not null, default: 'cart']
  region varchar [not null]
  ordinal integer [not null, note: 'per-region order number']
  placed_at timestamp
}

Table order_items [headerColor: #ff9800] {
  order_id integer [not null]
  product_id integer [not null]
  quantity integer [not null, default: 1]
  unit_price_cents integer [not null]
}

Table shipments [headerColor: #9c27b0] {
  id integer [pk, increment]
  order_region varchar [not null]
  order_ordinal integer [not null]
  carrier varchar
  shipped_at timestamp
}

Enum customer_tier {
  standard
  gold
  platinum
}

Enum product_status {
  draft
  live
  retired
}

Enum order_status {
  cart
  placed
  paid
  shipped
  cancelled
}

TableGroup customers_grp [color: #2196f3] {
  customers
  customer_profiles
}

TableGroup catalog [color: #4caf50] {
  products
  categories
  product_categories
}

TableGroup fulfillment [color: #ff9800] {
  orders
  order_items
  shipments
}

Note onboarding {
  'Drag a field handle onto another field to draw a new ref.'
}

Ref: customer_profiles.customer_id - customers.id
Ref: orders.customer_id > customers.id
Ref order_lines: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.product_id > products.id
Ref: product_categories.product_id > products.id
Ref: product_categories.category_id > categories.id
Ref: shipments.(order_region, order_ordinal) > orders.(region, ordinal)
`;
```

In `src/app/DiagramDashboard.tsx` — import `importDiagram` (extend the usePersistence import) and `SAMPLE_DBML` from `./starter`; in the rail, after the "New Diagram" button:

```tsx
          <button
            className="dash-sample"
            onClick={() => void importDiagram({ name: 'E-commerce Sample', dbml: SAMPLE_DBML }).then(onClose)}
          >
            New Sample Diagram
          </button>
```

CSS — append: `.dash-sample { width: 100%; margin-top: 8px; font-size: 12px; padding: 7px 0; border: 1px solid var(--border); background: none; color: var(--text); border-radius: 6px; cursor: pointer; }`

- [ ] **Step 5: Verify (unit, typecheck, browser), commit**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: drag a table → undo button enables at RELEASE (not mid-drag — watch for renders), click undoes the move, redo enables; buttons disable after a diagram switch (stack reset); shrink the window under 800 px → the shortcuts popover fits; dashboard → "New Sample Diagram" → 8 colored tables, 3 group rects, a sticky note, composite + self-ref edges; two swatch clicks in the table settings popover then editor Cmd+Z twice → reverts one color per undo (Task 5's userEvent annotation).

```bash
git add -A && git commit -m "feat: chrome — toolbar undo/redo, shortcuts clip fix, perf warmup, e-commerce sample"
```

---

### Task 13: Feature G — print-to-PDF + Snowflake import

**Files:**
- Modify: `src/core/convert/convert.ts`, `src/app/ImportDialog.tsx`, `src/app/ExportMenu.tsx`
- Test: `src/core/convert/convert.test.ts` (append)

**Interfaces:**
- `convert.ts`: `SqlDialect` (export+import) is UNCHANGED — snowflake export emits an empty string in 8.3.1 (Verified facts), so it must not join the export union. New `export type ImportSqlDialect = SqlDialect | 'snowflake';`; `importSql(sql, dialect: ImportSqlDialect)`. `ImportDialog`'s `ImportKind` widens to `ImportSqlDialect | 'dbml' | 'project'` and `KIND_OPTIONS` gains `{ kind: 'snowflake', label: 'Snowflake DDL' }`.
- ExportMenu gains "To PDF (print)" in the Document group (disabled with `imageDisabled`): `buildDiagramSvg()` → `window.open('', '_blank')` → write a minimal print document (escaped title, inline SVG, print CSS) → `print()` — the user picks "Save as PDF". `window.open() === null` (popup blocker) → the established `window.alert` pattern. No dependencies, no new chunk.

- [ ] **Step 1: Write the failing test**

Append inside `convert.test.ts`'s `importSql` describe:

```ts
  it('converts snowflake DDL to DBML that our dbmlv2 pipeline re-parses (import-only dialect)', async () => {
    const sql = 'CREATE TABLE settlements (id NUMBER PRIMARY KEY, gross NUMBER(12,2) NOT NULL);';
    const r = await importSql(sql, 'snowflake');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const parsed = parseDbml(r.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schema.tables[0].name).toBe('settlements');
    expect(parsed.schema.tables[0].fields.map((f) => f.name)).toEqual(['id', 'gross']);
  });
```

Run: `npx vitest run src/core/convert/convert.test.ts` — Expected: FAIL (TS2345: `'snowflake'` not assignable).

- [ ] **Step 2: Implement the dialect**

`src/core/convert/convert.ts` — after the `SqlDialect` line:

```ts
/** Import-only dialects. Snowflake is deliberately NOT in SqlDialect:
 *  exporter.export(…, 'snowflake') returns an EMPTY STRING in the installed
 *  8.3.1 (verified — the sqlite situation), while importer.import(…,
 *  'snowflake') works and re-parses with 'dbmlv2'. */
export type ImportSqlDialect = SqlDialect | 'snowflake';
```

change `importSql`'s signature to `(sql: string, dialect: ImportSqlDialect)` and its doc-comment dialect list to `('postgres' | 'mysql' | 'mssql' | 'oracle' | 'snowflake')`.

`src/app/ImportDialog.tsx` — the type line becomes:

```ts
import { importSql, type ImportSqlDialect } from '../core/convert/convert';

type ImportKind = ImportSqlDialect | 'dbml' | 'project';
```

and `KIND_OPTIONS` gains, after oracle:

```ts
  { kind: 'snowflake', label: 'Snowflake DDL' },
```

Run: `npx vitest run src/core/convert/convert.test.ts` — Expected: PASS.

- [ ] **Step 3: PDF export**

In `src/app/ExportMenu.tsx`, add:

```ts
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const exportPdf = () => {
    // Print-to-PDF (Feature G): no library — a popup window with the export
    // SVG and print CSS; the user picks "Save as PDF" in the dialog. The SVG
    // markup is our own serialization (svgExport); only the user-controlled
    // diagram name needs escaping.
    const built = buildDiagramSvg();
    if (built) {
      const win = window.open('', '_blank');
      if (!win) {
        window.alert('Pop-up blocked — allow pop-ups for this site to print to PDF.');
        menu.close();
        return;
      }
      win.document.write(
        `<!doctype html><html><head><title>${escapeHtml(useAppStore.getState().diagramName)}</title>` +
        `<style>body{margin:0}svg{max-width:100%;height:auto}@page{margin:10mm}</style>` +
        `</head><body>${built.markup}</body></html>`,
      );
      win.document.close();
      win.focus();
      win.print(); // document.write parses synchronously — content is ready
    }
    menu.close();
  };
```

(`escapeHtml` at module level, `exportPdf` beside the other handlers.) Menu item, after the SVG item in the Document group:

```tsx
          <li><button disabled={imageDisabled} onClick={exportPdf}>To PDF (print)</button></li>
```

- [ ] **Step 4: Verify (unit, typecheck, browser), commit**

```bash
npx vitest run && npx tsc --noEmit
```

Browser: Import → "Snowflake DDL" listed; paste the test's CREATE TABLE → new diagram `settlements` renders; export menu shows "To PDF (print)" → a print dialog opens over a page showing the diagram (cancel it); with popups blocked (Chrome site setting) → the alert appears; the export menu does NOT list a Snowflake SQL item.

```bash
git add -A && git commit -m "feat: print-to-pdf export + snowflake import dialect (import-only, verified on 8.3.1)"
```

---

### Task 14: E2E — `e2e/completeness.spec.ts` + snowflake interop entry (written now, EXECUTED in Task 15)

**Files:**
- Create: `e2e/completeness.spec.ts`
- Modify: `e2e/interop.spec.ts` (one DIALECTS entry)

**Interfaces:**
- Deterministic idioms only: auto-retrying `expect` absorbs the 300 ms parse debounce and the 1.5 s focus flash; `expect.poll` on IndexedDB absorbs the 1 s autosave; the edge hit-path is clicked via `dispatchEvent('click', { clientX, clientY })` — an L-shaped path's bbox center usually misses the 12 px stroke, so a positional `click()` would flake; coords come from the path's own bbox so the popover positions sanely. No `waitForTimeout` anywhere.
- **Execution deferred:** the user's dev server owns 5173 and `reuseExistingServer: !CI` would run these against MAIN's build. This task ends at `npx tsc --noEmit` (specs typecheck); the controller frees the port and runs the suite in Task 15 (P6 operational-note precedent).

- [ ] **Step 1: Write the spec**

`e2e/completeness.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { setEditorText, STARTER_TABLE_COUNT } from './helpers';

test('ref-drag: field handle to field row appends a Ref line and draws the edge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await expect(page.locator('.edge')).toHaveCount(3);

  const postsTitleRow = page
    .locator('.table-node')
    .filter({ has: page.locator('.table-title', { hasText: 'posts' }) })
    .locator('.field-row')
    .filter({ hasText: 'title' });
  const usersNameRow = page
    .locator('.table-node')
    .filter({ has: page.locator('.table-title', { hasText: 'users' }) })
    .locator('.field-row')
    .filter({ hasText: 'username' });

  await postsTitleRow.hover(); // CSS :hover reveals the handle
  const handle = postsTitleRow.locator('.ref-handle');
  const from = (await handle.boundingBox())!;
  const to = (await usersNameRow.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // A few intermediate moves: the temp line is imperative, but the drop only
  // reads the release point — steps just make the gesture realistic.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up();

  await expect(page.locator('.cm-content')).toContainText('Ref: posts.title > users.username');
  await expect(page.locator('.edge')).toHaveCount(4); // parse debounce absorbed by the retry
});

test('edge popover: cardinality swap and delete are text edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.edge')).toHaveCount(3);

  // First edge = first starter ref: posts.user_id > users.id.
  const hit = page.locator('.edge-hit').first();
  const box = (await hit.boundingBox())!;
  await hit.dispatchEvent('click', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });

  const pop = page.locator('.edge-popover');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.ep-title')).toHaveText('posts.user_id > users.id');
  await expect(pop.locator('.ep-op input').nth(1)).toBeChecked(); // < > - <> order: '>' is index 1

  await pop.locator('.ep-op input').nth(0).click(); // '<'
  await expect(page.locator('.cm-content')).toContainText('Ref: posts.user_id < users.id');
  await expect(pop.locator('.ep-op input').nth(0)).toBeChecked(); // popover survives its own edit

  await pop.getByRole('button', { name: 'Delete ref' }).click();
  await expect(pop).toBeHidden();
  await expect(page.locator('.edge')).toHaveCount(2);
  await expect(page.locator('.cm-content')).not.toContainText('posts.user_id < users.id');
});

test('edge popover refuses inline-defined refs with a Reveal jump', async ({ page }) => {
  await page.goto('/');
  await setEditorText(page, 'Table users { id int }\nTable posts { user_id int [ref: > users.id] }');
  await expect(page.locator('.edge')).toHaveCount(1);

  const hit = page.locator('.edge-hit').first();
  const box = (await hit.boundingBox())!;
  await hit.dispatchEvent('click', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });

  const pop = page.locator('.edge-popover');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Defined inline');
  await expect(pop.locator('.ep-op')).toHaveCount(0); // no radios, no delete
  await pop.getByRole('button', { name: 'Reveal' }).click();
  await expect(pop).toBeHidden();
  // The editor selection landed at the inline ref's token (same line).
  await expect(page.locator('.cm-activeLine')).toContainText('ref: > users.id');
});

test('highlight mode dims everything outside the 1-hop neighborhood; Escape clears', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Table users { id int }\nTable posts { user_id int [ref: > users.id] }\nTable isolated { id int }',
  );
  await expect(page.locator('.table-node')).toHaveCount(3);

  await page.getByRole('button', { name: 'Toggle highlight mode' }).click();
  await page
    .locator('.table-node')
    .filter({ has: page.locator('.table-title', { hasText: 'users' }) })
    .click();
  await expect(page.locator('.table-node.dimmed')).toHaveCount(1); // isolated
  await expect(page.locator('.edge.dimmed')).toHaveCount(0); // the only edge touches users

  await page.keyboard.press('Escape'); // no overlays open → last-resort clears highlight+selection
  await expect(page.locator('.table-node.dimmed')).toHaveCount(0);
});

test('quick-search: cmd/ctrl+k finds, unhides, and centers a table', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  // Hide comments through the views sidebar first.
  await page.locator('.views-tab').click();
  await page
    .locator('.views-table-row')
    .filter({ hasText: 'comments' })
    .getByRole('button', { name: 'Toggle visibility' })
    .click();
  await expect(page.locator('.table-node')).toHaveCount(2);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.qs-panel')).toBeVisible();
  await page.locator('.qs-input').fill('com');
  await page.keyboard.press('Enter');
  await expect(page.locator('.qs-panel')).toBeHidden();
  await expect(page.locator('.table-node')).toHaveCount(3); // unhidden
  await expect(
    page.locator('.table-node.focused').filter({ has: page.locator('.table-title', { hasText: 'comments' }) }),
  ).toHaveCount(1); // centered + flashing (1.5 s window, retry-absorbed)
});

test('group collapse: pill, hidden members/edges, persists across reload', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Table users { id int }\nTable posts { user_id int [ref: > users.id] }\nTable comments { post_id int [ref: > posts.id] }\nTableGroup g1 {\n  users\n  posts\n}', // single-line multi-member TableGroup is a parse error (8.3.1 code 3017) — keep members newline-separated
  );
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(2);

  await page.locator('.group-collapse').click();
  await expect(page.locator('.table-node')).toHaveCount(1); // comments only
  await expect(page.locator('.edge')).toHaveCount(0); // both edges touch a collapsed member (accepted divergence)
  await expect(page.locator('.group-pill')).toBeVisible();
  await expect(page.locator('.table-group.collapsed')).toContainText('g1 (2)');

  // 1 s autosave: poll IndexedDB for the persisted collapse — no sleeps.
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
                  const rows = all.result as Array<{ collapsedGroupIds?: string[] }>;
                  resolve(JSON.stringify(rows[0]?.collapsedGroupIds ?? []));
                };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(JSON.stringify(['public.g1']));

  await page.reload();
  await expect(page.locator('.table-node')).toHaveCount(1);
  await expect(page.locator('.group-pill')).toBeVisible();

  await page.locator('.group-collapse').click(); // expand
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(2);
});

test('pdf menu item present; sample diagram creates the full e-commerce schema', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await page.getByRole('button', { name: /export/ }).click();
  await expect(page.getByRole('button', { name: 'To PDF (print)' })).toBeEnabled();
  await page.keyboard.press('Escape'); // overlay stack closes the menu

  await page.getByRole('button', { name: /diagrams/ }).click();
  await page.getByRole('button', { name: 'New Sample Diagram' }).click();
  await expect(page.locator('.dashboard')).toBeHidden();
  await expect(page.locator('.table-node')).toHaveCount(8);
  await expect(page.locator('.group-rect')).toHaveCount(3);
});
```

- [ ] **Step 2: Snowflake interop entry**

In `e2e/interop.spec.ts`, append to `DIALECTS`:

```ts
  {
    kind: 'snowflake',
    sql: 'CREATE TABLE settlements (id NUMBER PRIMARY KEY, gross NUMBER(12,2) NOT NULL);',
    table: 'settlements',
  },
```

(The import loop and the final `1 + DIALECTS.length` dashboard count adjust automatically; the EXPORT loop is untouched — snowflake is import-only.)

- [ ] **Step 3: Typecheck only (execution deferred)**

```bash
npx tsc --noEmit
```

Expected: clean. **Do NOT run `npm run test:e2e` here** — the user's dev server owns 5173; execution happens in Task 15 under controller supervision.

- [ ] **Step 4: Commit**

```bash
git add e2e/completeness.spec.ts e2e/interop.spec.ts && git commit -m "feat: completeness e2e — ref authoring, highlight, quick-search, collapse, pdf/sample; snowflake interop"
```

---

### Task 15: Integration — full verification, audits, e2e execution, CLAUDE.md, ledger, walkthrough; tag SKIPPED

**Files:**
- Modify: `CLAUDE.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1: Full verification**

```bash
npx vitest run        # Expected: all pass, ≈339 tests (289 baseline + ~50 new: T2 5, T3 15, T4 3, T5 15, T6 4, T7 6, T12 1, T13 1)
npx tsc --noEmit      # Expected: clean
npm run check:bundle  # Expected: OK, ≤ 235,520 gzip bytes (230 KiB — Task 1 decision; baseline 211,396 + this plan's UI ≈ 216–221k), no lazy-lib markers
```

**E2E (controller-coordinated):** stop the user's dev server on 5173 (or export `PORT` per the P6 note), then:

```bash
npm run test:e2e      # Expected: 20 passed (13 existing + 7 completeness); interop now imports 5 dialects
```

Restart the user's dev server on MERGED main at completion (P6 precedent).

- [ ] **Step 2: Constraint audits**

```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output (blankNoise moved INTO core cleanly; visibility/parseDbml additions import only core).

```bash
grep -rn "from '@dbml/core'" src/ | grep -v "src/core/parse/parseDbml.ts" || true
```
Expected: no output (snowflake rides the lazy convert facade).

```bash
grep -rn "setState\|set({" src/canvas/EdgeRefPopover.tsx | grep -v "useState" || true
```
Expected: no output (the edge popover never writes store state — the text-bridge rule holds mechanically; QuickSearch's `setHiddenTables`/`setCollapsedGroups` are sanctioned LAYOUT-state actions, not text).

```bash
grep -rn "addEventListener('keydown'" src/app src/canvas | grep -v overlayStack.ts || true
```
Expected: exactly TWO hits, both in `DiagramCanvas.tsx` — the canvas shortcuts effect (incl. the `overlayDepth()===0` Escape last-resort) and the quick-search Cmd/Ctrl+K binding. None in the migrated components: every overlay Escape now routes through the stack.

```bash
grep -rn "from 'vitest'\|from \"vitest\"" e2e/ || true
```
Expected: no output.

- [ ] **Step 3: Update CLAUDE.md (exact edits; the budget line was already updated in Task 1)**

1. **Project** section — replace:
   > All six milestones are complete (Plan 6: UX parity — hover menus, table settings popover, project dashboard, diagram-views visibility, canvas controls, Oracle dialect).

   with:
   > All seven milestones are complete (Plan 7: completeness — ref authoring from the canvas via the text bridge, field badges/tooltips, highlight mode, Cmd/Ctrl+K quick-search, group collapse, escape overlay-stack, toolbar undo/redo, sample diagram, print-to-PDF, Snowflake import).

2. **Canvas→text bridge** paragraph — replace:
   > `applyTableSettings` (table rename / headerColor, `src/editor/tableSettings.ts` is the pure rewriter) is the first user, alongside `applyFormat`/`revealTable`.

   with:
   > `applyTableSettings` (table rename / headerColor, `src/editor/tableSettings.ts` is the pure rewriter) and the ref suite `appendRefLine`/`applyRefOperator`/`deleteRefLine` (`src/editor/refEdit.ts` is the pure locator/builder; inline-defined refs are REFUSED with a Reveal jump — `Ref.inline` from the normalizer) are its users, alongside `applyFormat`/`revealTable`. Canvas-origin transactions carry a `userEvent` annotation so editor history never merges them into adjacent typing.

3. **Text vs layout** paragraph — replace:
   > `hiddenTableIds` is view state: persisted per diagram (optional field, like `notePositions`), pruned on parse like selection, filtered at render time (never on the imperative pan/drag paths).

   with:
   > `hiddenTableIds` and `collapsedGroupIds` are view state: persisted per diagram (optional fields, like `notePositions`), pruned on parse like selection, filtered at render time (never on the imperative pan/drag paths). The effective hidden set is DERIVED (`effectiveHiddenIds` — explicit hides ∪ collapsed groups' members), never written back.

4. **Canvas performance contract** paragraph — append to its end:
   > Toolbar undo/redo subscribes to `canvasStackVersion`, a counter bumped only inside the existing commit/undo/redo/load `set()` calls — never add a store write to a per-tick path for it. Escape handling for overlays goes through `src/app/overlayStack.ts` (topmost-only); the canvas clear-selection Escape acts only when the stack is empty.

- [ ] **Step 4: Ledger entry**

Append to `.superpowers/sdd/progress.md`:

```
# Plan 7 lane (feature/plan-7-complete)
P7 complete: bundle budget 210->230 KiB (T1, controller-approved; leak markers unchanged); normalizer Ref.inline (blanked back-scan of token.start.offset — 8.3.1 has NO flag, verified) + Ref.pos + Field.enumValues, blankNoise moved to core w/ sourceMap re-export (T2); state spine traceEnabled/highlightTableId (session) + collapsedGroupIds (persisted like hiddenTableIds, full threading + backward compat) + canvasStackVersion riding existing set() calls + effectiveHiddenIds derive-don't-mutate (T3); escape overlay-stack, six listeners migrated, canvas Escape = last resort, kebab outside-click (T4); refEdit.ts findRefLine/buildRefLine real-parser round-trips incl. alias resolution (parser resolves aliases, verified) + wrapped-line refusal + editorNav appendRefLine/applyRefOperator/deleteRefLine + userEvent annotations incl. applyTableSettings swatch fix (T5); field badges NN/U/++, note dots, SVG <title> tooltips incl. enum values (T6); REF-DRAG field handles -> imperative temp line -> geometric fieldDropTarget (justified over elementFromPoint: testable, sees culled targets) -> append via bridge, silent-cancel policy incl. duplicate-pair refusal (dbmlv2 rejects dups, verified) (T7); edge popover w/ 12px hit paths tracked imperatively, cardinality radios/delete as text edits, inline refusal + Reveal via Ref.pos (T8); highlight/trace 1-hop dimming (T9); global Cmd/Ctrl+K quick-search (CM binds Shift-Mod-k + mac Ctrl-k only, verified) (T10); group collapse pill + chevrons, all consumers on effectiveHiddenIds, sidebar hidden-by-group disabled eyes, edges-to-collapsed hidden = accepted divergence (T11); toolbar undo/redo buttons, <800px shortcuts clip fix, perf cold-start warmup, e-commerce SAMPLE_DBML (parse-verified) (T12); print-to-PDF popup + snowflake IMPORT-ONLY (export returns '' on 8.3.1, verified) (T13); 7 completeness e2e + snowflake interop entry (T14). Known ceilings: badges share the 220px row with long type names (pre-existing collision class); edge popover holds still during imperative pan (settings-popover parity); collapsed group with ALL members explicitly hidden shows no pill; win.print() fires synchronously after document.write (no onload wait).
```

- [ ] **Step 5: Browser walkthrough (dev server)**

1. Regression sweep: type→render, break→stale badge, autocomplete, format, problems-panel jump, undo in both panes, hover menus, dashboard, views sidebar, snap/LOD controls.
2. Feature A end-to-end: handle-drag creates a ref (editor undo removes it); duplicate/self/header/empty drops cancel silently; popover swaps cardinality (label glyphs update after parse), deletes, refuses inline with working Reveal; popover survives its own edit; hit path tracks a live drag.
3. Feature B: badges/dots/tooltips on starter + sample; export SVG shows styled badges.
4. Feature C: trace toggle + dimming on the sample (rich topology); dimmed tables still interactive; Escape/empty-click/diagram-switch clear.
5. Feature D: Cmd/Ctrl+K with editor focus (no line deleted!), magnifier button, unhide+expand+center+flash.
6. Feature E: collapse/expand, pill drag moves members, sidebar disabled eyes, export/fit/minimap/ELK/reload behavior, quick-search expands.
7. Feature F: escape stack ordering (popover-over-menu), kebab outside-click, undo/redo buttons enable at gesture end, <800 px shortcuts popover, sample diagram button, two-swatch undo granularity.
8. Feature G: snowflake import path; PDF print dialog + popup-blocked alert.
9. Storage-unavailable (private window): banner + everything still works in-memory.

- [ ] **Step 6: Final commit; tag SKIPPED**

```bash
git add -A && git commit -m "chore: plan 7 complete — completeness" --allow-empty
```

Tag step deliberately SKIPPED — the controller tags `plan-7-complete` after merge review.

---

## Self-review checklist (done at authoring time)

- **Scope map:** Feature A — field-row handle w/ CSS-only visibility (T7), pointerId-owned REF-DRAG per the gesture-ledger comment w/ stopPropagation + svg capture (T7), imperative temp line on the guides layer via setAttribute (T7), geometric drop lookup CHOSEN + justified vs elementFromPoint (T7 Interfaces), standalone `Ref: src > dst` append via NEW editorNav function `appendRefLine` in one transaction w/ `${schema}.${table}.${field}` formatting matching verified parser syntax + `>` default (T5/T7), silent cancel on empty/invalid/duplicate/self (T7), edge popover on widened transparent hit path reusing the single-host HTML-layer pattern (T8), ref-as-text + cardinality radios `<`/`>`/`-`/`<>` + delete (T8), all edits/deletes via NEW pure locator `findRefLine` handling names/on-delete-update suffixes/whitespace/flip/quoting/composite/ALIAS-resolution (via buildTableRanges — parser resolves aliases, verified) and REFUSING inline + block form + wrapped-across-lines (documented, tested) (T5), popover inline message + Reveal (T8, via `Ref.pos` because endpoint order provably doesn't identify the defining table — deviation from "revealTable" wording documented in Verified facts + T8), normalizer `inline` flag ADDED because the empirical check found none (T2), real-parser round-trip tests for every case (T5). Feature B — NN/U/++ badges + default hint (tooltip) + note glyph + `<title>` tooltips for field note/enum values/table note, `Field.enumValues` normalizer exposure, 220 px layout via right-anchored tspan (no measurement), memo contract untouched (T2/T6). Feature C — toggle in CanvasControls, `highlightTableId` session state, 1-hop memo off [schema.refs, highlightTableId], dimmed CSS class, click-empty/Escape clear composed with the stack, selection-compatible (T3/T9). Feature D — global Cmd/Ctrl+K (decision + CodeMirror citation), centered palette w/ substring match, Enter/click → unhide + centerOnTable + flash, Escape closes, magnifier wired (T10). Feature E — chevrons, persisted `collapsedGroupIds` threaded per the established precedent + backward compat tests, effective set derived ONCE at existing memo spots, pill from member-positions bbox via computeGroupRect, expand restores, edges-hidden divergence documented, sidebar semantics specified (disabled eye + hint) (T3/T11). Feature F — overlayStack w/ single listener + topmost-only + canvas last-resort (T4), <800 px clip fix (T12), kebab outside-click (T4), perf warmup (T12), swatch userEvent annotation (T5), undo/redo buttons w/ canvasStackVersion riding existing set() calls + perf trace (T3/T12), sample diagram via importDiagram (T12). Feature G — PDF print w/ popup-blocker alert (T13), snowflake IMPORT-ONLY exactly as the empirical check supports (T13, union type kept separate so export can't accept it, convert test, interop loop entry).
- **Budget-decision task present and early:** Task 1, controller-approved wording in the header AND the script comment; leak markers untouched.
- **Placeholder scan:** every step carries complete code or exact quoted-anchor edits; the two riskier test fixtures (`public."or der"."f 1"`, ref settings) were themselves run through the real parser during authoring (`note:` is NOT a valid ref setting — the test uses a trailing comment instead, finding documented in the test).
- **Cross-task signatures:** `Ref.inline/pos` + `Field.enumValues` (T2 → T5/T6/T8/T12 test), `blankNoise` core path (T2 → T5 import), `effectiveHiddenIds` (T3 → T7/T10/T11 consumers), `useOverlayEscape`/`overlayDepth` (T4 → T8/T10 + DiagramCanvas), `emitIdent` export (T5 ← tableSettings), `RefOperator`/`MIRRORED`/`findRefLine`/`buildRefLine`/`formatRefText`/`refOperator` (T5 → T7/T8), `DropField` (T7 → buildRefLine's RefLineEndpoint structural match), `onRefDragStart`/`dimmed` TableNode props (T7/T9 ↔ DiagramCanvas maps), `onEdgeClick` (T8 both sides), `onOpenSearch` (T10 both sides), `canvasStackVersion` + `getCanvasStack` (T3 → T12 buttons), `SAMPLE_DBML` (T12 → T14 count assertions: 8 tables / 3 group rects), `ImportSqlDialect` (T13 → ImportDialog), e2e selectors introduced before use (`.field-row`, `.ref-handle`, `.edge-hit`, `.edge-popover`/`.ep-*`, `.qs-*`, `.group-collapse`/`.group-pill`, `.dash-sample`, aria labels).
- **Backward compat tested:** pre-Plan-7 records/snapshots/project files load with `collapsedGroupIds → []` (T3 tests all three), serializer omits the empty key, dedupe normalizes `?? []` on both sides, `Ref` fixture updates named for the only two literal sites.
- **Empirical facts cited with actual outputs:** snowflake import string + empty export, ref ownKeys list + token offsets + `[`/`,` predecessor rule + duplicate-pair rejection message, operator→relation table, CodeMirror keymap findings with file evidence, sample-DBML parse counts, 289/289 baseline, 211,396/215,040 bundle.
- **Single lane:** dependency order T1 budget → T2 normalizer → T3 state → T4 stack → T5 text machinery → T6 rows → T7 drag (needs rows+text) → T8 popover (needs stack+text) → T9/T10 (need state+stack) → T11 (needs state+all canvas surfaces) → T12/T13 chrome+exports → T14 e2e → T15 integration; no two tasks marked parallel-safe.
- **E2E execution deferred** to T15 with the controller-owned port hand-off stated in T14 AND Global Constraints.
