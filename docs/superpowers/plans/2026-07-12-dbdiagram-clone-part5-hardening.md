# dbdiagram Clone — Plan 5: Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone 6 (spec §11.6): the app becomes regression-proof. Worker-parse failure paths are closed (lazy-chunk load failure resolves as a normal parse error; a crashed worker auto-restarts and re-parses once, two consecutive crashes on identical input produce an inline error instead of a retry loop — spec §9); a React error boundary keeps the editor alive through any canvas crash with a one-click `.dbml` escape hatch (spec §9); a Playwright E2E suite covers the spec §10 golden flows; the 120-table / ~1200-field / 150-ref perf fixture (spec §6) gets a generator, a parse-to-render budget and a pan long-task smoke; a bundle-budget script fails the build when the main chunk exceeds ~210 kB gzip or a lazy-only library leaks into it; and the Plan 3/4 review-debt polish wave lands (pan-from-anywhere, note drag threshold, theme FOUC, minimap pointercancel commit, marquee/pan pointer interleave guard).

**Architecture:** Decision logic stays pure and in core — the worker crash-restart policy is a standalone module (`src/core/parse/crashPolicy.ts`) unit-tested headlessly, wired into the existing `createWorkerParse` adapter; the perf fixture generator is pure string code in `src/core/perf/`. Everything DOM/React-shaped lives where its consumers are: the error boundary in `src/app/`, gesture polish in `src/canvas/`, the FOUC guard inline in `index.html`. E2E is Playwright's exclusive domain: specs are `e2e/*.spec.ts`, excluded from vitest by narrowing `test.include` to `src/**/*.test.ts`; they run against the Vite dev server via `webServer` and may drive state through a dev-only `window.__appStore` hook (dead-code-eliminated from production builds). Budgets are scripts, not opinions: `scripts/check-bundle.mjs` builds and enforces the gzip budget plus lazy-lib marker strings.

**Tech Stack:** Existing Plans 1–4 stack, plus two new devDependencies, both exact-pinned and verified as npm `latest` on 2026-07-12: `@playwright/test` **1.61.1** and `@types/node` **26.1.1** (the latter exists solely so `tsc` can typecheck `process.env` and `node:fs` in `playwright.config.ts`/`e2e/` — nothing else in the repo pulls it in). **No new runtime dependencies.** Chromium only (`npx playwright install chromium`; on Linux CI add `--with-deps`).

## Verified environment facts (checked against the working tree / npm — do not trust memory)

- HEAD is `7377807`, **223/223** vitest tests green, main chunk 208.37 kB gzip (vite-reported at HEAD; the last-built `dist/` measures 205,883 raw gzip bytes).
- The entry chunk contains **zero** occurrences of `org.eclipse.elk` and `dbmlv2` today (verified by grep on `dist/assets/index-*.js`). `src/core/layout/elkGraph.ts` uses `elk.*` option keys, NOT `org.eclipse.elk*` — that marker exists only inside the lazy `elk.bundled` chunk. The `dbmlv2` literal lives only in `src/core/parse/parseDbml.ts`, which is reachable from the main thread solely via dynamic import — so either marker appearing in the entry chunk proves a leak.
- `npm view @playwright/test version` → **1.61.1** (`dist-tags.latest` agrees).
- Vite dev server runs on the default port **5173** (no `server` override in `vite.config.ts`).
- vitest runs in **node** env with no `include` override today; every unit test matches `src/**/*.test.ts` (no `.test.tsx` files exist).
- In vitest's node env there is no `Worker` global — `createWorkerParse` takes its no-Worker fallback path; the worker path is tested with a `FakeWorker` stub (existing harness in `workerParse.test.ts`).
- `tsconfig.json` `include` is `["src", "vite.config.ts"]`; `npm run build` = `tsc && vite build`.
- Table `<g>` elements have class `table-node` (`.table-title` text = table name); edges are `g.edge`; the stale badge is `.badge.stale` with text "diagram out of date"; the status bar renders `.status-ok` / `.status-errors`; export/history/diagrams toolbar buttons are labeled `▼ export` / `▼ history` / `▼ diagrams`; the import dialog textarea is `.dialog-text` and its confirm button is "Import as new diagram"; History rows are `.history-panel li` with a "restore" button.
- Starter diagram = 3 tables (`users`, `posts`, `comments`); a fresh browser context always boots into it. `placeNewTables` origin is (60, 60); `GRID_SIZE` is 16; alignment snap only triggers when other positioned tables exist, so a **single-table** document always pure-grid-snaps.
- App theme: `App.tsx` stamps `document.documentElement.dataset.theme` in a `useEffect` from localStorage key `dbdraft.theme`; the theme toggle button's label is the *target* theme ("Dark" while light).
- `DiagramCanvas` pan currently requires `e.target === svgRef.current` (empty canvas only); `NoteNode` has no drag threshold; `MiniMap`'s `onPointerCancel` drops the scrub without committing.

## Global Constraints

