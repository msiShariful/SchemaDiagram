# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SchemaDiagram — a local-first dbdiagram.io-style editor: DBML text on the left, live ER diagram on the right. React 19 + TypeScript (strict) + Vite, zustand, CodeMirror 6, `@dbml/core`, custom SVG canvas, IndexedDB. No backend.

Design spec lives in `docs/superpowers/specs/`, per-milestone implementation plans in `docs/superpowers/plans/`. Milestones are tagged `plan-N-complete`. All seven milestones are complete (Plan 7: completeness — ref authoring from the canvas via the text bridge, field badges/tooltips, highlight mode, Cmd/Ctrl+K quick-search, group collapse, escape overlay-stack, toolbar undo/redo, sample diagram, print-to-PDF, Snowflake import). Regression guards: `npm test` (vitest units), `npm run test:e2e` (Playwright golden flows + perf budget), `npm run check:bundle` (main-chunk gzip budget + lazy-lib leak markers).

## Commands

```bash
npm run dev                                   # Vite dev server
npm test                                      # vitest run (full suite)
npx vitest run src/core/parse                 # one directory
npx vitest run src/editor/completion.test.ts  # one file
npm run test:watch                            # watch mode
npm run build                                 # tsc (strict, noEmit) + vite build
npx tsc --noEmit                              # typecheck only
npm run test:e2e                              # Playwright E2E (once: npx playwright install chromium)
npm run check:bundle                          # build + main-chunk gzip budget / lazy-lib leak check
```

Tests run in vitest's node environment — no DOM. Persistence tests use `fake-indexeddb`; editor logic is tested headlessly with CodeMirror's `EditorState` / `CompletionContext` / `StringStream`. Component wiring has no unit tests by design; it is verified in the browser. Playwright E2E lives in `e2e/` (`*.spec.ts`, excluded from vitest via `test.include`); specs auto-start the dev server (`webServer` in `playwright.config.ts`) and may drive state through the dev-only `window.__appStore` hook.

Work on a feature branch per plan (`feature/plan-N-...`); never implement directly on `main`.

## Architecture invariants (do not break)

