# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Local-first dbdiagram.io clone: DBML text on the left, live ER diagram on the right. React 19 + TypeScript (strict) + Vite, zustand, CodeMirror 6, `@dbml/core`, custom SVG canvas, IndexedDB. No backend.

Design spec lives in `docs/superpowers/specs/`, per-milestone implementation plans in `docs/superpowers/plans/`. Milestones are tagged `plan-N-complete`. Remaining roadmap: Plan 3 canvas depth (LOD/culling, minimap, snap/guides, groups, sticky notes, ELK auto-layout, dark theme), Plan 4 interop (SQL import/export, PNG/SVG, snapshots), Plan 5 hardening (E2E, perf CI, bundle budget).

## Commands

```bash
npm run dev                                   # Vite dev server
npm test                                      # vitest run (full suite)
npx vitest run src/core/parse                 # one directory
npx vitest run src/editor/completion.test.ts  # one file
npm run test:watch                            # watch mode
npm run build                                 # tsc (strict, noEmit) + vite build
npx tsc --noEmit                              # typecheck only
```

Tests run in vitest's node environment — no DOM. Persistence tests use `fake-indexeddb`; editor logic is tested headlessly with CodeMirror's `EditorState` / `CompletionContext` / `StringStream`. Component wiring has no unit tests by design; it is verified in the browser.

Work on a feature branch per plan (`feature/plan-N-...`); never implement directly on `main`.

## Architecture invariants (do not break)

**Layering:** `src/core/` is pure TypeScript — it must never import React, zustand, or anything from `src/app|editor|canvas`. (`src/editor/` and `src/canvas/` may import `src/app/store`.) Audit: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` must return nothing.

**Last good parse:** the canvas always renders the last successfully parsed schema. `applyParse` on failure sets only `errors`/`stale` — it must never clear `schema` or `positions`. Parse errors are the normal state while typing; the UI shows a stale badge, never a blank canvas.

**Data flow:** keystroke → `store.source` → 300 ms debounced, latest-wins pipeline (`src/core/parse/pipeline.ts` — the sequence number is bumped in `push()`, not at timer fire; this prevents a stale in-flight parse from landing on a freshly switched diagram) → `@dbml/core` parse in a Web Worker (in-thread fallback; the adapter in `workerParse.ts` has a dead-flag + `dispose()` and **lazy-imports** the parser on fallback paths to keep `@dbml/core` out of the main chunk — main chunk is ~198 kB gzip vs the ~2.7 MB worker chunk) → `reconcilePositions` (rename heuristic: same field signature keeps position) + `placeNewTables`.

**Text vs layout:** canvas interactions (drag, viewport, selection) write only layout state (`commitCanvasCommand`, `setViewport`, selection) — never DBML text. Table identity is `${schemaName}.${name}` with `public` default; `src/core/parse/parseDbml.ts` (normalizer) and `src/editor/sourceMap.ts` (text scanner) must agree on it.

**Canvas performance contract:** pan/zoom/drag bypass React — transforms via refs and direct `setAttribute`, edges re-routed imperatively through `EdgeLayer`'s `updateTablePositions` during a drag; the store commits on gesture end only, via `commitCanvasCommand` (zero-delta commits are pruned, so clicks/double-clicks never pollute canvas undo history). `TableNode` is memoized: every prop passed to it must be referentially stable (module-level functions or store actions, no inline closures in the `.map()`).

**Persistence safety:** `usePersistence` autosaves 1 s debounced with a generation stamp; `invalidatePendingAutosave()` before `loadDiagram`-driven switches (and when deleting the *current* diagram) prevents a pending save from resurrecting a deleted record — do not simplify it away. Any repository call failure must degrade to `setStorageUnavailable(true)` + in-memory operation, never an unhandled rejection. Snapshots (History) are deliberately best-effort: `maybeSnapshot` runs only after `putDiagram` has succeeded and swallows every failure without flipping `storageUnavailable` — the diagram write just proved storage works, so a failed snapshot must never surface or abort a save.

**@dbml/core version pin:** stay on `^8.3.x` stable and parse with the `'dbmlv2'` format. npm's `latest` dist-tag points at a 9.x prerelease whose grammar (like 8.x's legacy `'dbml'` peg format) rejects single-line DBML that dbdiagram.io accepts. If you ever bump it, re-run the single-line fixtures in `parseDbml.test.ts` first. The normalizer is the only place `any` is allowed (the `@dbml/core` object boundary); our `Schema` type is the contract — adapt the normalizer, never test expectations.

**Formatter is whitespace-only by design** (`src/core/format/formatDbml.ts`): indentation/blank-run/trailing-space normalization that byte-preserves comments and strings, and is idempotent. Do not "upgrade" it to re-emit from the parsed model — that silently deletes `//` comments (spec revision of 2026-07-08).

**Editor intelligence is injected, not coupled:** completion reads the schema via a `getSchema` thunk (last good parse — never re-parse on keystroke); `editorNav.ts` is a single-registered-view module (`registerEditorView`) that `App`/canvas call into for reveal/format.

## Known deferred items

Cross-review deferred fixes are tracked in the untracked ledger `.superpowers/sdd/progress.md`. The ones that become load-bearing next: guard `onCommitMove` against zero-delta commits **before** Plan 3 adds canvas undo (double-click currently fires two no-op commits); `applyFormat`'s stale check races the 300 ms parse debounce (gate on `parsedSource === doc` when convenient); workerParse's lazy-chunk load failure path needs a `.catch` → `{ok:false, errors:[{message:'parser unavailable',...}]}` (Plan 5).