- TypeScript `strict: true`; no new `any` (the `@dbml/core` object boundary in `parseDbml.ts` remains the only allowed exception).
- **Core purity:** `src/core/` MUST NOT import React, zustand, or anything from `src/app|editor|canvas`. New core files this plan adds (`crashPolicy.ts`, `perf/fixture.ts`) import nothing outside core. Audit stays: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` returns nothing.
- **Last good parse:** untouched. Worker crash / chunk-load failure surface as ordinary `{ok:false}` parse results — `applyParse` on failure sets only `errors`/`stale`, never clears `schema`/`positions`. The canvas keeps rendering the last good schema through every failure mode this plan adds.
- **Canvas performance contract:** pan/zoom/drag stay off React (refs + `setAttribute`, store commits at gesture end). The pan-from-anywhere change moves pan arming to the capture phase but changes nothing about how pan applies transforms. `TableNode` prop stability rules unchanged.
- **@dbml/core pin:** stay on `^8.3.x` / `'dbmlv2'`; npm `latest` is a 9.x prerelease — never bump. The only static `from '@dbml/core'` import in `src/` remains `src/core/parse/parseDbml.ts`.
- **Bundle budget:** main chunk ≤ 210 KiB gzip (215,040 bytes), enforced by `scripts/check-bundle.mjs`, which also fails if the entry chunk contains `org.eclipse.elk` or `dbmlv2` (lazy-only markers). Budget rationale: CLAUDE.md pins "~210 kB"; HEAD measures 208.37 kB, leaving ~6 kB headroom for this plan's small UI additions while an accidental static import of `@dbml/core` (~2.7 MB chunk) or `elk.bundled` (~1.4 MB) overshoots by an order of magnitude and is additionally named by the marker check.
- **Tests:** vitest stays **node** env, NO DOM, and must never pick up Playwright specs. Exact config change (Task 6): `vite.config.ts` `test` block gains `include: ['src/**/*.test.ts']`. Naming convention: unit tests are `*.test.ts` under `src/`; Playwright specs are `*.spec.ts` under `e2e/` and import only from `@playwright/test` + `src` source modules — **never** from `vitest`. The perf fixture generator is pure core code with vitest unit tests; the Playwright perf spec is not a unit test.
- **New dependencies:** devDependencies `@playwright/test@1.61.1` and `@types/node@26.1.1` (both exact pins; `@types/node` is required because `tsconfig.json` now typechecks `playwright.config.ts` + `e2e/`, which use `process.env` and `node:fs` — without it `tsc` fails with TS2580/TS2307). Nothing else, dev or runtime.
- **CI-tolerant budgets:** every E2E/perf assertion must be deterministic (auto-retrying `expect`, `expect.poll`, `toPass` — no `waitForTimeout` sleeps) and generous enough for shared CI runners; each numeric budget carries its rationale in a comment at the assertion site.
- **Persistence safety:** unchanged — every repository call failure degrades to `setStorageUnavailable(true)` + in-memory operation. The error boundary's download button and the E2E export flows read only the in-memory store.
- **Dev-only hook:** `window.__appStore` is assigned under `if (import.meta.env.DEV)` only — compile-time `false` in `vite build`, so it is dead-code-eliminated from production bundles.
- Explicitly **out of scope** (stays on the deferred ledger): forcing full LOD before SVG/PNG export (`svgExport.ts` ponytail note — needs an off-screen React re-render, a feature not a fix) and the stale-drag click-select-dead-id minor.
- Working dir `/Users/sharif/Documents/dbdiagram`, branch `feature/plan-5-hardening` (created from `main` in Task 1). If `node_modules` is missing, restore with `npm install` (lockfile-driven).
- Commands exactly as in CLAUDE.md: `npm test`, `npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`; this plan adds `npm run test:e2e` and `npm run check:bundle`.

---

### Task 1: workerParse lazy-chunk failure path — parser-unavailable result, never a hung promise

**Files:**
- Modify: `src/core/parse/workerParse.ts`
- Test: `src/core/parse/workerParse.test.ts` (append)

**Interfaces:**
- Consumes: `ParseResult` from `./parseDbml` (type-only).
- Produces:
  - `createWorkerParse(loadParser?: () => Promise<{ parseDbml: (source: string) => ParseResult }>): WorkerParseAdapter` — the optional parameter is a test seam; production callers (`useParsePipeline`) keep calling `createWorkerParse()` with the default `() => import('./parseDbml')`.
  - `PARSER_UNAVAILABLE_MESSAGE: string` — exported so tests and Task 2 reuse the exact text.
  - Behavior: every in-thread fallback path (no-Worker environment, dead adapter, shutdown-with-pending) settles a failed lazy import as `{ok:false, errors:[{message: PARSER_UNAVAILABLE_MESSAGE, line:1, column:1}]}` — never an unhandled rejection, never a permanently pending promise. This is the original CLAUDE.md deferred item.

- [ ] **Step 0: Branch**

```bash
cd /Users/sharif/Documents/dbdiagram && git checkout -b feature/plan-5-hardening
```

- [ ] **Step 1: Write the failing tests**

Append at the end of `src/core/parse/workerParse.test.ts` (the `FakeWorker` class is already module-scope in this file; also add `PARSER_UNAVAILABLE_MESSAGE` to the import from `./workerParse`):

Replace the import line
```ts
import { createWorkerParse } from './workerParse';
```
with
```ts
import { createWorkerParse, PARSER_UNAVAILABLE_MESSAGE } from './workerParse';
```
then append:
```ts
describe('createWorkerParse (lazy parser chunk fails to load)', () => {
  // Simulates the deployed-hash-rotated / offline case: import('./parseDbml')
  // rejects. Every fallback path must settle as {ok:false, parser unavailable}
  // — never an unhandled rejection, never a promise pending forever.
  const failingLoader = () => Promise.reject(new Error('chunk load failed'));
  const unavailable = {
    ok: false,
    errors: [{ message: PARSER_UNAVAILABLE_MESSAGE, line: 1, column: 1 }],
  };

  it('no-Worker fallback resolves {ok:false, parser unavailable} instead of rejecting', async () => {
    const adapter = createWorkerParse(failingLoader); // node: no Worker global
    await expect(adapter.parse('Table a { id int }')).resolves.toEqual(unavailable);
  });

  it('dispose() with requests in flight settles them as parser-unavailable', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const adapter = createWorkerParse(failingLoader);
      const inFlight = adapter.parse('Table a { id int }');
      adapter.dispose();
      await expect(inFlight).resolves.toEqual(unavailable);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('postMessage failure with a broken loader still resolves {ok:false}', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const adapter = createWorkerParse(failingLoader);
      const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
      instance.throwOnPost = true;
      await expect(adapter.parse('Table a { id int }')).resolves.toEqual(unavailable);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/parse/workerParse.test.ts` — Expected: FAIL (`PARSER_UNAVAILABLE_MESSAGE` not exported; `createWorkerParse` takes no parameter).

- [ ] **Step 3: Implement**

`src/core/parse/workerParse.ts` (complete replacement):
```ts
import type { ParseResult } from './parseDbml';

// Lazily loaded: @dbml/core (~2.9 MB gz) must not be pulled into the main
// chunk just to cover the rare paths below (no-Worker environments, or a
// worker that has died). The worker chunk (parser.worker.ts) still imports
// parseDbml eagerly/statically — that's the hot path and always needs it.
type ParserModule = { parseDbml: (source: string) => ParseResult };
const defaultLoadParser = (): Promise<ParserModule> => import('./parseDbml');

export const PARSER_UNAVAILABLE_MESSAGE =
  'DBML parser unavailable — its code chunk failed to load. Check your connection and reload.';

const PARSER_UNAVAILABLE: ParseResult = {
  ok: false,
  errors: [{ message: PARSER_UNAVAILABLE_MESSAGE, line: 1, column: 1 }],
};

export interface WorkerParseAdapter {
  parse(source: string): Promise<ParseResult>;
  dispose(): void;
}

export function createWorkerParse(
  loadParser: () => Promise<ParserModule> = defaultLoadParser,
): WorkerParseAdapter {
  // Every in-thread parse funnels through here. A failed lazy-chunk load
  // (offline, a deploy rotated the hashed assets) settles as a normal
  // {ok:false} ParseResult: parse errors are the pipeline's ordinary
  // currency, so the canvas keeps the last good schema and the problems
  // panel explains what happened — never an unhandled rejection, never a
  // promise left pending forever.
  const inThread = (source: string): Promise<ParseResult> =>
    loadParser().then(({ parseDbml }) => parseDbml(source), () => PARSER_UNAVAILABLE);

  let worker: Worker;
  try {
    worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    // No Worker support → in-thread for the lifetime of this adapter.
    return { parse: inThread, dispose() {} };
  }

  let nextId = 0;
  let dead = false;
  const pending = new Map<number, { source: string; resolve: (r: ParseResult) => void }>();

  // Marks the adapter dead, settles every in-flight call on the main thread
  // (so no promise is ever left permanently pending), and terminates the
  // worker. Used both for a genuine worker death and for explicit dispose.
  const shutdown = () => {
    if (dead) return;
    dead = true;
    for (const [id, p] of pending) {
      void inThread(p.source).then(p.resolve);
      pending.delete(id);
    }
    worker.terminate();
  };

  worker.onmessage = (e: MessageEvent<{ id: number; result: ParseResult }>) => {
    pending.get(e.data.id)?.resolve(e.data.result);
    pending.delete(e.data.id);
  };
  worker.onerror = () => {
    // Worker died: answer everything in-flight on the main thread instead,
    // and stop trying to use the worker for future calls.
    shutdown();
  };

  return {
    parse(source) {
      if (dead) return inThread(source);
      return new Promise<ParseResult>((resolve) => {
        const id = nextId++;
        pending.set(id, { source, resolve });
        try {
          worker.postMessage({ id, source });
        } catch {
          // postMessage failed (e.g. worker already terminated/closing):
          // settle this call plus anything else stuck in-flight, then die.
          shutdown();
        }
      });
    },
    dispose() {
      shutdown();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/parse` — Expected: PASS (3 new tests + all existing parse/pipeline/workerParse tests green; the existing fallback tests exercise the default loader and must be untouched by the new parameter).

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && git add src/core/parse/workerParse.ts src/core/parse/workerParse.test.ts && git commit -m "fix: workerParse lazy-chunk load failure resolves as parser-unavailable result"
```

---

### Task 2: Worker crash resilience — pure restart policy + adapter wiring (spec §9)

**Files:**
- Create: `src/core/parse/crashPolicy.ts`
- Create: `src/core/parse/crashPolicy.test.ts`
- Modify: `src/core/parse/workerParse.ts`
- Test: `src/core/parse/workerParse.test.ts` (replace the worker-path describe)

**Interfaces:**
- Produces (`crashPolicy.ts`, pure):
  - `interface CrashLedger { lastCrashedSource: string | null }`
  - `INITIAL_CRASH_LEDGER: CrashLedger`
  - `type CrashDecision = { action: 'restart'; ledger: CrashLedger } | { action: 'report'; ledger: CrashLedger }`
  - `decideOnCrash(ledger: CrashLedger, newestSource: string | null): CrashDecision`
- Produces (`workerParse.ts`):
  - `WORKER_CRASHED_MESSAGE: string`
  - Behavior (spec §9 verbatim): worker crash → terminate, restart a fresh worker, re-post everything that was in flight (re-parse once). Two consecutive crashes on identical input → the in-flight promises resolve with `{ok:false, errors:[{message: WORKER_CRASHED_MESSAGE, …}]}` and nothing is auto-re-posted (no retry loop); a fresh worker is still spawned for *future, different* input, and because the ledger keeps the poisoned source, a user re-push of the identical text that crashes again reports again instead of looping. Any successful worker response resets the ledger (the chain must be CONSECUTIVE). `dispose()` and `postMessage` failure keep Task 1's shutdown semantics (they are not crashes).
- Testing split per the scope: the *decision* logic is unit-tested exhaustively in `crashPolicy.test.ts`; the adapter re-post wiring is covered by the existing FakeWorker harness (still headless); the browser step is a regression sweep only — a real worker crash cannot be triggered deterministically from the page.

- [ ] **Step 1: Write the failing policy tests**

`src/core/parse/crashPolicy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decideOnCrash, INITIAL_CRASH_LEDGER } from './crashPolicy';

const SRC_A = 'Table a { id int }';
const SRC_B = 'Table b { id int }';

describe('decideOnCrash (spec §9: restart once, report on 2nd identical crash)', () => {
  it('first crash on a source → restart, remembering that source', () => {
    const d = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    expect(d.action).toBe('restart');
    expect(d.ledger.lastCrashedSource).toBe(SRC_A);
  });

  it('second consecutive crash on the identical source → report, no retry loop', () => {
    const first = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    const second = decideOnCrash(first.ledger, SRC_A);
    expect(second.action).toBe('report');
  });

  it('crash on a DIFFERENT source after a crash → restart again', () => {
    const first = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    const second = decideOnCrash(first.ledger, SRC_B);
    expect(second.action).toBe('restart');
    expect(second.ledger.lastCrashedSource).toBe(SRC_B);
  });

  it('report keeps the poisoned source, so a re-push of the same text reports again', () => {
    const first = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    const second = decideOnCrash(first.ledger, SRC_A);
    const third = decideOnCrash(second.ledger, SRC_A);
    expect(third.action).toBe('report');
  });

  it('a crash with nothing in flight → restart, and the ledger clears', () => {
    const d = decideOnCrash({ lastCrashedSource: SRC_A }, null);
    expect(d.action).toBe('restart');
    expect(d.ledger.lastCrashedSource).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/parse/crashPolicy.test.ts` — Expected: FAIL (cannot resolve `./crashPolicy`).

- [ ] **Step 3: Implement the policy module**

`src/core/parse/crashPolicy.ts`:
```ts
/** Worker crash policy (spec §9): a crashed parse worker is restarted and
 *  the in-flight source re-parsed ONCE; two consecutive crashes on identical
 *  input produce an inline error report instead of a retry loop. Pure — the
 *  adapter (workerParse.ts) owns timing and wiring, this module owns only
 *  the decision, so it is testable without a Worker or a DOM. */

export interface CrashLedger {
  /** Source text in flight at the previous crash; null after any success
   *  ("consecutive" means no successful parse in between). */
  lastCrashedSource: string | null;
}

export const INITIAL_CRASH_LEDGER: CrashLedger = { lastCrashedSource: null };

export type CrashDecision =
  | { action: 'restart'; ledger: CrashLedger }
  | { action: 'report'; ledger: CrashLedger };

/** `newestSource` is the most recent source in flight at crash time (null
 *  when the worker died with nothing pending). Report is only ever chosen
 *  for a repeat of the exact text that just crashed — a different edit
 *  always earns a fresh restart. The ledger keeps the poisoned source after
 *  a report, so an identical re-push that crashes again reports again
 *  (each user retry costs one bounded restart, never an automatic loop). */
export function decideOnCrash(ledger: CrashLedger, newestSource: string | null): CrashDecision {
  if (newestSource !== null && ledger.lastCrashedSource === newestSource) {
    return { action: 'report', ledger };
  }
  return { action: 'restart', ledger: { lastCrashedSource: newestSource } };
}
```

Run: `npx vitest run src/core/parse/crashPolicy.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 4: Write the failing adapter tests**

In `src/core/parse/workerParse.test.ts`, update the import once more:
```ts
import { createWorkerParse, PARSER_UNAVAILABLE_MESSAGE, WORKER_CRASHED_MESSAGE } from './workerParse';
```
and replace the entire `describe('createWorkerParse (worker path, fake Worker)', …)` block with (the fallback-path describe, the `FakeWorker` class, and Task 1's failing-loader describe stay exactly as they are):
```ts
describe('createWorkerParse (worker path, fake Worker)', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const spawn = () => {
    const adapter = createWorkerParse();
    const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
    return { adapter, instance };
  };

  const okResult: ParseResult = {
    ok: true,
    schema: { tables: [], refs: [], enums: [], groups: [], notes: [] },
  };

  it('happy path: posts to the worker and resolves with the worker-provided result', async () => {
    const { adapter, instance } = spawn();
    const promise = adapter.parse('Table a { id int }');
    expect(instance.posted).toEqual([{ id: 0, source: 'Table a { id int }' }]);
    instance.onmessage?.({ data: { id: 0, result: okResult } });
    await expect(promise).resolves.toBe(okResult);
    expect(instance.terminateCount).toBe(0);
  });

  it('a crash restarts the worker and re-parses the in-flight source once (spec §9)', async () => {
    const { adapter, instance } = spawn();
    const p = adapter.parse('Table a { id int }');
    instance.onerror?.(); // crash #1
    expect(instance.terminateCount).toBe(1);
    expect(FakeWorker.instances).toHaveLength(2); // restarted
    const second = FakeWorker.instances[1];
    expect(second.posted).toEqual([{ id: 1, source: 'Table a { id int }' }]); // re-posted
    second.onmessage?.({ data: { id: 1, result: okResult } });
    await expect(p).resolves.toBe(okResult);
  });

  it('two consecutive crashes on identical input resolve with the inline crash error, nothing auto-retried', async () => {
    const { adapter, instance } = spawn();
    const p = adapter.parse('Table a { id int }');
    instance.onerror?.(); // crash #1 → restart + re-post
    FakeWorker.instances[1].onerror?.(); // crash #2, same source → report
    const r = await p;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toBe(WORKER_CRASHED_MESSAGE);
    // a THIRD worker exists to serve future (different) input,
    // but the crashed source was NOT auto re-posted — no retry loop.
    expect(FakeWorker.instances).toHaveLength(3);
    expect(FakeWorker.instances[2].posted).toHaveLength(0);
    // future parses go to the fresh worker
    const p2 = adapter.parse('Table b { id int }');
    expect(FakeWorker.instances[2].posted).toEqual([{ id: 2, source: 'Table b { id int }' }]);
    FakeWorker.instances[2].onmessage?.({ data: { id: 2, result: okResult } });
    await expect(p2).resolves.toBe(okResult);
  });

  it('a successful response breaks the crash chain: the same source crashing later restarts again', async () => {
    const { adapter, instance } = spawn();
    const p1 = adapter.parse('Table a { id int }');
    instance.onerror?.(); // crash #1 → restart, re-post as id 1
    const w2 = FakeWorker.instances[1];
    w2.onmessage?.({ data: { id: 1, result: okResult } }); // success resets the ledger
    await p1;
    const p2 = adapter.parse('Table a { id int }'); // id 2, same text as the old crash
    w2.onerror?.(); // crash again — but the chain was broken
    const w3 = FakeWorker.instances[2];
    expect(w3.posted).toEqual([{ id: 3, source: 'Table a { id int }' }]); // restart, not report
    w3.onmessage?.({ data: { id: 3, result: okResult } });
    await expect(p2).resolves.toBe(okResult);
  });

  it('postMessage throwing settles that call via fallback and marks the adapter dead', async () => {
    const { adapter, instance } = spawn();
    instance.throwOnPost = true;
    await expect(adapter.parse('Table a { id int }')).resolves.toMatchObject({ ok: true });
    expect(instance.terminateCount).toBe(1);
    // Even with a now-working postMessage, the dead adapter never posts again.
    instance.throwOnPost = false;
    await expect(adapter.parse('Table b { id int }')).resolves.toMatchObject({ ok: true });
    expect(instance.posted).toHaveLength(0);
  });

  it('dispose() with a request in flight settles it and terminates exactly once', async () => {
    const { adapter, instance } = spawn();
    const inFlight = adapter.parse('Table a { id int }');
    expect(instance.posted).toHaveLength(1);
    adapter.dispose();
    await expect(inFlight).resolves.toMatchObject({ ok: true });
    expect(instance.terminateCount).toBe(1);
  });

  it('shutdown is idempotent: double dispose terminates the live worker at most once', () => {
    const first = spawn();
    first.adapter.dispose();
    first.adapter.dispose();
    expect(first.instance.terminateCount).toBe(1);

    // crash → the FIRST worker is terminated by the restart; dispose then
    // terminates the SECOND. Neither is ever terminated twice.
    const second = spawn();
    second.instance.onerror?.();
    second.adapter.dispose();
    expect(second.instance.terminateCount).toBe(1);
    expect(FakeWorker.instances[FakeWorker.instances.length - 1].terminateCount).toBe(1);
  });
});
```

Run: `npx vitest run src/core/parse/workerParse.test.ts` — Expected: FAIL (`WORKER_CRASHED_MESSAGE` not exported; crash currently shuts down instead of restarting).

- [ ] **Step 5: Implement the adapter wiring**

`src/core/parse/workerParse.ts` (complete replacement):
```ts
import type { ParseResult } from './parseDbml';
import { decideOnCrash, INITIAL_CRASH_LEDGER, type CrashLedger } from './crashPolicy';

// Lazily loaded: @dbml/core (~2.9 MB gz) must not be pulled into the main
// chunk just to cover the rare paths below (no-Worker environments, or a
// worker that has died for good). The worker chunk (parser.worker.ts) still
// imports parseDbml eagerly/statically — that's the hot path.
type ParserModule = { parseDbml: (source: string) => ParseResult };
const defaultLoadParser = (): Promise<ParserModule> => import('./parseDbml');

export const PARSER_UNAVAILABLE_MESSAGE =
  'DBML parser unavailable — its code chunk failed to load. Check your connection and reload.';
export const WORKER_CRASHED_MESSAGE =
  'The DBML parser crashed twice on this input. The diagram shows the last good parse — edit the text to retry.';

const failure = (message: string): ParseResult => ({
  ok: false,
  errors: [{ message, line: 1, column: 1 }],
});
const PARSER_UNAVAILABLE = failure(PARSER_UNAVAILABLE_MESSAGE);

export interface WorkerParseAdapter {
  parse(source: string): Promise<ParseResult>;
  dispose(): void;
}

export function createWorkerParse(
  loadParser: () => Promise<ParserModule> = defaultLoadParser,
): WorkerParseAdapter {
  // Every in-thread parse funnels through here. A failed lazy-chunk load
  // settles as a normal {ok:false} ParseResult — never an unhandled
  // rejection, never a promise left pending forever (Task 1 invariant).
  const inThread = (source: string): Promise<ParseResult> =>
    loadParser().then(({ parseDbml }) => parseDbml(source), () => PARSER_UNAVAILABLE);

  const spawnWorker = (): Worker =>
    new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });

  let worker: Worker;
  try {
    worker = spawnWorker();
  } catch {
    // No Worker support → in-thread for the lifetime of this adapter.
    return { parse: inThread, dispose() {} };
  }

  let nextId = 0;
  let dead = false;
  let ledger: CrashLedger = INITIAL_CRASH_LEDGER;
  const pending = new Map<number, { source: string; resolve: (r: ParseResult) => void }>();

  const drainPending = () => {
    const entries = [...pending.values()];
    pending.clear();
    return entries;
  };

  // Dead end: no worker will ever be used again (explicit dispose,
  // postMessage failure, or a failed respawn). Settles everything in-flight
  // in-thread so no promise is left permanently pending.
  const shutdown = () => {
    if (dead) return;
    dead = true;
    for (const p of drainPending()) void inThread(p.source).then(p.resolve);
    worker.terminate();
  };

  const post = (entry: { source: string; resolve: (r: ParseResult) => void }) => {
    const id = nextId++;
    pending.set(id, entry);
    try {
      worker.postMessage({ id, source: entry.source });
    } catch {
      // postMessage failed (worker already terminated/closing). Not a crash
      // — no restart: settle everything in-thread and die (Task 1 behavior).
      shutdown();
    }
  };

  // Function declarations (not consts): wire and onCrash reference each
  // other, and hoisting makes the mutual recursion legal without ceremony.
  function wire(w: Worker): void {
    w.onmessage = (e: MessageEvent<{ id: number; result: ParseResult }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      ledger = INITIAL_CRASH_LEDGER; // success breaks any crash chain (spec §9 "consecutive")
      p.resolve(e.data.result);
    };
    w.onerror = () => onCrash();
  }

  // Spec §9: restart + re-parse once; two consecutive crashes on identical
  // input resolve as an inline error instead of a retry loop. Note: a
  // worker 'error' event can also fire for a non-fatal uncaught error —
  // terminating and restarting is safe and deterministic either way.
  function onCrash(): void {
    if (dead) return;
    worker.terminate();
    const entries = drainPending();
    const newest = entries.length > 0 ? entries[entries.length - 1].source : null;
    const decision = decideOnCrash(ledger, newest);
    ledger = decision.ledger;
    if (decision.action === 'report') {
      // Inline error report: the stale badge + problems panel explain it;
      // the canvas keeps the last good parse. Nothing is auto-re-posted.
      for (const p of entries) p.resolve(failure(WORKER_CRASHED_MESSAGE));
    }
    let next: Worker;
    try {
      next = spawnWorker();
    } catch {
      // Cannot respawn → in-thread from now on.
      dead = true;
      if (decision.action === 'restart') {
        for (const p of entries) void inThread(p.source).then(p.resolve);
      }
      return;
    }
    worker = next;
    wire(worker);
    if (decision.action === 'restart') {
      for (const p of entries) post(p); // re-parse once on the fresh worker
    }
  }

  wire(worker);

  return {
    parse(source) {
      if (dead) return inThread(source);
      return new Promise<ParseResult>((resolve) => post({ source, resolve }));
    },
    dispose() {
      shutdown();
    },
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/core/parse` — Expected: PASS (crashPolicy 5 + workerParse 13: 3 fallback + 7 worker-path + 3 failing-loader; Task 1's tests must still pass unchanged — dispose/postMessage paths kept their semantics).

- [ ] **Step 7: Full suite, typecheck, browser regression, commit**

Run: `npx vitest run && npx tsc --noEmit` — Expected: green/clean.

Browser check (`npm run dev`) — a real worker crash cannot be forced deterministically from the page, so this is a regression sweep (the restart wiring is proven headlessly above):
1. Typing parses normally (status bar `✓ parsed`, canvas updates).
2. DevTools → Sources → Threads: exactly one `parser.worker` thread after a minute of editing (no worker leak from the new spawn path).

```bash
git add src/core/parse && git commit -m "feat: worker crash auto-restart with report-on-second-identical-crash (spec 9)"
```

---

### Task 3: Canvas error boundary + dev-only store hook (spec §9)

**Files:**
- Create: `src/app/CanvasErrorBoundary.tsx`
- Modify: `src/app/App.tsx`, `src/main.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `downloadText` (`src/app/export/download.ts`), `safeFilename` (`src/app/export/exportCss.ts`), `useAppStore`.
- Produces:
  - `<CanvasErrorBoundary>{children}</CanvasErrorBoundary>` — class component (React still has no hook for `getDerivedStateFromError`). Fallback pane: explanation, the crash message, a "Download your work (.dbml)" button (in-memory store only — works with storage unavailable), and a "Re-render canvas" button that clears the error; because the children were unmounted while the fallback showed, re-rendering them mounts a **fresh** `DiagramCanvas` (fresh refs/ledgers) — no `key` needed.
  - `window.__appStore` (dev builds only): the zustand store hook, used by this task's walkthrough and by the Task 9 perf spec. `import.meta.env.DEV` is compile-time `false` under `vite build`, so the assignment is dead-code-eliminated from production bundles.
- The editor is OUTSIDE the boundary: a canvas render crash never touches CodeMirror, the store, or persistence (spec §9: "the editor keeps working independently").

- [ ] **Step 1: Implement**

`src/app/CanvasErrorBoundary.tsx`:
```tsx
import { Component, type ReactNode } from 'react';
import { useAppStore } from './store';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';

interface State {
  error: Error | null;
}

/** React error boundary around the canvas pane (spec §9): a canvas crash
 *  must never take the editor with it. The DBML lives in the store/editor
 *  and is untouched by a render crash — the fallback offers a one-click
 *  .dbml download (in-memory only, works with storage unavailable) and a
 *  re-render button. "Re-render" clears the error; since the children were
 *  unmounted while the fallback showed, React mounts a fresh DiagramCanvas
 *  (fresh refs and gesture ledgers) — if the underlying state still
 *  crashes it, the boundary simply catches again. */
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="canvas-crash">
        <h3>The diagram canvas crashed</h3>
        <p>
          Your DBML is intact and the editor on the left still works.
          Download a copy, then re-render the canvas.
        </p>
        <pre className="canvas-crash-detail">{this.state.error.message}</pre>
        <div className="canvas-crash-actions">
          <button
            onClick={() => {
              const s = useAppStore.getState();
              downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
            }}
          >
            Download your work (.dbml)
          </button>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Re-render canvas
          </button>
        </div>
      </div>
    );
  }
}
```

In `src/app/App.tsx`: add the import
```tsx
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
```
and replace the `SplitPane` line with:
```tsx
      <SplitPane
        left={<DbmlEditor />}
        right={
          <CanvasErrorBoundary>
            <DiagramCanvas />
          </CanvasErrorBoundary>
        }
      />
```

`src/main.tsx` (complete replacement):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useAppStore } from './app/store';
import './styles.css';

// Dev/E2E hook: Playwright specs (perf fixture injection) and the
// error-boundary walkthrough drive store state directly. import.meta.env.DEV
// is compile-time false in `vite build`, so this assignment is dead-code-
// eliminated from production bundles.
if (import.meta.env.DEV) {
  (window as unknown as { __appStore?: typeof useAppStore }).__appStore = useAppStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Append to `src/styles.css`:
```css
.canvas-crash {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  background: var(--bg); color: var(--text); text-align: center; padding: 24px;
}
.canvas-crash h3 { margin: 0; }
.canvas-crash p { margin: 0; max-width: 480px; color: var(--text-dim); font-size: 13px; }
.canvas-crash-detail {
  max-width: 90%; overflow-x: auto; margin: 0; font-size: 11px; color: var(--error);
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px;
}
.canvas-crash-actions { display: flex; gap: 8px; }
.canvas-crash-actions button { font-size: 12px; padding: 4px 10px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); border-radius: 4px; cursor: pointer; }
.canvas-crash-actions .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean. Confirm the hook is dev-only:
```bash
grep -c "__appStore" dist/assets/index-*.js || true
```
Expected: `0` (dead-code-eliminated).

Manual browser check (`npm run dev`):
1. In the DevTools console, corrupt the schema so the canvas render throws:
```js
__appStore.setState({
  schema: { ...__appStore.getState().schema,
    tables: [{ id: 'public.boom', schemaName: 'public', name: 'boom', alias: null, headerColor: null, note: null, fields: null }] },
  positions: { 'public.boom': { x: 0, y: 0 } },
});
```
2. The recovery pane appears (dark theme too — toggle to check); the editor still accepts typing; the problems panel and toolbar still work.
3. "Download your work (.dbml)" downloads the exact editor text.
4. Type any character in the editor → the parse pipeline replaces the corrupt schema (~300 ms) → click "Re-render canvas" → the diagram returns and pan/drag work (fresh gesture state).

- [ ] **Step 3: Commit**

```bash
git add src/app/CanvasErrorBoundary.tsx src/app/App.tsx src/main.tsx src/styles.css && git commit -m "feat: canvas error boundary with dbml escape hatch + dev store hook (spec 9)"
```

---

### Task 4: 120-table perf fixture generator (pure, unit-tested)

**Files:**
- Create: `src/core/perf/fixture.ts`
- Test: `src/core/perf/fixture.test.ts`

**Interfaces:**
- Produces:
  - `PERF_TABLE_COUNT = 120`, `PERF_FIELDS_PER_TABLE = 10` (120 × 10 = 1,200 fields), `PERF_REF_COUNT = 150`
  - `makePerfFixture(): string` — deterministic DBML matching the spec §6/§10 CI fixture shape. Pure core (imports nothing); consumed by the Task 9 Playwright perf spec via a plain relative import.
- Shape: tables `t1…t120`, each `id integer [pk, increment]` plus `c1…c9` (`c1`/`c2` are `integer` so every ref endpoint is integer-typed; `c3…c9` cycle through varchar/timestamp/boolean/text/integer). Refs: 119 chain refs `t{i}.c1 > t{i-1}.id` plus 31 long-range refs `t{i}.c2 > t{i+60}.id` (i = 1…31) = 150, every field used at most once as a ref source.

- [ ] **Step 1: Write the failing test**

`src/core/perf/fixture.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makePerfFixture, PERF_TABLE_COUNT, PERF_FIELDS_PER_TABLE, PERF_REF_COUNT } from './fixture';
import { parseDbml } from '../parse/parseDbml';

describe('makePerfFixture', () => {
  const dbml = makePerfFixture();

  it('parses cleanly and matches the spec §6 shape: 120 tables / 1200 fields / 150 refs', () => {
    const r = parseDbml(dbml);
    if (!r.ok) throw new Error(`fixture does not parse: ${r.errors[0]?.message}`);
    expect(r.schema.tables).toHaveLength(PERF_TABLE_COUNT);
    expect(r.schema.tables.reduce((n, t) => n + t.fields.length, 0)).toBe(
      PERF_TABLE_COUNT * PERF_FIELDS_PER_TABLE,
    );
    expect(r.schema.refs).toHaveLength(PERF_REF_COUNT);
  });

  it('is deterministic (same string every call — stable perf baselines)', () => {
    expect(makePerfFixture()).toBe(dbml);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/perf` — Expected: FAIL (cannot resolve `./fixture`).

- [ ] **Step 3: Implement**

`src/core/perf/fixture.ts`:
```ts
/** Deterministic 120-table / 1,200-field / 150-ref DBML fixture — the CI
 *  performance target from spec §6/§10. Pure string generation, no imports:
 *  unit tests validate the shape (and that it parses), and the Playwright
 *  perf spec (e2e/perf.spec.ts) injects it as the parse-to-render payload. */

export const PERF_TABLE_COUNT = 120;
export const PERF_FIELDS_PER_TABLE = 10; // id + c1..c9 → 120 × 10 = 1,200 fields
export const PERF_REF_COUNT = 150; // 119 chain refs + 31 long-range refs

const FILLER_TYPES = ['varchar', 'timestamp', 'boolean', 'text', 'integer'] as const;

export function makePerfFixture(): string {
  const tables: string[] = [];
  for (let t = 1; t <= PERF_TABLE_COUNT; t++) {
    const fields = ['  id integer [pk, increment]'];
    for (let f = 1; f < PERF_FIELDS_PER_TABLE; f++) {
      // c1/c2 are ref sources → integer, matching the integer pk targets;
      // the rest cycle through the filler types for realistic text volume.
      const type = f <= 2 ? 'integer' : FILLER_TYPES[(t + f) % FILLER_TYPES.length];
      fields.push(`  c${f} ${type}`);
    }
    tables.push(`Table t${t} {\n${fields.join('\n')}\n}`);
  }

  const refs: string[] = [];
  for (let t = 2; t <= PERF_TABLE_COUNT; t++) {
    refs.push(`Ref: t${t}.c1 > t${t - 1}.id`); // 119 chain refs
  }
  const longRange = PERF_REF_COUNT - (PERF_TABLE_COUNT - 1); // 31
  for (let i = 1; i <= longRange; i++) {
    refs.push(`Ref: t${i}.c2 > t${i + 60}.id`); // t61..t91 targets, all in range
  }

  return `${tables.join('\n\n')}\n\n${refs.join('\n')}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/perf` — Expected: PASS (2 tests; the parse assertion runs the real `@dbml/core` on the 120-table fixture in node — sub-second is normal here, no budget asserted in unit tests).

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run && git add src/core/perf && git commit -m "feat: deterministic 120-table perf fixture generator"
```

---

### Task 5: Review-debt polish wave — pan-from-anywhere, pointer interleave guard, note drag threshold, minimap pointercancel commit, theme FOUC guard

**Files:**
- Modify: `src/canvas/snap.ts`, `src/canvas/DiagramCanvas.tsx`, `src/canvas/NoteNode.tsx`, `src/canvas/MiniMap.tsx`, `index.html`, `src/app/App.tsx`

**Interfaces:**
- `snap.ts` gains `DRAG_THRESHOLD_PX = 3` (moved out of `DiagramCanvas.tsx` so `NoteNode` shares the identical constant — importing it from `DiagramCanvas` would create a cycle).
- `DiagramCanvas`: new `onPointerDownCapture` arms pan (Space+left / middle button) **before** any child's `onPointerDown` and stops propagation so a table/note/group drag never co-starts; `panRef`/`marqueeState` now carry the owning `pointerId`, and down/move/up ignore non-owning pointers and refuse to start a second gesture while one is active (the marquee/pan interleave ledger item — a second touch pointer or chorded press can neither hijack nor double-start).
- `NoteNode`: 3 px drag threshold — parity with tables; a sub-threshold gesture is a click and commits nothing (previously every touch wrote a live transform and relied on the zero-delta prune).
- `MiniMap`: `pointercancel` mid-scrub now commits the viewport like `pointerup` (ledger item: a cancelled scrub left the store viewport stale) — committing the **last scrubbed world center** kept in a ref by `navTo`, never the cancel event's own coordinates (a touch-cancel can deliver `clientX/Y` of (0,0), which would jump the viewport).
- `index.html`: inline pre-React theme stamp from `localStorage['dbdraft.theme']`, try/caught (FOUC ledger item).
- All items are component/gesture wiring → **browser-verified** per repo convention (no unit tests by design); `snap.ts`'s change is a constant move with no behavior change.

- [ ] **Step 1: Implement**

Append to `src/canvas/snap.ts`:
```ts
/** Below this raw pointer travel (screen px), a canvas gesture is a click,
 *  not a drag — shared by table drags (DiagramCanvas.handleLiveMove) and
 *  note drags (NoteNode) so the two feel identical. */
export const DRAG_THRESHOLD_PX = 3;
```

In `src/canvas/DiagramCanvas.tsx`:

1. Update the snap import:
```ts
import { snapPosition, SNAP_TOLERANCE, DRAG_THRESHOLD_PX, type GuideLine } from './snap';
```
2. Delete the local constant line directly under the gesture-ledger comment block:
```ts
const DRAG_THRESHOLD_PX = 3; // below this raw pointer travel, a gesture is a click
```
(the comment block above it stays; the constant now lives in `snap.ts`).

3. Replace the `panRef` and `marqueeState` declarations with:
```ts
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const marqueeRef = useRef<SVGRectElement>(null);
  const marqueeState = useRef<{ pointerId: number; start: Point } | null>(null);
```

4. Replace the whole `onPointerDown` / `onPointerMove` / `onPointerUp` trio with:
```tsx
  // Pan-from-anywhere (review-debt ledger): Space+left / middle-button must
  // pan even when the pointer sits over a table, note, or group. Capture
  // phase runs before any child's onPointerDown, and stopPropagation() here
  // keeps the same gesture from ALSO starting a table/note/group drag.
  // Gesture ownership: at most one canvas-level gesture (pan or marquee) at
  // a time, keyed by pointerId — a second pointer (touch) or a chorded
  // button press can neither hijack nor double-start a gesture.
  const onPointerDownCapture = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current || marqueeState.current) return; // a gesture already owns the canvas
    const wantPan = e.button === 1 || (e.button === 0 && spaceDown.current);
    if (!wantPan) return;
    e.preventDefault(); // best effort against middle-click autoscroll
    e.stopPropagation(); // don't let TableNode/NoteNode/GroupLayer start a drag
    svgRef.current!.setPointerCapture(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: vpRef.current.x,
      origY: vpRef.current.y,
    };
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== svgRef.current) return; // marquee starts on empty canvas only
    if (e.button !== 0) return;
    if (panRef.current || marqueeState.current) return; // second pointer mid-gesture: ignore
    svgRef.current!.setPointerCapture(e.pointerId);
    marqueeState.current = { pointerId: e.pointerId, start: toWorld(e.clientX, e.clientY) };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan) {
      if (e.pointerId !== pan.pointerId) return; // not the owning pointer
      vpRef.current = {
        ...vpRef.current,
        x: pan.origX + (e.clientX - pan.startX),
        y: pan.origY + (e.clientY - pan.startY),
      };
      applyTransform();
      return;
    }
    const m = marqueeState.current;
    const el = marqueeRef.current;
    if (!m || !el || e.pointerId !== m.pointerId) return;
    const r = rectFromPoints(m.start, toWorld(e.clientX, e.clientY));
    el.setAttribute('x', String(r.x));
    el.setAttribute('y', String(r.y));
    el.setAttribute('width', String(r.w));
    el.setAttribute('height', String(r.h));
    el.setAttribute('visibility', 'visible');
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan) {
      if (e.pointerId !== pan.pointerId) return;
      panRef.current = null;
      useAppStore.getState().setViewport(vpRef.current);
      setZoomPct(Math.round(vpRef.current.zoom * 100));
      return;
    }
    const m = marqueeState.current;
    if (!m || e.pointerId !== m.pointerId) return;
    marqueeState.current = null;
    marqueeRef.current?.setAttribute('visibility', 'hidden');
    const sel = rectFromPoints(m.start, toWorld(e.clientX, e.clientY));
    const store = useAppStore.getState();
    const minSize = 4 / (zoomRef.current ?? 1); // tinier than this = a click on empty canvas
    if (sel.w < minSize && sel.h < minSize) {
      store.setSelectedTables([]);
      return;
    }
    const items = store.schema.tables
      .filter((t) => store.positions[t.id])
      .map((t) => ({ id: t.id, rect: getTableRect(t, store.positions[t.id]) }));
    store.setSelectedTables(idsInRect(items, sel));
  };
```

5. Add the capture handler to the `<svg>` element:
```tsx
      <svg
        ref={svgRef}
        className="diagram-canvas"
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
```

`src/canvas/NoteNode.tsx` (complete replacement):
```tsx
import { memo, useRef } from 'react';
import type { StickyNote, TablePosition } from '../core/model/types';
import { NOTE_WIDTH, NOTE_HEIGHT } from '../core/model/geometry';
import { DRAG_THRESHOLD_PX } from './snap';

interface Props {
  note: StickyNote;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  // Canvas-level ledger of the in-flight note drag (note id or null) so the
  // culling pass can keep the drag anchor mounted — mirrors the table path's
  // dragRef. A ref, never state: written on the imperative drag path.
  dragLedger: React.RefObject<string | null>;
  onCommitMove: (id: string, before: TablePosition, after: TablePosition) => void;
}

export const NoteNode = memo(function NoteNode({ note, pos, zoomRef, dragLedger, onCommitMove }: Props) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    orig: TablePosition;
    live: TablePosition;
    moved: boolean; // raw pointer travel exceeded DRAG_THRESHOLD_PX (parity with tables)
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, orig: pos, live: pos, moved: false };
    dragLedger.current = note.id;
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      // Click jitter guard, same 3 px screen threshold as table drags:
      // don't write a transform (or later a commit) for a plain click.
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
    }
    const zoom = zoomRef.current ?? 1;
    d.live = {
      x: d.orig.x + (e.clientX - d.startX) / zoom,
      y: d.orig.y + (e.clientY - d.startY) / zoom,
    };
    gRef.current?.setAttribute('transform', `translate(${d.live.x}, ${d.live.y})`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    dragLedger.current = null;
    if (!d.moved) return; // click, not a drag — nothing to commit
    onCommitMove(note.id, d.orig, d.live);
  };

  return (
    <g
      ref={gRef}
      transform={`translate(${pos.x}, ${pos.y})`}
      className="sticky-note"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <rect width={NOTE_WIDTH} height={NOTE_HEIGHT} rx={4} className="note-body" />
      <text x={10} y={16} className="note-title">{note.name}</text>
      <foreignObject x={8} y={26} width={NOTE_WIDTH - 16} height={NOTE_HEIGHT - 34}>
        <div className="note-content">{note.content}</div>
      </foreignObject>
    </g>
  );
});
```

In `src/canvas/MiniMap.tsx` (three edits — `Point` is already imported there):

1. After `const dragging = useRef(false);` add:
```tsx
  const lastScrub = useRef<Point | null>(null); // last world center navTo computed (see pointercancel)
```
2. Replace the `navTo` function with (identical except it records the center):
```tsx
  const navTo = (e: React.PointerEvent<SVGSVGElement>, commit: boolean) => {
    const tr = tRef.current;
    if (!tr) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const center = miniToWorld(tr, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    lastScrub.current = center;
    onNavigate(center, commit);
  };
```
3. Replace the `onPointerCancel` prop with:
```tsx
      onPointerCancel={() => {
        if (!dragging.current) return;
        dragging.current = false;
        // Commit the LAST scrubbed center, not the cancel event's own
        // coordinates — a touch-cancel can deliver clientX/Y of (0,0), which
        // would jump the viewport across the scene. A cancelled drag must not
        // leave the store viewport stale either (review-debt ledger item).
        if (lastScrub.current) onNavigate(lastScrub.current, true);
      }}
```

`index.html` (complete replacement):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DBDraft — database diagrams</title>
    <script>
      // Pre-React theme stamp (FOUC guard): App.tsx re-reads the same key
      // ('dbdraft.theme' — keep the two in sync) after mount; without this,
      // a stored dark preference paints one light frame first. Guarded:
      // localStorage can throw (private mode / blocked storage).
      try {
        if (localStorage.getItem('dbdraft.theme') === 'dark') {
          document.documentElement.dataset.theme = 'dark';
        }
      } catch (e) {
        /* default light */
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

In `src/app/App.tsx`, update the constant's line to document the coupling:
```ts
const THEME_KEY = 'dbdraft.theme'; // keep in sync with the inline FOUC guard in index.html
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean (snap/marquee/viewport unit tests unaffected — the constant move and gesture wiring change no pure functions).

Manual browser check (`npm run dev`):
1. Hold Space and drag **starting on top of a table** → the canvas pans, the table does not move, and no selection/undo entry appears. Release Space → dragging the same table moves it (snap + guides intact).
2. Middle-button drag over a table, a sticky note, and a group header → pans in all three cases; over empty canvas still pans.
3. Space typed in the editor still inserts a space (editor guard untouched); Space with a toolbar button focused still activates the button, not pan.
4. Click a sticky note without moving → nothing to undo (Ctrl+Z is a no-op or undoes an OLDER action, never a 0-px note move). Drag a note >3 px → it moves; Ctrl+Z restores it.
5. Marquee still works: left-drag on empty canvas selects; a middle-click during an active marquee neither cancels the marquee nor starts a pan (guard: one gesture at a time). With DevTools touch emulation, a second finger down mid-marquee is ignored.
6. Minimap click/drag navigation still works and commits (regression for the `pointercancel` change; a genuine mid-scrub `pointercancel` is not forceable with a mouse — the commit path is code-verified parity with `pointerup`).
7. FOUC: toggle Dark, hard-reload with DevTools "Performance → CPU 6x slowdown" → no light flash before dark paint. Block site data (or private window) → app loads light, no console error.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "fix: polish wave — pan-from-anywhere, pointer interleave guard, note drag threshold, minimap cancel commit, theme FOUC guard"
```

---

### Task 6: Playwright scaffolding + editing golden flows (type→render, break→stale)

**Files:**
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/editing.spec.ts`
- Modify: `package.json` (new devDependency + `test:e2e` script), `vite.config.ts` (vitest include), `tsconfig.json` (typecheck e2e), `.gitignore` (Playwright artifacts)

**Interfaces:**
- Produces:
  - `playwright.config.ts` — chromium-only project, `testDir: 'e2e'`, `webServer` auto-starting `npm run dev` on port 5173 (`reuseExistingServer` outside CI), serial workers for determinism.
  - `setEditorText(page, text)` helper — replaces the CodeMirror doc via select-all + `keyboard.insertText` (single input event: fast, and never triggers auto-close-brackets the way per-character typing would).
  - `STARTER_TABLE_COUNT = 3`.
  - npm script `test:e2e` → `playwright test`.
  - vitest exclusion of `e2e/` via `include: ['src/**/*.test.ts']` (the exact Global Constraints change).

- [ ] **Step 1: Install the two allowed devDependencies + browser**

```bash
npm install --save-dev --save-exact @playwright/test@1.61.1 @types/node@26.1.1
npx playwright install chromium   # on Linux CI: npx playwright install --with-deps chromium
```
(`@types/node` is not optional: Step 2 adds `playwright.config.ts` + `e2e/` to the `tsc` include, and their `process.env` / `node:fs` usages fail typecheck with TS2580/TS2307 without it.)

- [ ] **Step 2: Configuration**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

// Chromium-only by design: the spec §10 golden flows are app logic, not
// engine-compat testing, and one engine keeps CI fast. workers: 1 +
// fullyParallel: false keep the shared dev server and the perf spec
// deterministic (the perf budget must not compete for CPU with sibling
// tests). Each test still gets a fresh browser context → fresh IndexedDB.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --strictPort: if something else already squats on 5173, Vite must fail
    // fast instead of silently moving to 5174 while Playwright tests the
    // stranger's server on 5173.
    command: 'npm run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

`vite.config.ts` (complete replacement):
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Unit tests only (src/**/*.test.ts). e2e/ is Playwright's domain
    // (*.spec.ts) and must never enter vitest: its specs import
    // '@playwright/test', whose test() registration throws outside a
    // Playwright run.
    include: ['src/**/*.test.ts'],
  },
});
```

`tsconfig.json` — replace the `types` line with:
```json
    "types": ["vite/client", "vitest/globals", "node"]