**Layering:** `src/core/` is pure TypeScript — it must never import React, zustand, or anything from `src/app|editor|canvas`. (`src/editor/` and `src/canvas/` may import `src/app/store`.) Audit: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` must return nothing.

**Last good parse:** the canvas always renders the last successfully parsed schema. `applyParse` on failure sets only `errors`/`stale` — it must never clear `schema` or `positions`. Parse errors are the normal state while typing; the UI shows a stale badge, never a blank canvas.

**Data flow:** keystroke → `store.source` → 300 ms debounced, latest-wins pipeline (`src/core/parse/pipeline.ts` — the sequence number is bumped in `push()`, not at timer fire; this prevents a stale in-flight parse from landing on a freshly switched diagram) → `@dbml/core` parse in a Web Worker (in-thread fallback; the adapter in `workerParse.ts` has a dead-flag + `dispose()`, restarts a crashed worker once per input (`crashPolicy.ts`; two consecutive crashes on identical input → inline error, spec §9), and **lazy-imports** the parser on fallback paths — a failed chunk load resolves as `{ok:false, parser unavailable}` — keeping `@dbml/core` out of the main chunk: main chunk is ~211 kB gzip (budget 230 KiB, enforced by `npm run check:bundle` — raised 210→230 in Plan 7 as a deliberate decision: the gate catches accidental heavyweight imports via the unchanged @dbml/core/elkjs leak markers, it does not cap deliberate feature growth) vs the ~2.7 MB worker chunk) → `reconcilePositions` (rename heuristic: same field signature keeps position) + `placeNewTables`.

**Text vs layout:** canvas interactions (drag, viewport, selection, visibility) write only layout state (`commitCanvasCommand`, `setViewport`, selection, `setHiddenTables`) — never DBML text. `hiddenTableIds` and `collapsedGroupIds` are view state: persisted per diagram (optional fields, like `notePositions`), pruned on parse like selection, filtered at render time (never on the imperative pan/drag paths). The effective hidden set is DERIVED (`effectiveHiddenIds` — explicit hides ∪ collapsed groups' members), never written back. Table identity is `${schemaName}.${name}` with `public` default; `src/core/parse/parseDbml.ts` (normalizer) and `src/editor/sourceMap.ts` (text scanner) must agree on it.

**Canvas→text bridge:** canvas-origin UI may request TEXT edits only through `editorNav` (one CodeMirror transaction per user action; editor history owns undo; the parse pipeline re-renders the result). `applyTableSettings` (table rename / headerColor, `src/editor/tableSettings.ts` is the pure rewriter) and the ref suite `appendRefLine`/`applyRefOperator`/`deleteRefLine` (`src/editor/refEdit.ts` is the pure locator/builder; inline-defined refs are REFUSED with a Reveal jump — `Ref.inline` from the normalizer) are its users, alongside `applyFormat`/`revealTable`. Canvas-origin transactions carry a `userEvent` annotation so editor history never merges them into adjacent typing. Renaming does not rewrite refs — dangling refs surface as ordinary parse errors. Drag, viewport, selection, and visibility (`hiddenTableIds`) stay layout-only and never touch DBML.

**Canvas performance contract:** pan/zoom/drag bypass React — transforms via refs and direct `setAttribute`, edges re-routed imperatively through `EdgeLayer`'s `updateTablePositions` during a drag; the store commits on gesture end only, via `commitCanvasCommand` (zero-delta commits are pruned, so clicks/double-clicks never pollute canvas undo history). `TableNode` is memoized: every prop passed to it must be referentially stable (module-level functions or store actions, no inline closures in the `.map()`). Toolbar undo/redo subscribes to `canvasStackVersion`, a counter bumped only inside the existing commit/undo/redo/load `set()` calls — never add a store write to a per-tick path for it. Escape handling for overlays goes through `src/app/overlayStack.ts` (topmost-only); the canvas clear-selection Escape acts only when the stack is empty.

**Persistence safety:** `usePersistence` autosaves 1 s debounced with a generation stamp; `invalidatePendingAutosave()` before `loadDiagram`-driven switches (and when deleting the *current* diagram) prevents a pending save from resurrecting a deleted record — do not simplify it away. Any repository call failure must degrade to `setStorageUnavailable(true)` + in-memory operation, never an unhandled rejection. Snapshots (History) are deliberately best-effort: `maybeSnapshot` runs only after `putDiagram` has succeeded and swallows every failure without flipping `storageUnavailable` — the diagram write just proved storage works, so a failed snapshot must never surface or abort a save.

**@dbml/core version pin:** stay on `^8.3.x` stable and parse with the `'dbmlv2'` format. npm's `latest` dist-tag points at a 9.x prerelease whose grammar (like 8.x's legacy `'dbml'` peg format) rejects single-line DBML that dbdiagram.io accepts. If you ever bump it, re-run the single-line fixtures in `parseDbml.test.ts` first. The normalizer is the only place `any` is allowed (the `@dbml/core` object boundary); our `Schema` type is the contract — adapt the normalizer, never test expectations.

**Formatter is whitespace-only by design** (`src/core/format/formatDbml.ts`): indentation/blank-run/trailing-space normalization that byte-preserves comments and strings, and is idempotent. Do not "upgrade" it to re-emit from the parsed model — that silently deletes `//` comments (spec revision of 2026-07-08).

**Editor intelligence is injected, not coupled:** completion reads the schema via a `getSchema` thunk (last good parse — never re-parse on keystroke); `editorNav.ts` is a single-registered-view module (`registerEditorView`) that `App`/canvas call into for reveal/format.

## Known deferred items

Cross-review deferred fixes are tracked in the untracked ledger `.superpowers/sdd/progress.md`. Still open after Plan 5: SVG/PNG export serializes whatever LOD is currently mounted (forcing full detail needs an off-screen re-render — see the ponytail note in `svgExport.ts`); stale-drag click-select of a pruned table id (exotic, self-correcting). The Plan 5 wave closed: workerParse lazy-chunk `.catch`, worker crash restart, pan-from-anywhere, note drag threshold, theme FOUC, minimap pointercancel commit, marquee/pan pointer interleave.
