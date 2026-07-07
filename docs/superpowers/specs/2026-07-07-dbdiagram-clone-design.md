# dbdiagram Clone — Design Spec

**Date:** 2026-07-07
**Status:** Approved pending user review
**Shape:** Local-first single-page web app. No backend. React + TypeScript + Vite.

## 1. Goal

A clone of dbdiagram.io's editor experience — write DBML on the left, see a live
entity-relationship diagram on the right — that is better than the original in four
explicitly agreed ways:

1. **No paywall.** Dark mode, all exports, table groups/colors, unlimited diagrams — all free.
2. **Large-schema performance.** Smooth pan/zoom/drag and fast re-render at 100+ tables
   (dbdiagram.io degrades past ~30–40).
3. **Better editor experience.** Schema-aware autocomplete, precise inline errors,
   format-on-demand, keyboard shortcuts.
4. **Better canvas control.** Snap-to-grid, alignment guides, minimap, overlap-avoiding
   orthogonal edge routing, ELK auto-layout, sticky notes.

"Stable" is treated as a feature: the app must never blank the diagram on a syntax error,
never lose work, and degrade gracefully when storage or rendering fails.

## 2. Architecture decision (Approach A — approved)

- **Language core: `@dbml/core`** (Apache-2.0, maintained by Holistics — the engine behind
  dbdiagram.io itself). Provides the DBML parser and SQL import/export for PostgreSQL,
  MySQL, and SQL Server. Guarantees DBML compatibility; outsources conversion correctness
  to a battle-tested library.
- **Editor: CodeMirror 6** with a hand-written, error-tolerant DBML language mode.
- **Canvas: purpose-built SVG renderer** (no diagram library) designed around the
  performance target, with level-of-detail rendering, viewport culling, and field-anchored
  orthogonal edges.

Rejected alternatives: React Flow canvas (constrains edge routing and LOD, fights the perf
target); fully hand-rolled parser + SQL converters (double scope, correctness risk).

## 3. Feature scope (v1)

| Area | Features |
|---|---|
| DBML | Full spec via `@dbml/core`: tables, column settings (pk, unique, not null, increment, default), refs (1-1, 1-n, n-n, composite, `on delete`/`on update`), enums, indexes, notes, TableGroups, header colors, multi-schema, sticky notes |
| Editor | Syntax highlighting, schema-aware autocomplete (table/column/type/setting names, block snippets), inline error squiggles with line/col + problems panel, format document, find/replace, two-way editor↔canvas navigation |
| Canvas | Field-anchored orthogonal edges with crow's-foot/`1`/`*` markers, drag with snap-to-grid + alignment guides, marquee multi-select, minimap, zoom-to-fit / zoom controls, ELK auto-layout button, table group containers (drag as unit), sticky notes, hover/select highlighting of related edges and tables |
| Import | SQL DDL: PostgreSQL, MySQL, SQL Server; open/paste `.dbml`. Import always creates a new diagram — never overwrites the current one |
| Export | SQL DDL (3 dialects), `.dbml`, PNG (2x), SVG, project file (JSON = DBML + layout + viewport) |
| Persistence | Unlimited diagrams in IndexedDB; debounced autosave; ring buffer of last 20 snapshots per diagram with History panel restore; diagram manager (create/rename/duplicate/delete, sorted by last modified) |
| UX | Dark/light theme, resizable split pane, keyboard shortcuts, error-recovery UI |

**Out of scope for v1** (all designed to bolt on without rework): accounts/cloud sync,
realtime collaboration, PDF export, share-by-URL (compressed hash), embed mode,
Rails/Django schema import.

## 4. Module architecture

```
src/
  core/         framework-agnostic engine — zero React imports
    model/        normalized Schema + Layout types (single source of truth)
    parse/        @dbml/core wrapper: runs in Web Worker, normalizes errors
    convert/      import/export facades (SQL in/out, DBML out, JSON project file)
    layout/       elkjs auto-layout + incremental placement + orthogonal edge router
    persist/      IndexedDB repository (via `idb`), autosave, snapshots, project files
  editor/       CodeMirror 6: DBML language mode, completion source, lint source, sync
  canvas/       SVG renderer: viewport, table nodes, edge layer, groups, notes, minimap
  app/          shell: toolbar, diagram manager, import/export dialogs, theme, zustand store
```

Each layer is independently testable. `core/` is pure TypeScript and runs in Node
(vitest) without a DOM.

## 5. Data flow & state

One zustand store, three data slices plus UI state:

- `source` — the DBML text (authoritative for schema content)
- `schema` — last successfully parsed model (authoritative for what the canvas shows)
- `layout` — table positions, group positions, sticky note positions, viewport (authoritative
  for where things are; keyed by stable identity `schema.table`)

Cycle:

```
keystroke → source updated → 300ms debounce → parse in Web Worker
  ├─ success → structural diff vs current schema → schema slice updated →
  │            canvas reconciles: new tables placed incrementally near their
  │            referenced tables; deleted tables removed; existing tables keep
  │            positions; rename heuristic (same field signature, new name)
  │            preserves position across renames → autosave scheduled
  └─ failure → diagnostics mapped to editor squiggles; schema and canvas
               untouched; subtle "diagram is stale" badge shown
```