```
and replace the `include` line with:
```json
  "include": ["src", "vite.config.ts", "playwright.config.ts", "e2e"]
```

`.gitignore` — append:
```
# playwright
test-results/
playwright-report/
```

`package.json` — update `scripts`: add `test:e2e` and drop `--passWithNoTests` from `test` — with the include glob narrowed, a glob regression that collects zero files must fail loudly, never pass silently:
```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
```

Guard the exclusion immediately:
```bash
npx vitest run
```
Expected: same suite as before (all green, count unchanged — nothing from `e2e/` collected; `e2e/` is empty right now, so this pins the include change itself doesn't drop `src` tests).

- [ ] **Step 3: Write the helpers and the first two golden-flow specs**

`e2e/helpers.ts`:
```ts
import type { Page } from '@playwright/test';

/** Replace the CodeMirror document through the keyboard — the same path a
 *  user's edit takes (CM update listener → store.setSource → 300 ms debounce
 *  → worker parse). insertText is a single input event: fast, and it never
 *  triggers auto-close-brackets the way per-character typing would. */
export async function setEditorText(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

/** The starter diagram every fresh browser context boots into. */
export const STARTER_TABLE_COUNT = 3;
```

`e2e/editing.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { setEditorText, STARTER_TABLE_COUNT } from './helpers';

const TWO_TABLES = `Table customers {
  id integer [pk]
  name varchar
}

Table orders {
  id integer [pk]
  customer_id integer
}

Ref: orders.customer_id > customers.id
`;

test('typing DBML renders tables and edges on the canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await setEditorText(page, TWO_TABLES);

  await expect(page.locator('.table-node')).toHaveCount(2);
  await expect(page.locator('.table-title').filter({ hasText: 'customers' })).toBeVisible();
  await expect(page.locator('.edge')).toHaveCount(1);
  await expect(page.locator('.statusbar .status-ok')).toBeVisible();
});