Canvas-originated changes (drag, group move, note move) write only to `layout` — they never
rewrite DBML text. Undo/redo is two independent stacks: CodeMirror history for text; a
command stack for canvas moves/auto-layout. Ctrl+Z targets the focused pane.

Parsing runs in a **Web Worker** so a 100+ table parse never blocks typing or panning.
ELK auto-layout runs in the same worker.

## 6. Canvas rendering & performance

Performance target: smooth (60fps-class) pan/zoom/drag and sub-second edit-to-render at
**120 tables / ~1200 fields / 150 refs** (the CI fixture).

- **Hot paths bypass React.** Pan/zoom writes a transform to the scene `<g>` via refs,
  RAF-batched; store commits on gesture end. Table drag moves that table's group and
  re-routes only its edges via direct DOM updates; other tables untouched.
- **Level-of-detail:** below ~40% zoom, field rows drop out (header + shell only); below
  ~15%, tables render as colored rectangles. SVG text is the dominant cost — at overview
  zoom none is rendered.
- **Viewport culling:** offscreen tables/edges unmounted when zoomed in (with margin).
- **Memoized table components** keyed by `schema.table`; editing one table re-renders one
  table.
- **Minimap** always renders the cheapest LOD; click/drag to navigate.

**Edge routing:** edges anchor at the specific field row, exit left/right toward the
partner table, and route orthogonally around table rectangles via a channel router.
Cardinality markers per ref type. Full re-route on drop and after auto-layout only.
Hover/select highlights a table's edges and partner tables.

**Auto-layout:** `elkjs` layered algorithm in the worker. Manual positions are never
disturbed by edits — auto-layout runs only on explicit button press (with canvas-undo).

## 7. Editor internals

- **Language mode:** hand-written CodeMirror 6 mode — instant, error-tolerant highlighting
  fully decoupled from the semantic parser (colors never flicker mid-edit; one malformed
  block doesn't kill highlighting elsewhere).
- **Autocomplete** (from last good parse): table names in `Ref:` positions, column names
  after `table.`, column types, setting keywords inside `[...]`, and block snippets
  (`Table`, `Ref`, `Enum`, `TableGroup`, `indexes`).
- **Diagnostics:** `@dbml/core` compiler errors normalized to `{from, to, message}` with
  exact line/col; squiggles + collapsible problems panel.
- **Two-way navigation:** cursor inside a table definition softly highlights that table on
  canvas; double-clicking a canvas table scrolls/flashes its definition in the editor.
- **Format document:** re-emits canonical DBML from the parsed model. Enabled only when the
  parse is clean, so formatting never eats content the parser couldn't understand.

## 8. Persistence & recovery

- IndexedDB via `idb`. Diagram row: `{id, name, dbml, layout, viewport, updatedAt}`.
- **Autosave:** 1s debounce after a clean parse; raw source is also saved while dirty, so a
  refresh mid-edit loses nothing (diagram re-syncs on next clean parse).
- **Snapshots:** ring buffer of last 20 saves per diagram; History panel lists them with
  timestamps and restores non-destructively (restore is itself snapshotted).
- **Storage unavailable** (private mode, quota): app runs in-memory with a persistent
  "storage unavailable — download your work" banner; export always works.

## 9. Error handling

- **Parse errors are the normal case** (user is mid-keystroke): handled by stale-render
  design — never a blank canvas, never a modal.
- **SQL import failure:** importer message with line context shown in the import dialog;
  current diagram untouched.
- **Canvas crash:** React error boundary shows a recovery pane (DBML intact, one-click
  export); the editor keeps working independently.
- **Worker crash:** auto-restart and re-parse once; two consecutive crashes on identical
  input → inline error report instead of a retry loop.

## 10. Testing

- **Unit (vitest):** all of `core/` — parse wrapper, converter round-trips
  (DBML → SQL → DBML fixtures per dialect), edge-router geometry, incremental placement,
  rename heuristic, persistence against `fake-indexeddb`. Editor completion/lint sources
  tested headlessly with CodeMirror's test utilities.
- **E2E (Playwright), golden flows:** type DBML → tables appear; break syntax → canvas
  persists with stale badge; import SQL per dialect; export each format; drag with
  snap/undo; reload → everything restored; snapshot restore; theme toggle.
- **Performance guard (CI):** 120-table fixture; asserts parse-to-render budget and
  pan/drag frame budget via Playwright tracing.

## 11. Milestones (implementation order)

1. **Skeleton:** Vite + React + TS, split-pane shell, CodeMirror with DBML highlighting,
   worker parse pipeline, plain table rendering (no edges), zustand store.
2. **Core diagram:** edges with field anchors + routing, drag/pan/zoom, positions persisted,
   IndexedDB autosave, diagram manager.
3. **Editor depth:** autocomplete, diagnostics panel, two-way navigation, format.
4. **Canvas depth:** snap/guides, multi-select, minimap, LOD + culling, auto-layout,
   groups, sticky notes, theme.
5. **Interop:** SQL import/export, PNG/SVG export, project files, snapshots/History.
6. **Hardening:** perf fixture in CI, E2E suite, error boundaries, storage-failure paths.