test('broken syntax keeps the last good diagram and shows the stale badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await setEditorText(page, TWO_TABLES);
  await expect(page.locator('.table-node')).toHaveCount(2);

  await setEditorText(page, 'Table broken {\n  id integer');

  await expect(page.locator('.badge.stale')).toBeVisible();
  await expect(page.locator('.table-node')).toHaveCount(2); // never a blank canvas
  await expect(page.locator('.statusbar .status-errors')).toBeVisible();

  // fixing the text clears the badge again
  await setEditorText(page, TWO_TABLES);
  await expect(page.locator('.badge.stale')).toBeHidden();
  await expect(page.locator('.statusbar .status-ok')).toBeVisible();
});
```

- [ ] **Step 4: Run to verify (these test SHIPPED behavior — they must pass as written)**

```bash
npx playwright test e2e/editing.spec.ts
```
Expected: 2 passed. Then `npx tsc --noEmit` — clean (e2e is now typechecked), and `npx vitest run` — unchanged (specs not collected).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: playwright scaffolding + editing golden-flow e2e specs"
```

---

### Task 7: Interop golden flows — SQL import per dialect; every export format downloads

**Files:**
- Create: `e2e/interop.spec.ts`

**Interfaces:**
- Consumes: shipped Import dialog (kind `<select>` with option values `postgres`/`mysql`/`mssql`, confirm button "Import as new diagram", textarea `.dialog-text`), Export menu (items "DBML (.dbml)", "SQL — PostgreSQL", "SQL — MySQL", "SQL — SQL Server", "SVG (.svg)", "PNG (2x)", "Project file (.json)" — the menu closes after every item, so each export reopens it), DiagramManager list (`.diagram-list li`), `STARTER_TABLE_COUNT` helper, Playwright `download` events.
- Coverage is spec §10 verbatim: import is exercised **per dialect** (one CREATE TABLE fixture each), export is exercised for **each format** — text formats content-sniffed from the downloaded file, SVG sniffed for `<svg`, PNG asserted as download event + filename only (binary).

- [ ] **Step 1: Implement the spec**

`e2e/interop.spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { STARTER_TABLE_COUNT } from './helpers';

const DIALECTS = [
  {
    kind: 'postgres',
    sql: 'CREATE TABLE invoices (id integer PRIMARY KEY, customer varchar(80) NOT NULL, total numeric);',
    table: 'invoices',
  },
  {
    kind: 'mysql',
    sql: 'CREATE TABLE shipments (id INT PRIMARY KEY, weight DECIMAL(10,2) NOT NULL);',
    table: 'shipments',
  },
  {
    kind: 'mssql',
    sql: 'CREATE TABLE payments (id INT PRIMARY KEY, amount DECIMAL(10,2) NOT NULL);',
    table: 'payments',
  },
] as const;

test('SQL import per dialect creates a NEW diagram each time, never overwriting (spec §10)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  for (const { kind, sql, table } of DIALECTS) {
    await page.getByRole('button', { name: 'Import' }).click();
    await page.locator('.dialog select').selectOption(kind);
    await page.locator('.dialog-text').fill(sql);
    await page.getByRole('button', { name: 'Import as new diagram' }).click();
    await expect(page.locator('.dialog')).toBeHidden(); // closed on success
    await expect(page.locator('.table-node')).toHaveCount(1); // the import is now current
    await expect(page.locator('.table-title').filter({ hasText: table })).toBeVisible();
  }

  // starter + one NEW diagram per dialect — nothing was overwritten
  await page.getByRole('button', { name: /diagrams/ }).click();
  await expect(page.locator('.diagram-list li')).toHaveCount(1 + DIALECTS.length);
});

test('every export format downloads (spec §10: "export each format")', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await expect(page.locator('.statusbar .status-ok')).toBeVisible(); // SQL items enable on clean parse

  // The menu closes after every item, so each export reopens it.
  const exportItem = async (item: string) => {
    await page.getByRole('button', { name: /export/ }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: item }).click();
    return event;
  };

  const dbml = await exportItem('DBML (.dbml)');
  expect(dbml.suggestedFilename()).toBe('Untitled.dbml');
  expect(readFileSync(await dbml.path(), 'utf8')).toContain('Table users');

  for (const { dialect, label } of [
    { dialect: 'postgres', label: 'SQL — PostgreSQL' },
    { dialect: 'mysql', label: 'SQL — MySQL' },
    { dialect: 'mssql', label: 'SQL — SQL Server' },
  ] as const) {
    const sql = await exportItem(label); // the first one pays the lazy @dbml/core chunk load
    expect(sql.suggestedFilename()).toBe(`Untitled.${dialect}.sql`);
    expect(readFileSync(await sql.path(), 'utf8')).toContain('CREATE TABLE');
  }

  const svg = await exportItem('SVG (.svg)');
  expect(svg.suggestedFilename()).toBe('Untitled.svg');
  expect(readFileSync(await svg.path(), 'utf8')).toContain('<svg');

  const png = await exportItem('PNG (2x)'); // binary: download event + filename only
  expect(png.suggestedFilename()).toBe('Untitled.png');

  const proj = await exportItem('Project file (.json)');
  expect(proj.suggestedFilename()).toBe('Untitled.json');
  const project = JSON.parse(readFileSync(await proj.path(), 'utf8')) as {
    version: number;
    name: string;
    dbml: string;
    layout: Record<string, unknown>;
  };
  expect(project.version).toBe(1);
  expect(project.name).toBe('Untitled');
  expect(project.dbml).toContain('Table users');
  expect(Object.keys(project.layout)).toContain('public.users'); // positions captured
});
```

- [ ] **Step 2: Run to verify**

```bash
npx playwright test e2e/interop.spec.ts
```
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/interop.spec.ts && git commit -m "feat: interop golden-flow e2e specs (sql import per dialect, export every format)"
```

---

### Task 8: Layout & persistence golden flows — drag/snap/undo, reload restore, snapshot restore, theme persist

**Files:**
- Create: `e2e/persistence.spec.ts`

**Interfaces:**
- Consumes: `setEditorText`/`STARTER_TABLE_COUNT`, canvas undo (Ctrl/Cmd-Z on window), `GRID_SIZE = 16` snap behavior (single-table doc → no alignment candidates → pure grid snap, per Verified facts), IndexedDB `dbdraft` `diagrams` **and** `snapshots` stores (both polled directly — no arbitrary sleeps), History panel (rows `.history-panel li`, "restore" buttons, newest first), the Task 5 FOUC inline script, `data-theme` on `<html>`.
- Snapshot-timing gotcha this spec must respect: the bootstrap `putDiagram` writes **no** snapshot; the starter snapshot only lands when the 1 s autosave fires — and `scheduleAutosave` clears + re-arms on every state change, so an edit made too early cancels the starter save and only ONE snapshot ever exists. The restore test therefore polls the `snapshots` store to 1 **before** editing, then to 2 after.

- [ ] **Step 1: Implement the spec**

`e2e/persistence.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { setEditorText, STARTER_TABLE_COUNT } from './helpers';

const SOLO = 'Table solo {\n  id integer [pk]\n}\n';

function translateOf(transform: string): { x: number; y: number } {
  const m = /translate\((-?[\d.]+), (-?[\d.]+)\)/.exec(transform);
  if (!m) throw new Error(`unexpected transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Drag the (single) table's header by an off-grid delta; returns nothing —
 *  callers assert on the resulting transform. */
async function dragSoloBy(page: import('@playwright/test').Page, dx: number, dy: number) {
  const node = page.locator('.table-node');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10); // header row
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 10 + dy, { steps: 8 });
  await page.mouse.up();
}

test('drag snaps to the grid and canvas undo restores the position', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  // One table → zero alignment candidates → snapPosition always grid-snaps,
  // which makes the % 16 assertion deterministic (no alignment-vs-grid race).
  await setEditorText(page, SOLO);
  await expect(page.locator('.table-node')).toHaveCount(1);

  const node = page.locator('.table-node');
  const before = (await node.getAttribute('transform'))!;
  await dragSoloBy(page, 203, 157); // deliberately off-grid delta

  await expect(node).not.toHaveAttribute('transform', before);
  const after = translateOf((await node.getAttribute('transform'))!);
  expect(after.x % 16).toBe(0); // GRID_SIZE snap (src/canvas/snap.ts)
  expect(after.y % 16).toBe(0);

  await page.keyboard.press('ControlOrMeta+z'); // canvas pane focused (click landed on canvas)
  await expect(node).toHaveAttribute('transform', before);
});

test('reload restores text, dragged position and diagram', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await setEditorText(page, SOLO);
  await expect(page.locator('.table-node')).toHaveCount(1);
  await dragSoloBy(page, 160, 96);
  const dragged = (await page.locator('.table-node').getAttribute('transform'))!;
  const { x, y } = translateOf(dragged);

  // Poll IndexedDB until the 1 s debounced autosave has persisted BOTH the
  // text and the dragged position — deterministic, no sleeps.
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
                  const rows = all.result as Array<{
                    dbml: string;
                    positions: Record<string, { x: number; y: number }>;
                  }>;
                  const row = rows.find((r) => r.dbml.includes('Table solo'));
                  resolve(JSON.stringify(row?.positions['public.solo'] ?? null));
                };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(JSON.stringify({ x, y }));

  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Table solo');
  await expect(page.locator('.table-node')).toHaveCount(1);
  await expect(page.locator('.table-node')).toHaveAttribute('transform', dragged);
});

test('snapshot restore round-trips non-destructively', async ({ page }) => {
  const snapshotCount = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open('dbdraft');
          req.onsuccess = () => {
            const db = req.result;
            const all = db.transaction('snapshots').objectStore('snapshots').getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result.length);
            };
          };
        }),
    );

  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  // Await the STARTER snapshot BEFORE editing: bootstrap's putDiagram writes
  // no snapshot, and scheduleAutosave clears + re-arms on every state change
  // — an edit landing first would cancel the starter autosave and only ONE
  // snapshot would ever exist (deterministically, on any machine speed).
  await expect.poll(snapshotCount, { timeout: 10_000 }).toBe(1);

  await setEditorText(page, SOLO);
  await expect(page.locator('.table-node')).toHaveCount(1);
  await expect.poll(snapshotCount, { timeout: 10_000 }).toBe(2); // + the clean SOLO edit

  // The panel fetches on open — both rows are guaranteed present by now.
  await page.getByRole('button', { name: /history/ }).click();
  await expect(page.locator('.history-panel li')).toHaveCount(2);

  // Restore the OLDEST snapshot (the starter text) …
  await page.locator('.history-panel li').last().getByRole('button', { name: 'restore' }).click();
  await expect(page.locator('.cm-content')).toContainText('Table users');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  // … then restore the NEWEST row (the SOLO edit) — proving the restore
  // destroyed nothing and History round-trips.
  await page.locator('.history-panel li').first().getByRole('button', { name: 'restore' }).click();
  await expect(page.locator('.cm-content')).toContainText('Table solo');
  await expect(page.locator('.table-node')).toHaveCount(1);
});

test('theme toggle persists across reload and is applied before React boots', async ({ page }) => {
  // Record what the pre-React inline script (index.html, Task 5) stamped by
  // DOMContentLoaded — React's useEffect stamp runs after paint, so a 'dark'
  // value here proves the FOUC guard did it.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __themeAtDomReady?: string }).__themeAtDomReady =
        document.documentElement.dataset.theme ?? 'unset';
    });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(
      () => (window as unknown as { __themeAtDomReady?: string }).__themeAtDomReady,
    ),
  ).toBe('dark');
});
```

- [ ] **Step 2: Run to verify**

```bash
npx playwright test e2e/persistence.spec.ts
```
Expected: 4 passed. (The theme test depends on Task 5's inline script — if it fails on `__themeAtDomReady`, Task 5 was not merged first.)

- [ ] **Step 3: Full e2e + commit**

```bash
npm run test:e2e && git add e2e/persistence.spec.ts && git commit -m "feat: layout + persistence golden-flow e2e specs"
```

---

### Task 9: Perf guard — parse-to-render budget + pan long-task smoke (spec §6/§10)

**Files:**
- Create: `e2e/perf.spec.ts`

**Interfaces:**
- Consumes: `makePerfFixture`/`PERF_TABLE_COUNT` (Task 4, plain relative import into the Playwright process), `window.__appStore` (Task 3 dev hook — the spec runs against the dev server where it exists), pan-from-anywhere (Task 5 — the pan starts over a table), page-context `performance.mark`/`measure` and a `PerformanceObserver` on `longtask` entries.
- Budgets (each with rationale at the assertion site — CI-tolerant by design):
  - parse-to-render < **5000 ms**: locally ~1 s (worker already warm from boot, dev-mode React); 5 s absorbs slow shared CI runners while still catching order-of-magnitude regressions (parse back on the main thread, per-keystroke re-parse).
  - long tasks during a 20-step pan ≤ **5**: a "React renders per pan tick" regression produces dozens of >50 ms tasks; ≤5 tolerates an incidental GC pause without flaking.

- [ ] **Step 1: Implement the spec**

`e2e/perf.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { makePerfFixture, PERF_TABLE_COUNT } from '../src/core/perf/fixture';

// Spec §10 "performance guard", not a micro-benchmark: budgets are
// deliberately generous so CI never flakes, while regressions this guard
// exists for (parse on the main thread, per-keystroke re-parse, React
// rendering per pan tick) overshoot them by an order of magnitude.
test('120-table fixture renders inside the cold budget and pans without long-task pileup', async ({ page }) => {
  test.slow(); // 3x timeout: this spec deliberately renders 120 tables

  await page.goto('/');
  await expect(page.locator('.table-node').first()).toBeVisible(); // app booted (starter parsed)

  const fixture = makePerfFixture();
  await page.evaluate((dbml) => {
    performance.mark('perf:edit');
    // Dev-only store hook (src/main.tsx): the same entry point a keystroke
    // uses (setSource → 300 ms debounce → worker parse → applyParse).
    (window as unknown as { __appStore: { getState(): { setSource(s: string): void } } })
      .__appStore.getState()
      .setSource(dbml);
  }, fixture);

  await page.waitForFunction(
    (n) =>
      (window as unknown as { __appStore: { getState(): { schema: { tables: unknown[] } } } })
        .__appStore.getState().schema.tables.length === n,
    PERF_TABLE_COUNT,
    { timeout: 15_000 },
  );
  const parseToRender = await page.evaluate(async () => {
    // Double rAF: by the second frame the store commit has rendered AND painted.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    performance.mark('perf:rendered');
    return performance.measure('perf:parse-to-render', 'perf:edit', 'perf:rendered').duration;
  });
  // Budget: <5 s cold (locally ~1 s; see file header for rationale). Spec §6
  // asks for sub-second edit-to-render on a laptop — CI asserts the order of
  // magnitude, the browser walkthrough (Task 11) eyeballs the real feel.
  expect(parseToRender).toBeLessThan(5000);

  // Zoom-to-fit: culling now keeps all 120 tables in view → all mounted.
  await page.getByRole('button', { name: 'fit' }).click();
  await expect(page.locator('.table-node')).toHaveCount(PERF_TABLE_COUNT);

  // Pan smoke: middle-button drag across the scene, starting over a table
  // (pan-from-anywhere). Pan bypasses React — a long-task pileup here means
  // the perf contract broke.
  await page.evaluate(() => {
    (window as unknown as { __longTasks: number }).__longTasks = 0;
    new PerformanceObserver((list) => {
      (window as unknown as { __longTasks: number }).__longTasks += list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  });
  const box = (await page.locator('svg.diagram-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx + i * 12, cy + (i % 5) * 8);
  }
  await page.mouse.up({ button: 'middle' });
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number }).__longTasks,
  );
  // Ceiling 5: an incidental GC pause registers 1-2 entries; a React-per-
  // pan-tick regression registers dozens. Discriminating and CI-safe.
  expect(longTasks).toBeLessThanOrEqual(5);
});
```

- [ ] **Step 2: Run to verify**

```bash
npx playwright test e2e/perf.spec.ts
```
Expected: 1 passed; the reported parse-to-render duration is logged in the trace on failure only — optionally run with `--trace on` once and eyeball the number (expect well under 2 s locally).

- [ ] **Step 3: Commit**

```bash
git add e2e/perf.spec.ts && git commit -m "feat: playwright perf guard — parse-to-render budget + pan long-task smoke"
```

---

### Task 10: Bundle budget script — gzip ceiling + lazy-lib leak markers

**Files:**
- Create: `scripts/check-bundle.mjs`
- Modify: `package.json` (`check:bundle` script)

**Interfaces:**
- Produces: `npm run check:bundle` — builds (`npm run build`), locates the entry chunk via `dist/index.html`, and exits 1 if (a) its gzip size exceeds `BUNDLE_BUDGET` bytes (default 215,040 = 210 KiB) or (b) the chunk contains `org.eclipse.elk` or `dbmlv2` (strings that exist only in the lazy elk.bundled / @dbml/core chunks — see Verified facts). `BUNDLE_BUDGET` env override exists solely so the failure path can be demonstrated without editing code.

- [ ] **Step 1: Implement**

`scripts/check-bundle.mjs`:
```js
#!/usr/bin/env node
// Bundle budget guard (Plan 5). Fails the build when the main chunk exceeds
// the gzip budget or when a lazy-only library's marker strings leak into it.
//
// Budget rationale: CLAUDE.md pins the main chunk at ~210 kB gzip; the
// Plan 3+4 merge measured 208.37 kB. 210 KiB (215,040 bytes) leaves ~6 kB
// headroom for small UI additions, while an accidental static import of
// @dbml/core (~2.7 MB chunk) or elk.bundled (~1.4 MB) overshoots by an
// order of magnitude — and the marker check names the culprit even when
// minification shifts sizes.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = Number(process.env.BUNDLE_BUDGET ?? 210 * 1024);
// Markers that exist ONLY in lazy chunks: elk.bundled.js ships ELK's Java
// option ids ('org.eclipse.elk…'); the @dbml/core chunk (reachable only via
// dynamic import of parseDbml.ts) contains the 'dbmlv2' format literal.
// src/core/layout/elkGraph.ts deliberately uses the short 'elk.*' option
// keys, so the entry chunk is marker-free unless a leak happens.
// NOTE: the 'dbmlv2' check assumes the default MINIFIED build — source
// COMMENTS in main-chunk files (e.g. convert.ts) mention the string and
// esbuild strips them; under build.minify:false this would false-positive.
const FORBIDDEN = ['org.eclipse.elk', 'dbmlv2'];

execSync('npm run build', { stdio: 'inherit' });

const html = readFileSync('dist/index.html', 'utf8');
const entry = html.match(/assets\/index-[^"]+\.js/)?.[0];
if (!entry) {
  console.error('check-bundle: could not find the entry chunk in dist/index.html');
  process.exit(1);
}
const chunk = readFileSync(`dist/${entry}`);
const gzBytes = gzipSync(chunk).length;

const failures = [];
if (gzBytes > BUDGET_BYTES) {
  failures.push(`entry chunk ${entry} is ${gzBytes} bytes gzipped — budget is ${BUDGET_BYTES}`);
}
for (const marker of FORBIDDEN) {
  if (chunk.includes(marker)) {
    failures.push(`entry chunk contains "${marker}" — a lazy-only library leaked into the main bundle`);
  }
}

if (failures.length > 0) {
  console.error(`check-bundle FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-bundle OK: ${entry} is ${gzBytes} bytes gzipped (budget ${BUDGET_BYTES}); no lazy-lib markers.`);
```

`package.json` — add to `scripts` (after `"test:e2e"`):
```json
    "check:bundle": "node scripts/check-bundle.mjs",
```

- [ ] **Step 2: Verify both outcomes (green run + provoked failure)**

```bash
npm run check:bundle
```
Expected: build output, then `check-bundle OK: assets/index-*.js is <n> bytes gzipped (budget 215040); no lazy-lib markers.` with `<n>` ≈ 209–213 k (HEAD 208.37 kB + this plan's small additions).

```bash
BUNDLE_BUDGET=1000 npm run check:bundle; echo "exit: $?"
```
Expected: `check-bundle FAILED: entry chunk … budget is 1000`, `exit: 1` (proves the failure path without touching code).

- [ ] **Step 3: Commit**

```bash
git add scripts/check-bundle.mjs package.json && git commit -m "feat: bundle budget script — gzip ceiling + lazy-lib leak markers"
```

---

### Task 11: Integration pass — full verification, audits, walkthrough, docs; tag SKIPPED

**Files:**
- Modify: `CLAUDE.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1: Full verification**

```bash
npx vitest run       # Expected: all pass, ~235 tests (223 baseline + 3 T1 + 7 T2 + 2 T4)
npx tsc --noEmit     # Expected: clean (src + e2e + playwright.config.ts)
npm run test:e2e     # Expected: 9 passed (2 editing + 2 interop + 4 persistence + 1 perf)
npm run check:bundle # Expected: OK, ≤ 215,040 gzip bytes, no markers
```

- [ ] **Step 2: Constraint audits**

```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output (crashPolicy + perf fixture stayed pure).

```bash
grep -rn "from '@dbml/core'" src/ | grep -v "src/core/parse/parseDbml.ts" || true
```
Expected: no output (still the only static importer).

```bash
grep -rn "from 'vitest'\|from \"vitest\"" e2e/ || true
```
Expected: no output (Playwright specs never import vitest).

```bash
npx vitest run e2e 2>&1 | tail -1
```
Expected: "No test files found" (vitest cannot collect `e2e/` even when pointed at it, thanks to `test.include`).

- [ ] **Step 3: Update CLAUDE.md (exact edits)**

1. In the **Project** section, replace the sentence
   > Milestones are tagged `plan-N-complete`. Remaining roadmap: Plan 3 canvas depth (LOD/culling, minimap, snap/guides, groups, sticky notes, ELK auto-layout, dark theme), Plan 4 interop (SQL import/export, PNG/SVG, snapshots), Plan 5 hardening (E2E, perf CI, bundle budget).

   with:
   > Milestones are tagged `plan-N-complete`. All five milestones are complete. Regression guards: `npm test` (vitest units), `npm run test:e2e` (Playwright golden flows + perf budget), `npm run check:bundle` (main-chunk gzip budget + lazy-lib leak markers).

2. In the **Commands** block, append two lines:
   ```bash
   npm run test:e2e                              # Playwright E2E (once: npx playwright install chromium)
   npm run check:bundle                          # build + main-chunk gzip budget / lazy-lib leak check
   ```

3. In the paragraph under the Commands block ("Tests run in vitest's node environment…"), append:
   > Playwright E2E lives in `e2e/` (`*.spec.ts`, excluded from vitest via `test.include`); specs auto-start the dev server (`webServer` in `playwright.config.ts`) and may drive state through the dev-only `window.__appStore` hook.

4. In the **Data flow** invariant, replace
   > the adapter in `workerParse.ts` has a dead-flag + `dispose()` and **lazy-imports** the parser on fallback paths to keep `@dbml/core` out of the main chunk — main chunk is ~198 kB gzip vs the ~2.7 MB worker chunk

   with (also refreshing the stale ~198 kB figure to current reality):
   > the adapter in `workerParse.ts` has a dead-flag + `dispose()`, restarts a crashed worker once per input (`crashPolicy.ts`; two consecutive crashes on identical input → inline error, spec §9), and **lazy-imports** the parser on fallback paths — a failed chunk load resolves as `{ok:false, parser unavailable}` — keeping `@dbml/core` out of the main chunk: main chunk is ~206 kB gzip (budget 210 KiB, enforced by `npm run check:bundle`) vs the ~2.7 MB worker chunk

5. Replace the **Known deferred items** paragraph with:
   > Cross-review deferred fixes are tracked in the untracked ledger `.superpowers/sdd/progress.md`. Still open after Plan 5: SVG/PNG export serializes whatever LOD is currently mounted (forcing full detail needs an off-screen re-render — see the ponytail note in `svgExport.ts`); stale-drag click-select of a pruned table id (exotic, self-correcting). The Plan 5 wave closed: workerParse lazy-chunk `.catch`, worker crash restart, pan-from-anywhere, note drag threshold, theme FOUC, minimap pointercancel commit, marquee/pan pointer interleave.

- [ ] **Step 4: Ledger entry**

Append to `.superpowers/sdd/progress.md`:
```
# Plan 5 lane (feature/plan-5-hardening)
P5 complete: workerParse parser-unavailable .catch (T1, original ledger item); worker crash restart-once policy w/ report-on-2nd-identical (T2, spec §9, crashPolicy.ts pure + FakeWorker wiring tests); canvas error boundary + dev __appStore hook (T3, spec §9); 120-table fixture generator (T4); polish wave pan-from-anywhere/pointerId interleave/note 3px/minimap pointercancel/theme FOUC (T5); Playwright suite 9 specs (T6-T9, spec §10 golden flows + perf guard); check-bundle script (T10). Still deferred: full-LOD-before-export (svgExport ponytail note); stale-drag click-select dead id. Known ceilings: report-then-respawn costs one worker spawn per user retry of a crashing input (bounded, spec-conformant); perf budgets deliberately CI-generous (<5s / ≤5 long tasks).
```

- [ ] **Step 5: Browser walkthrough (dev server)**

1. Regression sweep: type→render, break syntax→stale badge (canvas never blanks), autocomplete, format, problems-panel jump.
2. Canvas: drag with snap+guides, marquee multi-select, group drag, note drag (threshold feel), minimap nav, zoom/fit, ELK auto-layout, undo/redo both panes.
3. Pan-from-anywhere: Space-drag and middle-drag over table/note/group/empty.
4. Spec §6 feel check with the perf fixture (paste `makePerfFixture()` output or use the console hook): pan/zoom/drag stay smooth at 120 tables; edit-to-render feels sub-second.
5. Interop: SQL import per dialect, export all formats, history restore, reload restore.
6. Theme: toggle + hard reload — no FOUC; canvas-crash pane styled correctly in dark mode (Task 3 console recipe).
7. Storage-unavailable path (private window): banner + working download; exports still work.

- [ ] **Step 6: Final commit; tag SKIPPED**

```bash
git add -A && git commit -m "chore: plan 5 complete — hardening" --allow-empty
```

Tag step deliberately SKIPPED — the controller tags `plan-5-complete` after merge review.

---

## Self-review checklist (done at authoring time)

- **Scope map:** item 1 (lazy-chunk `.catch`) → Task 1; item 2 (crash restart, policy unit-tested headlessly, wiring FakeWorker-tested + browser regression) → Task 2; item 3 (error boundary, DBML intact, `downloadText`/`safeFilename` reuse, editor unaffected) → Task 3; item 4 (Playwright: pinned 1.61.1 verified on npm — plus `@types/node@26.1.1`, required for `tsc` over `e2e/`+config; chromium-only config with strict-port webServer, all 8 named golden flows with import covered per dialect and export covered per format, deterministic polling only, `e2e/` excluded from vitest with `--passWithNoTests` dropped so a glob regression fails loudly, `test:e2e` script) → Tasks 6–8; item 5 (fixture generator pure + shape-count tests; perf spec with mark-based budget <5 s and CI-tolerant pan long-task smoke) → Tasks 4 + 9; item 6 (`scripts/check-bundle.mjs`, 210 KiB gzip + `org.eclipse.elk`/`dbmlv2` markers, `check:bundle` script) → Task 10; item 7 (pan-from-anywhere without breaking drags, NoteNode 3 px, FOUC inline script guarded, minimap pointercancel committing the last scrubbed center, marquee/pan pointerId interleave — each browser-verified per repo convention) → Task 5; item 8 (integration, CLAUDE.md roadmap update, tag SKIPPED) → Task 11.
- **Spec coverage:** §9 canvas error boundary (T3), worker crash auto-restart-once-then-inline-error (T2), parse-errors-are-normal untouched (Global Constraints); §10 unit suite untouched + golden-flow E2E list covered one-for-one (T6 type/break; T7 import per dialect — postgres/mysql/mssql — and export of each format — .dbml, 3× SQL and SVG content-sniffed, PNG download-event-only, project JSON validated; T8 drag-snap-undo/reload/snapshot/theme) + performance guard with parse-to-render and pan budgets (T9); §11.6 fully covered (perf fixture in CI, E2E suite, error boundaries; storage-failure paths shipped in Plan 4 are regression-walked in T11.5.7); §6 fixture shape 120/1200/150 exact (T4 constants + tests).
- **Placeholder scan:** every step contains complete code or exact byte-level edit instructions; no "similar to", no TODO, no elided bodies.
- **Cross-task signatures:** `createWorkerParse(loadParser?)`/`PARSER_UNAVAILABLE_MESSAGE` (T1→T2 tests keep passing — dispose/postMessage semantics deliberately unchanged by T2); `CrashLedger`/`INITIAL_CRASH_LEDGER`/`decideOnCrash` (T2 policy→adapter); FakeWorker id sequences hand-traced (0→re-post 1; report leaves w3 empty, next parse id 2; chain-break case ids 0/1/2/3); `window.__appStore` (T3→T9 + T3 walkthrough, dev-only, absence in dist verified in T3.2); `makePerfFixture`/`PERF_TABLE_COUNT` (T4→T9 import path `../src/core/perf/fixture`); `DRAG_THRESHOLD_PX` moved to `snap.ts` (T5: imported by both DiagramCanvas and NoteNode — no cycle); `setEditorText`/`STARTER_TABLE_COUNT` (T6→T7/T8); `test:e2e` (T6) and `check:bundle` (T10) both exercised in T11.
- **Determinism audit of E2E:** no `waitForTimeout` anywhere; grid-snap assertion made deterministic by using a single-table document (no alignment candidates); autosave awaited by polling IndexedDB for the exact dragged position; the starter snapshot awaited by polling the `snapshots` store to 1 BEFORE the edit (the edit re-arms the debounce and would cancel it) and to 2 after, so the History panel opens onto a guaranteed state; theme pre-React stamp asserted via DOMContentLoaded capture; perf budgets generous with rationale comments at the assertion sites.
- **Constraint audit:** new devDependencies limited to `@playwright/test@1.61.1` + `@types/node@26.1.1` (both exact; the latter exists only because `tsc` now covers `playwright.config.ts`/`e2e/` — without it typecheck fails TS2580/TS2307); no runtime deps; core purity preserved (new core files import nothing outside core); vitest stays node-env/no-DOM with the exact `include` change specified; branch `feature/plan-5-hardening`; out-of-scope items (full-LOD export, stale-drag click-select) explicitly listed and left on the ledger.
