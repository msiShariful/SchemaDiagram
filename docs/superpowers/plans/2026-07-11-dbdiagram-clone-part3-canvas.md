# dbdiagram Clone — Plan 3: Canvas Depth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas undo/redo with an independent command stack, snap-to-grid + alignment guides, marquee multi-select and multi-drag, level-of-detail rendering, viewport culling, a minimap, ELK auto-layout, TableGroup containers, sticky notes, and a persisted dark/light theme — plus two carry-ins from the Plan 2 ledger (zero-delta commit guard, `applyFormat` stale-race gate).

**Architecture:** Spec §3 (Canvas row), §5 (two undo stacks), §6, and §11.4 (milestone 4) of `docs/superpowers/specs/2026-07-07-dbdiagram-clone-design.md`. All decision logic is pure and headlessly tested (command stack, snap math, marquee hit-testing, LOD/culling predicates, minimap transform, ELK graph building, group geometry, note placement); thin React glue wires it into the existing imperative drag/pan/zoom paths. Every canvas mutation flows through one store action (`commitCanvasCommand`) that owns both the zero-delta guard and the undo history.

**Tech Stack:** Existing Plan-2 stack + `elkjs` (exact-pinned, worker/lazy chunk only) — the only new runtime *engine* dependency. `@lezer/highlight` is also declared in `package.json` because Task 13 imports it directly for theme-aware syntax colors; it is already a hard transitive of `@codemirror/language`, so it adds zero new bundle bytes.

**Deliberate exclusions (so reviewers know they are not omissions):**
- The spec §6 **channel edge router** full upgrade is explicitly OUT of Plan 3 scope (deferred; the current per-edge router stays).
- Partner-*table* outline on hover is deferred: hover already highlights the table's edges (Plan 1), and Plan 3 adds selection-aware highlighting; outlining partner tables would force a hover-keyed prop into every `TableNode`.
- Shift-click additive selection, Alt-to-suppress-snap, sticky-note snapping, and notes in the minimap are deferred (marquee + drag cover the spec).

## Global Constraints

- TypeScript `strict: true`; no new `any`. The `@dbml/core` normalizer (`src/core/parse/parseDbml.ts`) remains the ONLY place `any` is allowed (library object boundary). `as unknown as T` casts at the elkjs boundary are acceptable; bare `any` is not.
- `src/core/` MUST NOT import React, zustand, or anything from `src/app|editor|canvas`. Audit: `grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/` returns nothing. Pure helpers under `src/canvas/` (snap, marquee, lod, culling, minimap math) import nothing from React either — they are plain `.ts` modules tested in vitest's node environment.
- **Last good parse:** the canvas always renders the last successfully parsed schema. `applyParse` on failure sets only `errors`/`stale` — it must never clear `schema`, `positions`, `notePositions`, or `parsedSource`.
- **Text vs layout:** canvas interactions write only layout state (`commitCanvasCommand`, `setViewport`, selection) — never DBML text. Table identity stays `${schemaName}.${name}` with `public` default; sticky-note layout is keyed by note name.
- **Canvas performance contract:** pan/zoom/drag/marquee/guides bypass React — transforms and geometry via refs and direct `setAttribute`; edges re-routed imperatively through `EdgeLayer.updateTablePositions` during a gesture; the store commits on gesture end only. `TableNode` stays memoized: every prop passed to it must be referentially stable (module-level functions, store actions, or `useCallback([])` handlers that read `useAppStore.getState()` — no inline closures in the `.map()`, no per-render objects).
- **Persistence safety:** `usePersistence`'s generation-stamped autosave and `invalidatePendingAutosave()` are untouched; `notePositions` joins the autosaved record and the autosave subscription key. Any repository failure still degrades to `setStorageUnavailable(true)`.
- **@dbml/core stays pinned `^8.3.x`** parsing with `'dbmlv2'`. The normalizer adapts to whatever 8.3 emits for TableGroups/Notes — never the test expectations about our `Schema` contract.
- **Undo routing:** CodeMirror keeps its own history; the canvas command stack is independent. Ctrl/Cmd-Z (and Shift-Ctrl/Cmd-Z / Ctrl/Cmd-Y) target the canvas ONLY when the event target is outside `.cm-editor`/inputs — the focused pane decides.
- **Bundle budget:** `elkjs` loads only in a worker chunk (or a lazy in-thread fallback chunk) — never the main chunk. After Task 12 and at integration, the main `index-*.js` chunk must stay under ~210 kB gzip (Plan 2 baseline: 197.8 kB) and must not contain the string `org.eclipse.elk`.
- Tests: vitest node environment, NO DOM. All new pure logic gets unit tests; React component wiring is browser-verified (`npm run build` + manual checklist), same as the existing codebase.
- Commands exactly as in CLAUDE.md: `npm test`, `npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`. Working dir `/Users/sharif/Documents/dbdiagram`.
- Branch: create `feature/plan-3-canvas` from `main` before Task 1 (`git checkout -b feature/plan-3-canvas`); every task ends green + committed.

---

### Task 1: Format stale-race gate — record `parsedSource`

The Plan 2 ledger carry-in: `applyFormat` currently gates on `!stale && !errors`, but a parse of *newer* text can still be in flight (300 ms debounce), so Format could reindent text the parser never accepted. Fix: the pipeline reports *which source* produced each result; the store records it; format runs only when `parsedSource` equals the current doc.

**Files:**
- Modify: `src/core/parse/pipeline.ts`
- Modify: `src/app/useParsePipeline.ts`
- Modify: `src/app/store.ts`
- Modify: `src/editor/editorNav.ts`
- Modify: `src/app/App.tsx`
- Test: modify `src/core/parse/pipeline.test.ts`, `src/app/store.test.ts`

**Interfaces:**
- Consumes: existing `createParsePipeline`, `applyParse`, `applyFormat`.
- Produces:
  - `createParsePipeline` opts: `onResult: (r: ParseResult, source: string) => void` (now receives the exact source string that was parsed).
  - Store: `parsedSource: string | null` (initial `null`; set to the parsed source on a successful `applyParse`; untouched on failure; reset to `null` by `loadDiagram`).
  - Store: `applyParse(result: ParseResult, source: string): void` (second parameter now required).
  - `applyFormat()` additionally returns `false` (no-op) when `parsedSource !== view.state.doc.toString()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/parse/pipeline.test.ts` (inside the existing `describe('createParsePipeline')`):

```ts
  it('passes the parsed source alongside the result', async () => {
    const parse = vi.fn(async (s: string) => okResult(s));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });
    p.push('abc');
    await vi.advanceTimersByTimeAsync(10);
    await vi.runAllTimersAsync();
    expect(onResult).toHaveBeenCalledWith(okResult('abc'), 'abc');
    p.dispose();
  });
```

In `src/app/store.test.ts`:

1. Extend the `reset` helper's `setState` object with `parsedSource: null`:

```ts
const reset = () =>
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false, editorFocusTableId: null,
    parsedSource: null,
  });
```

2. Update every existing `applyParse(parseDbml(X))` call to pass the source as the second argument. The first describe block becomes:

```ts
describe('useAppStore', () => {
  beforeEach(reset);

  it('applyParse success places new tables and clears stale', () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    const st = useAppStore.getState();
    expect(st.schema.tables).toHaveLength(2);
    expect(st.positions['public.a']).toBeDefined();
    expect(st.positions['public.b']).toBeDefined();
    expect(st.stale).toBe(false);
    expect(st.errors).toEqual([]);
  });

  it('applyParse failure keeps last good schema and sets stale', () => {
    const good = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(good), good);
    const goodSchema = useAppStore.getState().schema;
    useAppStore.getState().applyParse(parseDbml('Table a {'), 'Table a {');
    const st = useAppStore.getState();
    expect(st.schema).toBe(goodSchema);
    expect(st.stale).toBe(true);
    expect(st.errors.length).toBeGreaterThan(0);
  });

  it('keeps a moved table where the user put it across edits', () => {
    const src1 = 'Table a { id int }';
    const src2 = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src1), src1);
    useAppStore.getState().moveTable('public.a', { x: 777, y: 333 });
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 777, y: 333 });
  });

  it('prunes positions of deleted tables', () => {
    const src1 = 'Table a { id int }\nTable b { id int }';
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src1), src1);
    useAppStore.getState().applyParse(parseDbml(src2), src2);
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

3. Append a new describe block:

```ts
describe('parsedSource', () => {
  beforeEach(reset);
  it('records the source of a successful parse', () => {
    const src = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    expect(useAppStore.getState().parsedSource).toBe(src);
  });
  it('a failed parse keeps the previous parsedSource', () => {
    const good = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(good), good);
    useAppStore.getState().applyParse(parseDbml('Table a {'), 'Table a {');
    expect(useAppStore.getState().parsedSource).toBe(good);
  });
  it('loadDiagram resets parsedSource', () => {
    const src = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
    useAppStore.getState().loadDiagram({
      id: 'd2', name: 'X', dbml: 'Table x { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().parsedSource).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/parse/pipeline.test.ts src/app/store.test.ts` — Expected: FAIL (`onResult` called without the source argument; `parsedSource` undefined; `applyParse` TS arity is fine at runtime but assertions fail).

- [ ] **Step 3: Implement**

`src/core/parse/pipeline.ts` — change the `onResult` option type and call site:

```ts
export function createParsePipeline(opts: {
  parse: (source: string) => Promise<ParseResult>;
  onResult: (r: ParseResult, source: string) => void;
  debounceMs?: number;
}): ParsePipeline {
```

and inside the timer callback:

```ts
      timer = setTimeout(() => {
        void opts.parse(source).then((result) => {
          if (!disposed && mySeq === seq) opts.onResult(result, source);
        });
      }, debounceMs);
```

`src/app/useParsePipeline.ts` — forward the source:

```ts
      onResult: (r, source) => useAppStore.getState().applyParse(r, source),
```

`src/app/store.ts`:
- Add to `AppState`: `parsedSource: string | null;` and change the action signature to `applyParse(result: ParseResult, source: string): void;`
- Initial state: `parsedSource: null,`
- `applyParse` becomes:

```ts
    applyParse: (result, source) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      set({
        schema: result.schema,
        positions: { ...kept, ...placed },
        errors: [],
        stale: false,
        parsedSource: source,
      });
    },
```

- `loadDiagram`'s `set({...})` gains `parsedSource: null,`.

`src/editor/editorNav.ts` — `applyFormat` becomes:

```ts
export function applyFormat(): boolean {
  const view = currentView;
  if (!view) return false;
  const s = useAppStore.getState();
  if (s.stale || s.errors.length > 0) return false;
  const current = view.state.doc.toString();
  // `stale` only says the LAST parse failed — a parse of NEWER text may still
  // be inside the 300 ms debounce. Formatting is allowed only when the last
  // successful parse was of exactly this text.
  if (s.parsedSource !== current) return false;
  const formatted = formatDbmlSource(current);
  if (formatted !== current) {
    view.dispatch({ changes: { from: 0, to: current.length, insert: formatted } });
  }
  return true;
}
```

`src/app/App.tsx` — add a boolean selector (single subscription, flips only when parse catches up, so App does not re-render per keystroke) and use it on the button:

```tsx
  const parseCurrent = useAppStore((s) => s.parsedSource === s.source);
```

```tsx
        <button
          className="format-button"
          disabled={stale || errors.length > 0 || !parseCurrent}
          title="Format document (Ctrl/Cmd-Shift-F)"
          onClick={() => applyFormat()}
        >
          Format
        </button>
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit` — Expected: all tests PASS (the only `applyParse` call sites are `useParsePipeline.ts` and `store.test.ts`, both updated), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: gate format on parsedSource matching the doc (stale-race carry-in)"
```

---

### Task 2: Canvas command stack (pure) + store undo/redo + zero-delta guard

**Files:**
- Create: `src/core/layout/commands.ts`
- Modify: `src/app/store.ts`
- Test: `src/core/layout/commands.test.ts`, modify `src/app/store.test.ts`

**Interfaces:**
- Produces (pure, `src/core/layout/commands.ts`):
  - `interface PositionDelta { id: string; before: TablePosition; after: TablePosition; }`
  - `interface CanvasCommand { label: string; tables: PositionDelta[]; notes: PositionDelta[]; }`
  - `pruneZeroDeltas(cmd: CanvasCommand): CanvasCommand` — drops entries where `before` equals `after`.
  - `isNoopCommand(cmd: CanvasCommand): boolean`
  - `applyDeltas(positions: Record<string, TablePosition>, deltas: PositionDelta[], key: 'before' | 'after'): Record<string, TablePosition>`
  - `interface CommandStack { push(cmd: CanvasCommand): void; undo(): CanvasCommand | null; redo(): CanvasCommand | null; canUndo(): boolean; canRedo(): boolean; clear(): void; }`
  - `createCommandStack(limit?: number): CommandStack` (default limit 100; `push` clears the redo stack).
- Produces (store):
  - State: `notePositions: Record<string, TablePosition>` (initial `{}`).
  - Module level in `store.ts` (deliberately NOT zustand state: nothing renders from the stack, and mutating an object held inside state in place would never notify subscribers anyway): one `CommandStack` instance, exposed as `getCanvasStack(): CommandStack` and `resetCanvasStack(): void` (fresh stack — called by `loadDiagram` and by tests).
  - Actions: `commitCanvasCommand(cmd: CanvasCommand): void` (prunes zero-deltas; a no-op command is silently dropped — THE zero-delta guard, one place for every caller), `undoCanvas(): void`, `redoCanvas(): void`. Undo/redo apply a delta ONLY if its table/note still exists in the current schema — undoing across a deletion must never resurrect a dead position key (it would be autosaved until the next clean parse prunes it).

- [ ] **Step 1: Write the failing tests**

`src/core/layout/commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createCommandStack, pruneZeroDeltas, isNoopCommand, applyDeltas,
  type CanvasCommand,
} from './commands';

const move = (id: string, x: number): CanvasCommand => ({
  label: 'move table',
  tables: [{ id, before: { x: 0, y: 0 }, after: { x, y: 0 } }],
  notes: [],
});

describe('pruneZeroDeltas / isNoopCommand', () => {
  it('drops entries whose before equals after', () => {
    const cmd: CanvasCommand = {
      label: 'move tables',
      tables: [
        { id: 'a', before: { x: 1, y: 2 }, after: { x: 1, y: 2 } },
        { id: 'b', before: { x: 1, y: 2 }, after: { x: 9, y: 2 } },
      ],
      notes: [{ id: 'n', before: { x: 5, y: 5 }, after: { x: 5, y: 5 } }],
    };
    const pruned = pruneZeroDeltas(cmd);
    expect(pruned.tables.map((d) => d.id)).toEqual(['b']);
    expect(pruned.notes).toEqual([]);
    expect(isNoopCommand(pruned)).toBe(false);
    expect(isNoopCommand(pruneZeroDeltas({ label: 'x', tables: cmd.notes, notes: [] }))).toBe(true);
  });
});

describe('applyDeltas', () => {
  it('applies the chosen side and returns the same object for empty deltas', () => {
    const pos = { a: { x: 0, y: 0 } };
    expect(applyDeltas(pos, [], 'after')).toBe(pos);
    const out = applyDeltas(pos, [{ id: 'a', before: { x: 0, y: 0 }, after: { x: 7, y: 8 } }], 'after');
    expect(out.a).toEqual({ x: 7, y: 8 });
    expect(pos.a).toEqual({ x: 0, y: 0 }); // input not mutated
    const back = applyDeltas(out, [{ id: 'a', before: { x: 0, y: 0 }, after: { x: 7, y: 8 } }], 'before');
    expect(back.a).toEqual({ x: 0, y: 0 });
  });
});

describe('createCommandStack', () => {
  it('undo/redo round-trips in LIFO order', () => {
    const s = createCommandStack();
    s.push(move('a', 10));
    s.push(move('a', 20));
    expect(s.canUndo()).toBe(true);
    expect(s.undo()?.tables[0].after.x).toBe(20);
    expect(s.undo()?.tables[0].after.x).toBe(10);
    expect(s.undo()).toBeNull();
    expect(s.redo()?.tables[0].after.x).toBe(10);
    expect(s.redo()?.tables[0].after.x).toBe(20);
    expect(s.redo()).toBeNull();
  });
  it('push clears the redo stack', () => {
    const s = createCommandStack();
    s.push(move('a', 10));
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.push(move('a', 30));
    expect(s.canRedo()).toBe(false);
  });
  it('caps history at the limit, dropping the oldest', () => {
    const s = createCommandStack(2);
    s.push(move('a', 1));
    s.push(move('a', 2));
    s.push(move('a', 3));
    expect(s.undo()?.tables[0].after.x).toBe(3);
    expect(s.undo()?.tables[0].after.x).toBe(2);
    expect(s.undo()).toBeNull();
  });
  it('clear empties both stacks', () => {
    const s = createCommandStack();
    s.push(move('a', 1));
    s.undo();
    s.clear();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });
});
```

Append to `src/app/store.test.ts` — first change the store import to `import { useAppStore, getCanvasStack, resetCanvasStack } from './store';` and extend `reset` (this is the version all later tasks build on):

```ts
const reset = () => {
  resetCanvasStack();
  useAppStore.setState({
    diagramId: null, diagramName: 'Untitled', source: '', schema: EMPTY_SCHEMA,
    errors: [], stale: false, positions: {}, viewport: { x: 0, y: 0, zoom: 1 },
    hoveredTableId: null, storageUnavailable: false, editorFocusTableId: null,
    parsedSource: null, notePositions: {},
  });
};
```

Then append:

```ts
describe('canvas command stack', () => {
  beforeEach(reset);
  const seed = () => {
    const src = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src), src);
  };

  it('commit applies after-positions and undo/redo round-trips', () => {
    seed();
    const before = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.a', before, after: { x: 900, y: 40 } }],
      notes: [],
    });
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 900, y: 40 });
    useAppStore.getState().undoCanvas();
    expect(useAppStore.getState().positions['public.a']).toEqual(before);
    useAppStore.getState().redoCanvas();
    expect(useAppStore.getState().positions['public.a']).toEqual({ x: 900, y: 40 });
  });

  it('zero-delta commit is dropped — no state change, no undo entry', () => {
    seed();
    const st = useAppStore.getState();
    const positionsBefore = st.positions;
    const pos = st.positions['public.a'];
    st.commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.a', before: pos, after: { ...pos } }],
      notes: [],
    });
    expect(useAppStore.getState().positions).toBe(positionsBefore); // not even a new object
    expect(getCanvasStack().canUndo()).toBe(false);
  });

  it('a multi-entry command undoes atomically (tables and notes together)', () => {
    seed();
    useAppStore.setState({ notePositions: { todo: { x: 10, y: 10 } } });
    const a = useAppStore.getState().positions['public.a'];
    const b = useAppStore.getState().positions['public.b'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move tables',
      tables: [
        { id: 'public.a', before: a, after: { x: a.x + 50, y: a.y } },
        { id: 'public.b', before: b, after: { x: b.x + 50, y: b.y } },
      ],
      notes: [{ id: 'todo', before: { x: 10, y: 10 }, after: { x: 60, y: 10 } }],
    });
    useAppStore.getState().undoCanvas();
    const st = useAppStore.getState();
    expect(st.positions['public.a']).toEqual(a);
    expect(st.positions['public.b']).toEqual(b);
    expect(st.notePositions.todo).toEqual({ x: 10, y: 10 });
  });

  it('undo after a later edit deleted the table does not resurrect its position', () => {
    seed();
    const b = useAppStore.getState().positions['public.b'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table',
      tables: [{ id: 'public.b', before: b, after: { x: 700, y: 700 } }],
      notes: [],
    });
    const src2 = 'Table a { id int }'; // table b deleted by a later edit
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    useAppStore.getState().undoCanvas(); // consumes the entry; must not crash or re-insert public.b
    expect(useAppStore.getState().positions['public.b']).toBeUndefined();
  });

  it('a new command clears redo', () => {
    seed();
    const a = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table', tables: [{ id: 'public.a', before: a, after: { x: 1, y: 1 } }], notes: [],
    });
    useAppStore.getState().undoCanvas();
    useAppStore.getState().commitCanvasCommand({
      label: 'move table', tables: [{ id: 'public.a', before: a, after: { x: 2, y: 2 } }], notes: [],
    });
    expect(getCanvasStack().canRedo()).toBe(false);
  });

  it('loadDiagram starts a fresh stack', () => {
    seed();
    const a = useAppStore.getState().positions['public.a'];
    useAppStore.getState().commitCanvasCommand({
      label: 'move table', tables: [{ id: 'public.a', before: a, after: { x: 5, y: 5 } }], notes: [],
    });
    useAppStore.getState().loadDiagram({
      id: 'd3', name: 'Y', dbml: 'Table y { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(getCanvasStack().canUndo()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/layout/commands.test.ts src/app/store.test.ts` — Expected: FAIL (cannot resolve `./commands`; store actions missing).

- [ ] **Step 3: Implement**

`src/core/layout/commands.ts`:

```ts
import type { TablePosition } from '../model/types';

export interface PositionDelta {
  id: string;
  before: TablePosition;
  after: TablePosition;
}

export interface CanvasCommand {
  label: string;
  tables: PositionDelta[];
  notes: PositionDelta[];
}

const changed = (d: PositionDelta) => d.before.x !== d.after.x || d.before.y !== d.after.y;

/** Drop entries that do not actually move anything. THE zero-delta guard:
 *  every canvas commit funnels through this, so click / double-click gestures
 *  can never pollute undo history with no-op commands. */
export function pruneZeroDeltas(cmd: CanvasCommand): CanvasCommand {
  return { ...cmd, tables: cmd.tables.filter(changed), notes: cmd.notes.filter(changed) };
}

export function isNoopCommand(cmd: CanvasCommand): boolean {
  return cmd.tables.length === 0 && cmd.notes.length === 0;
}

export function applyDeltas(
  positions: Record<string, TablePosition>,
  deltas: PositionDelta[],
  key: 'before' | 'after',
): Record<string, TablePosition> {
  if (deltas.length === 0) return positions;
  const out = { ...positions };
  for (const d of deltas) out[d.id] = d[key];
  return out;
}

export interface CommandStack {
  push(cmd: CanvasCommand): void;
  undo(): CanvasCommand | null;
  redo(): CanvasCommand | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createCommandStack(limit = 100): CommandStack {
  const undoStack: CanvasCommand[] = [];
  const redoStack: CanvasCommand[] = [];
  return {
    push(cmd) {
      undoStack.push(cmd);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    undo() {
      const cmd = undoStack.pop();
      if (!cmd) return null;
      redoStack.push(cmd);
      return cmd;
    },
    redo() {
      const cmd = redoStack.pop();
      if (!cmd) return null;
      undoStack.push(cmd);
      return cmd;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}
```

`src/app/store.ts` — add imports:

```ts
import {
  applyDeltas, createCommandStack, isNoopCommand, pruneZeroDeltas,
  type CanvasCommand, type CommandStack,
} from '../core/layout/commands';
```

Add the module-level stack + helpers (below the imports, above `useAppStore`):

```ts
// Module-level, deliberately NOT zustand state: the command stack is not
// render state — nothing subscribes to it, and mutating an object held
// inside state in place would never notify subscribers anyway.
let canvasStack = createCommandStack();
export const getCanvasStack = (): CommandStack => canvasStack;
export function resetCanvasStack(): void {
  canvasStack = createCommandStack();
}

// Undo/redo may replay a command whose table/note a later edit deleted;
// applying that delta would resurrect a dead position key (autosaved until
// the next clean parse prunes it). Apply only ids that still exist.
function applyCommandSide(
  s: Pick<AppState, 'schema' | 'positions' | 'notePositions'>,
  cmd: CanvasCommand,
  key: 'before' | 'after',
): Pick<AppState, 'positions' | 'notePositions'> {
  const tableIds = new Set(s.schema.tables.map((t) => t.id));
  const noteIds = new Set(s.schema.notes.map((n) => n.id));
  return {
    positions: applyDeltas(s.positions, cmd.tables.filter((d) => tableIds.has(d.id)), key),
    notePositions: applyDeltas(s.notePositions, cmd.notes.filter((d) => noteIds.has(d.id)), key),
  };
}
```

Add to `AppState`:

```ts
  notePositions: Record<string, TablePosition>;
  commitCanvasCommand(cmd: CanvasCommand): void;
  undoCanvas(): void;
  redoCanvas(): void;
```

Initial state additions:

```ts
    notePositions: {},
```

Actions (after `moveTable`):

```ts
    commitCanvasCommand: (raw) => {
      const cmd = pruneZeroDeltas(raw);
      if (isNoopCommand(cmd)) return; // zero-delta guard: no state change, no history entry
      canvasStack.push(cmd);
      set((s) => ({
        positions: applyDeltas(s.positions, cmd.tables, 'after'),
        notePositions: applyDeltas(s.notePositions, cmd.notes, 'after'),
      }));
    },

    undoCanvas: () => {
      const cmd = canvasStack.undo();
      if (!cmd) return;
      set((s) => applyCommandSide(s, cmd, 'before'));
    },

    redoCanvas: () => {
      const cmd = canvasStack.redo();
      if (!cmd) return;
      set((s) => applyCommandSide(s, cmd, 'after'));
    },
```

`loadDiagram` resets the stack and gains `notePositions` — the full cumulative version as of this task:

```ts
    loadDiagram: (rec) => {
      resetCanvasStack();
      set({
        diagramId: rec.id,
        diagramName: rec.name,
        source: rec.dbml,
        positions: rec.positions,
        notePositions: {},
        viewport: rec.viewport,
        schema: EMPTY_SCHEMA,
        errors: [],
        stale: true, // until the parse pipeline catches up
        parsedSource: null,
        hoveredTableId: null,
        editorFocusTableId: null,
      });
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit` — Expected: PASS (7 new commands tests + 6 new store tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/layout/commands.ts src/core/layout/commands.test.ts src/app/store.ts src/app/store.test.ts && git commit -m "feat: canvas command stack with zero-delta guard and store undo/redo"
```

---

### Task 3: Snap-to-grid + alignment-guide math (pure)

**Files:**
- Create: `src/canvas/snap.ts` (pure — no React, no store imports)
- Test: `src/canvas/snap.test.ts`

**Interfaces:**
- Produces:
  - `GRID_SIZE = 16`, `SNAP_TOLERANCE = 6` (world units)
  - `interface GuideLine { axis: 'x' | 'y'; at: number; }` (`axis: 'x'` = a vertical line at world x `at`)
  - `interface SnapResult { pos: TablePosition; guides: GuideLine[]; }`
  - `snapToGrid(v: number): number`
  - `snapPosition(raw: TablePosition, size: { w: number; h: number }, others: Rect[], tolerance?: number): SnapResult` — edge/center alignment against `others` wins within `tolerance`; otherwise grid snap. Guides are emitted only for alignment snaps (grid snapping draws no lines).

- [ ] **Step 1: Write the failing test**

`src/canvas/snap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GRID_SIZE, SNAP_TOLERANCE, snapToGrid, snapPosition } from './snap';
import type { Rect } from '../core/model/types';

describe('snapToGrid', () => {
  it('rounds to the nearest grid multiple', () => {
    expect(GRID_SIZE).toBe(16);
    expect(snapToGrid(37)).toBe(32);
    expect(snapToGrid(40)).toBe(48);
    expect(snapToGrid(-9)).toBe(-16);
    expect(snapToGrid(0)).toBe(0);
  });
});

describe('snapPosition', () => {
  const size = { w: 200, h: 100 };

  it('grid-snaps with no neighbors and emits no guides', () => {
    const r = snapPosition({ x: 37, y: 70 }, size, []);
    expect(r.pos).toEqual({ x: 32, y: 64 });
    expect(r.guides).toEqual([]);
  });

  it('left-edge alignment beats grid snap and emits a vertical guide', () => {
    const others: Rect[] = [{ x: 100, y: 400, w: 220, h: 120 }];
    const r = snapPosition({ x: 103, y: 100 }, size, others);
    expect(r.pos.x).toBe(100);
    expect(r.pos.y).toBe(96); // y has no alignment within tolerance → grid
    expect(r.guides).toEqual([{ axis: 'x', at: 100 }]);
  });

  it('prefers the closest alignment (center over edge here)', () => {
    const others: Rect[] = [{ x: 0, y: 0, w: 220, h: 120 }];
    // center: |14+100-110| = 4; right-to-right: |214-220| = 6 → center wins
    const r = snapPosition({ x: 14, y: 308 }, size, others);
    expect(r.pos.x).toBe(10); // 110 - w/2
    expect(r.guides).toContainEqual({ axis: 'x', at: 110 });
  });

  it('snaps both axes and emits both guides when both align', () => {
    const others: Rect[] = [{ x: 0, y: 0, w: 220, h: 120 }];
    const r = snapPosition({ x: 3, y: 118 }, { w: 220, h: 120 }, others);
    expect(r.pos).toEqual({ x: 0, y: 120 }); // left-to-left, top-to-bottom stack
    expect(r.guides).toEqual([
      { axis: 'x', at: 0 },
      { axis: 'y', at: 120 },
    ]);
  });

  it('falls back to grid outside the tolerance', () => {
    const others: Rect[] = [{ x: 100, y: 400, w: 220, h: 120 }];
    const r = snapPosition({ x: 108, y: 100 }, size, others); // 8 > SNAP_TOLERANCE
    expect(SNAP_TOLERANCE).toBe(6);
    expect(r.pos.x).toBe(112);
    expect(r.guides).toEqual([]);
  });

  it('honors a custom tolerance (zoom-scaled by the caller)', () => {
    const others: Rect[] = [{ x: 100, y: 400, w: 220, h: 120 }];
    const r = snapPosition({ x: 108, y: 100 }, size, others, 20);
    expect(r.pos.x).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/canvas/snap.test.ts` — Expected: FAIL (cannot resolve `./snap`).

- [ ] **Step 3: Implement**

`src/canvas/snap.ts`:

```ts
import type { Rect, TablePosition } from '../core/model/types';

export const GRID_SIZE = 16;
export const SNAP_TOLERANCE = 6; // world units; callers divide by zoom for screen-constant feel

export interface GuideLine {
  axis: 'x' | 'y'; // 'x' = vertical line at world x `at`
  at: number;
}

export interface SnapResult {
  pos: TablePosition;
  guides: GuideLine[];
}

export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

interface Best {
  at: number;
  snapped: number;
  d: number;
}

/** Snap a dragged box: edge/center alignment with nearby rects wins (closest
 *  match, strict <, first-found breaks ties), else snap-to-grid. Guides are
 *  emitted only for alignment snaps.
 *  ponytail: O(others × 9) per pointermove — fine for the 120-table target;
 *  switch to sorted edge lists if a profile ever says otherwise. */
export function snapPosition(
  raw: TablePosition,
  size: { w: number; h: number },
  others: Rect[],
  tolerance = SNAP_TOLERANCE,
): SnapResult {
  let bestX: Best | null = null;
  let bestY: Best | null = null;
  for (const r of others) {
    const xTargets = [r.x, r.x + r.w / 2, r.x + r.w];
    const yTargets = [r.y, r.y + r.h / 2, r.y + r.h];
    const xAnchors = [0, size.w / 2, size.w];
    const yAnchors = [0, size.h / 2, size.h];
    for (const t of xTargets) {
      for (const a of xAnchors) {
        const d = Math.abs(raw.x + a - t);
        if (d <= tolerance && (!bestX || d < bestX.d)) bestX = { at: t, snapped: t - a, d };
      }
    }
    for (const t of yTargets) {
      for (const a of yAnchors) {
        const d = Math.abs(raw.y + a - t);
        if (d <= tolerance && (!bestY || d < bestY.d)) bestY = { at: t, snapped: t - a, d };
      }
    }
  }
  const guides: GuideLine[] = [];
  if (bestX) guides.push({ axis: 'x', at: bestX.at });
  if (bestY) guides.push({ axis: 'y', at: bestY.at });
  return {
    pos: {
      x: bestX ? bestX.snapped : snapToGrid(raw.x),
      y: bestY ? bestY.snapped : snapToGrid(raw.y),
    },
    guides,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/canvas/snap.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/canvas/snap.ts src/canvas/snap.test.ts && git commit -m "feat: snap-to-grid and alignment-guide math"
```

---
### Task 4: Selection state + marquee geometry (pure + store)

**Files:**
- Create: `src/canvas/marquee.ts` (pure)
- Modify: `src/core/model/geometry.ts`, `src/app/store.ts`
- Test: `src/canvas/marquee.test.ts`, modify `src/core/model/geometry.test.ts`, `src/app/store.test.ts`

**Interfaces:**
- Consumes: `Rect`, `Point` (core types).
- Produces:
  - `rectsOverlap(a: Rect, b: Rect): boolean` in `src/core/model/geometry.ts` (strict inequality: touching edges do NOT overlap; reused later by culling and the ELK test).
  - `rectFromPoints(a: Point, b: Point): Rect` in `src/canvas/marquee.ts`
  - `idsInRect(items: Array<{ id: string; rect: Rect }>, sel: Rect): string[]` (intersection semantics)
  - Store: `selectedTableIds: string[]` (initial `[]`), `setSelectedTables(ids: string[]): void`; `loadDiagram` clears it; a successful `applyParse` prunes ids whose tables no longer exist.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/model/geometry.test.ts`:

```ts
describe('rectsOverlap', () => {
  it('detects intersection and rejects separation', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
  });
  it('treats touching edges as non-overlapping', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});
```

(also add `rectsOverlap` to that file's import from `./geometry`).

`src/canvas/marquee.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rectFromPoints, idsInRect } from './marquee';

describe('rectFromPoints', () => {
  it('normalizes any drag direction into a positive rect', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 50 })).toEqual({ x: 4, y: 20, w: 6, h: 30 });
    expect(rectFromPoints({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('idsInRect', () => {
  const items = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 50 } },
    { id: 'b', rect: { x: 200, y: 0, w: 100, h: 50 } },
    { id: 'c', rect: { x: 0, y: 200, w: 100, h: 50 } },
  ];
  it('selects by intersection, not containment', () => {
    expect(idsInRect(items, { x: 50, y: 25, w: 200, h: 10 })).toEqual(['a', 'b']);
  });
  it('returns empty for a rect that hits nothing', () => {
    expect(idsInRect(items, { x: 400, y: 400, w: 50, h: 50 })).toEqual([]);
  });
});
```

Append to `src/app/store.test.ts`:

```ts
describe('table selection', () => {
  beforeEach(reset);
  it('sets and clears the selection', () => {
    useAppStore.getState().setSelectedTables(['public.a', 'public.b']);
    expect(useAppStore.getState().selectedTableIds).toEqual(['public.a', 'public.b']);
    useAppStore.getState().setSelectedTables([]);
    expect(useAppStore.getState().selectedTableIds).toEqual([]);
  });
  it('applyParse prunes selected ids for deleted tables', () => {
    const src1 = 'Table a { id int }\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src1), src1);
    useAppStore.getState().setSelectedTables(['public.a', 'public.b']);
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().selectedTableIds).toEqual(['public.a']);
  });
  it('loadDiagram clears the selection', () => {
    useAppStore.getState().setSelectedTables(['public.a']);
    useAppStore.getState().loadDiagram({
      id: 'd4', name: 'Z', dbml: 'Table z { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().selectedTableIds).toEqual([]);
  });
});
```

and extend the `reset` helper's object with `selectedTableIds: [],`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/canvas/marquee.test.ts src/core/model/geometry.test.ts src/app/store.test.ts` — Expected: FAIL (missing module / missing exports / missing state).

- [ ] **Step 3: Implement**

Append to `src/core/model/geometry.ts`:

```ts
/** Strict-inequality intersection: rects that merely touch do not overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
```

`src/canvas/marquee.ts`:

```ts
import type { Point, Rect } from '../core/model/types';
import { rectsOverlap } from '../core/model/geometry';

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Marquee semantics: any intersection selects (dbdiagram-style), not full containment. */
export function idsInRect(items: Array<{ id: string; rect: Rect }>, sel: Rect): string[] {
  return items.filter((it) => rectsOverlap(it.rect, sel)).map((it) => it.id);
}
```

`src/app/store.ts`:
- `AppState` gains `selectedTableIds: string[];` and `setSelectedTables(ids: string[]): void;`
- Initial state: `selectedTableIds: [],`
- Action: `setSelectedTables: (selectedTableIds) => set({ selectedTableIds }),`
- `loadDiagram`'s `set({...})` gains `selectedTableIds: [],`
- `applyParse` success branch: destructure `selectedTableIds` from `get()` and add to the `set({...})`:

```ts
      const { schema: prev, positions, selectedTableIds } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      const tableIds = new Set(result.schema.tables.map((t) => t.id));
      set({
        schema: result.schema,
        positions: { ...kept, ...placed },
        selectedTableIds: selectedTableIds.filter((id) => tableIds.has(id)),
        errors: [],
        stale: false,
        parsedSource: source,
      });
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit` — Expected: PASS (2 + 3 + 3 new tests), clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: selection state and marquee hit-test geometry"
```

---

### Task 5: Drag pipeline rework — snap, guides, move-set, undoable commits, Ctrl/Cmd-Z routing

This task replaces the `moveTable`-on-drop path with `commitCanvasCommand`, adds live snapping + guide lines, moves whole selections as a unit, and routes keyboard undo/redo to the canvas when the editor is not focused. It is a component task: full code below, verification is build + browser.

**Files:**
- Modify: `src/canvas/DiagramCanvas.tsx` (full replacement below)
- Modify: `src/canvas/TableNode.tsx` (full replacement below)
- Modify: `src/canvas/EdgeLayer.tsx` (handle rename)
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `snapPosition`/`SNAP_TOLERANCE`/`GuideLine` (Task 3), `commitCanvasCommand`/`undoCanvas`/`redoCanvas`/`selectedTableIds` (Tasks 2/4), `PositionDelta` type (Task 2).
- Produces:
  - `EdgeLayerHandle` becomes `{ updateTablePositions(overrides: Record<string, TablePosition>): void }` (plural; re-routes only edges touching the overridden ids).
  - `TableNode` props change: `onLiveMove: (id: string, raw: TablePosition) => TablePosition` (returns the snapped position, which TableNode applies to its own transform), `onCommitMove: (id: string) => void` (DiagramCanvas owns the drag ledger), new `registerEl: (id: string, el: SVGGElement | null) => void`.
  - Drag of a table in the current selection moves the whole selection; commit is ONE `CanvasCommand`. A gesture whose raw pointer travel never exceeds `DRAG_THRESHOLD_PX = 3` screen px is a click (no snap, no live moves, no commit — just selection); combined with the store's zero-delta guard this closes the ledger item "double-click fires two no-op commits" and stops 1–2 px click jitter from grid-snapping a table into a real undo entry.
  - Wheel zoom keeps `vpRef`/`applyTransform` immediate but debounces the store commit + zoom-% state to a trailing 150 ms — commit-at-gesture-end semantics like pan, so the React work Task 7 later hangs off the viewport (LOD, culling) runs at wheel-idle, never per tick.
  - Window keydown: Ctrl/Cmd-Z → `undoCanvas`, Shift-Ctrl/Cmd-Z or Ctrl/Cmd-Y → `redoCanvas`, ignored when the event target is inside `.cm-editor`, `input`, or `textarea`.

- [ ] **Step 1: Implement `src/canvas/EdgeLayer.tsx` handle change**

Replace the `EdgeLayerHandle` interface and the `useImperativeHandle` block:

```ts
export interface EdgeLayerHandle {
  updateTablePositions(overrides: Record<string, TablePosition>): void;
}
```

```ts
  useImperativeHandle(ref, () => ({
    updateTablePositions(overrides) {
      const live = { ...positions, ...overrides };
      const touched = new Set<EdgeSpec>();
      for (const id of Object.keys(overrides)) {
        for (const s of specsByTable.get(id) ?? []) touched.add(s);
      }
      for (const spec of touched) {
        const p = edgePath(spec, live, tablesById);
        if (p) pathRefs.current.get(spec.id)?.setAttribute('d', p.d);
      }
    },
  }), [positions, specsByTable, tablesById]);
```

- [ ] **Step 2: Implement `src/canvas/TableNode.tsx`** (full file):

```tsx
import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';

interface Props {
  table: Table;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  onLiveMove: (id: string, raw: TablePosition) => TablePosition;
  onCommitMove: (id: string) => void;
  onHover: (id: string | null) => void;
  focused: boolean;
  onOpenInEditor: (id: string) => void;
  registerEl: (id: string, el: SVGGElement | null) => void;
}

export const TableNode = memo(function TableNode({
  table, pos, zoomRef, onLiveMove, onCommitMove, onHover, focused, onOpenInEditor, registerEl,
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
      className={`table-node${focused ? ' focused' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => onHover(table.id)}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={() => onOpenInEditor(table.id)}
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

- [ ] **Step 3: Implement `src/canvas/DiagramCanvas.tsx`** (full file):

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { EdgeLayer, type EdgeLayerHandle } from './EdgeLayer';
import { TableNode } from './TableNode';
import { zoomAt } from './viewport';
import { fitViewport } from './fitView';
import { snapPosition, SNAP_TOLERANCE, type GuideLine } from './snap';
import { getTableRect, TABLE_WIDTH, tableHeight } from '../core/model/geometry';
import { revealTable } from '../editor/editorNav';
import type { PositionDelta } from '../core/layout/commands';
import type { Rect, TablePosition, Viewport } from '../core/model/types';

const DRAG_THRESHOLD_PX = 3; // below this raw pointer travel, a gesture is a click

interface DragState {
  id: string; // the table under the pointer
  members: string[]; // whole moving set (selection if it contains `id`, else just `id`)
  base: Record<string, TablePosition>; // member positions at gesture start
  live: Record<string, TablePosition>; // latest snapped member positions
  otherRects: Rect[]; // snap candidates: every positioned table outside the moving set
  size: { w: number; h: number }; // dragged table's box for snap anchoring
  moved: boolean; // raw pointer travel exceeded DRAG_THRESHOLD_PX at some point
}

export function DiagramCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const edgeLayerRef = useRef<EdgeLayerHandle>(null);
  const guideXRef = useRef<SVGLineElement>(null);
  const guideYRef = useRef<SVGLineElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const dragRef = useRef<DragState | null>(null);
  const vpRef = useRef<Viewport>(useAppStore.getState().viewport);
  const zoomRef = useRef<number>(vpRef.current.zoom);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(Math.round(vpRef.current.zoom * 100));

  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const setHoveredTable = useAppStore((s) => s.setHoveredTable);
  const editorFocusTableId = useAppStore((s) => s.editorFocusTableId);

  // Registry of table <g> elements so multi-drag can move selection members
  // imperatively without querySelector or per-render closures.
  const registerNodeEl = useCallback((id: string, el: SVGGElement | null) => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  }, []);

  // Guide lines are two persistent <line> elements toggled/positioned via
  // direct setAttribute — never React state (perf contract).
  const showGuides = (guides: GuideLine[]) => {
    const gx = guides.find((g) => g.axis === 'x');
    const gy = guides.find((g) => g.axis === 'y');
    const vx = guideXRef.current;
    const vy = guideYRef.current;
    if (vx) {
      if (gx) {
        vx.setAttribute('x1', String(gx.at));
        vx.setAttribute('x2', String(gx.at));
        vx.setAttribute('visibility', 'visible');
      } else vx.setAttribute('visibility', 'hidden');
    }
    if (vy) {
      if (gy) {
        vy.setAttribute('y1', String(gy.at));
        vy.setAttribute('y2', String(gy.at));
        vy.setAttribute('visibility', 'visible');
      } else vy.setAttribute('visibility', 'hidden');
    }
  };
  const hideGuides = () => showGuides([]);

  // Live drag: snap the pointer table, shift every other member by the same
  // delta via direct DOM writes, re-route affected edges imperatively, and
  // return the snapped position for TableNode's own transform.
  const handleLiveMove = useCallback((id: string, raw: TablePosition): TablePosition => {
    let drag = dragRef.current;
    if (!drag || drag.id !== id) {
      const s = useAppStore.getState();
      const wanted = s.selectedTableIds.includes(id) ? s.selectedTableIds : [id];
      const members = wanted.filter((m) => s.positions[m]);
      const memberSet = new Set(members);
      const table = s.schema.tables.find((t) => t.id === id);
      const base: Record<string, TablePosition> = {};
      for (const m of members) base[m] = s.positions[m];
      drag = dragRef.current = {
        id,
        members,
        base,
        live: { ...base },
        otherRects: s.schema.tables
          .filter((t) => s.positions[t.id] && !memberSet.has(t.id))
          .map((t) => getTableRect(t, s.positions[t.id])),
        size: { w: TABLE_WIDTH, h: tableHeight(table?.fields.length ?? 0) },
        moved: false,
      };
    }
    if (!drag.moved) {
      const zoom = zoomRef.current ?? 1;
      const px = (raw.x - drag.base[id].x) * zoom;
      const py = (raw.y - drag.base[id].y) * zoom;
      if (Math.hypot(px, py) < DRAG_THRESHOLD_PX) return drag.base[id]; // click jitter: don't snap, don't move
      drag.moved = true;
    }
    const tolerance = SNAP_TOLERANCE / (zoomRef.current ?? 1);
    const { pos, guides } = snapPosition(raw, drag.size, drag.otherRects, tolerance);
    const dx = pos.x - drag.base[id].x;
    const dy = pos.y - drag.base[id].y;
    for (const m of drag.members) {
      const p = { x: drag.base[m].x + dx, y: drag.base[m].y + dy };
      drag.live[m] = p;
      if (m !== id) nodeEls.current.get(m)?.setAttribute('transform', `translate(${p.x}, ${p.y})`);
    }
    edgeLayerRef.current?.updateTablePositions(drag.live);
    showGuides(guides);
    return pos;
  }, []);

  // Gesture end: one undoable command for the whole moved set. A gesture that
  // never exceeded the 3 px click threshold (plain click / each half of a
  // double-click / hand jitter) selects the table instead — and
  // commitCanvasCommand's zero-delta prune backstops no-op entries regardless.
  const handleCommitMove = useCallback((id: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    hideGuides();
    const store = useAppStore.getState();
    if (!drag || !drag.moved) {
      store.setSelectedTables([id]);
      return;
    }
    const tables: PositionDelta[] = drag.members.map((m) => ({
      id: m,
      before: drag.base[m],
      after: drag.live[m],
    }));
    store.commitCanvasCommand({
      label: drag.members.length > 1 ? 'move tables' : 'move table',
      tables,
      notes: [],
    });
  }, []);
  // (showGuides/hideGuides touch refs only, so the first-render closures
  // captured by the [] callbacks above stay correct.)

  // Canvas undo/redo shortcuts. The editor pane keeps CodeMirror history:
  // anything typed while focus is inside .cm-editor never reaches the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('.cm-editor') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useAppStore.getState().redoCanvas();
        else useAppStore.getState().undoCanvas();
      } else if (key === 'y') {
        e.preventDefault();
        useAppStore.getState().redoCanvas();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const applyTransform = () => {
    const { x, y, zoom } = vpRef.current;
    zoomRef.current = zoom;
    sceneRef.current?.setAttribute('transform', `translate(${x}, ${y}) scale(${zoom})`);
  };

  useLayoutEffect(() => {
    // sync when viewport changes externally (diagram load, zoom-to-fit).
    // Layout-timed so a freshly loaded diagram's viewport is applied before
    // paint — a passive effect here would let one frame render at the
    // previous (usually wrong) viewport first.
    return useAppStore.subscribe(
      (s) => s.viewport,
      (vp) => { vpRef.current = vp; applyTransform(); setZoomPct(Math.round(vp.zoom * 100)); },
      { fireImmediately: true },
    );
  }, []);

  useEffect(() => {
    const svg = svgRef.current!;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      vpRef.current = zoomAt(vpRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY);
      applyTransform(); // immediate: the zoom itself never touches React
      // Commit-at-gesture-end semantics, like pan: the store write (and the
      // React render it triggers — zoom %, and later LOD/culling) lands at
      // wheel-idle, never per tick.
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        commitTimer = null;
        useAppStore.getState().setViewport(vpRef.current);
        setZoomPct(Math.round(vpRef.current.zoom * 100));
      }, 150);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
      if (commitTimer) clearTimeout(commitTimer);
    };
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
    setZoomPct(Math.round(vpRef.current.zoom * 100));
  };

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

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="diagram-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g ref={sceneRef}>
          <EdgeLayer ref={edgeLayerRef} />
          {schema.tables.map((t) =>
            positions[t.id] ? (
              <TableNode
                key={t.id}
                table={t}
                pos={positions[t.id]}
                zoomRef={zoomRef}
                onLiveMove={handleLiveMove}
                onCommitMove={handleCommitMove}
                onHover={setHoveredTable}
                focused={t.id === editorFocusTableId}
                onOpenInEditor={revealTable}
                registerEl={registerNodeEl}
              />
            ) : null,
          )}
          <line ref={guideXRef} className="guide" y1={-100000} y2={100000} visibility="hidden" vectorEffect="non-scaling-stroke" />
          <line ref={guideYRef} className="guide" x1={-100000} x2={100000} visibility="hidden" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <div className="zoom-controls">
        <button onClick={() => zoomBy(1.2)}>+</button>
        <button onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button onClick={fit}>fit</button>
        <span>{zoomPct}%</span>
      </div>
    </div>
  );
}
```

Append to `src/styles.css` (and add `--guide: #e0407f;` inside the existing `:root { ... }` block):

```css
.guide { stroke: var(--guide); stroke-width: 1; }
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — Expected: green/clean (no unit tests touch these components; the removed `moveTable` selector is unused elsewhere in the canvas).

- [ ] **Step 5: Manual verify (dev server)**

1. Drag a table slowly past another's left edge — it snaps at 16 px grid steps, then sticks to the neighbor's edge with a pink vertical guide line; center alignment shows the guide at the neighbor's center.
2. Drop, then Ctrl/Cmd-Z with focus on the canvas side → the table jumps back; Shift-Ctrl/Cmd-Z → forward again.
3. Click into the editor, Ctrl/Cmd-Z → the last TEXT edit undoes; the table does not move.
4. Double-click a table → editor reveals it, and Ctrl/Cmd-Z on the canvas does NOT replay any phantom move (zero-delta guard).
5. Drag during an active edge — edges re-route live; guides disappear on drop.
6. Mash-click a table with a slightly jittery hand (1–2 px wobble) — it never nudges to the grid and adds no undo entry (3 px threshold).
7. Wheel-zoom continuously — the scene scales per tick, but the zoom % readout settles ~150 ms after you stop (debounced commit).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: drag pipeline — snap, guides, undoable move commands, undo/redo keys"
```

---

### Task 6: Marquee gesture, selection visuals, selection-aware edge highlight, pan modes

Left-drag on empty canvas now draws a marquee (spec §3). Panning moves to Space+left-drag or middle-button drag; wheel zoom is unchanged.

**Files:**
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/canvas/TableNode.tsx`, `src/canvas/EdgeLayer.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `rectFromPoints`, `idsInRect` (Task 4), `setSelectedTables`/`selectedTableIds` (Task 4).
- Produces: `TableNode` gains `selected: boolean` prop (class `selected`); `EdgeLayer` highlights edges whose either endpoint is hovered OR selected (multi-select aware — the missing piece of spec §6 hover/select highlighting); Escape clears selection; click on empty canvas clears selection.

- [ ] **Step 1: Implement**

`src/canvas/DiagramCanvas.tsx` — add imports:

```tsx
import { useMemo } from 'react'; // merge into the existing react import
import { rectFromPoints, idsInRect } from './marquee';
import type { Point } from '../core/model/types'; // merge into the existing types import
```

Add refs and selectors (next to the other refs / selectors):

```tsx
  const marqueeRef = useRef<SVGRectElement>(null);
  const marqueeState = useRef<{ start: Point } | null>(null);
  const spaceDown = useRef(false);

  const selectedTableIds = useAppStore((s) => s.selectedTableIds);
  const selectedSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
```

Add a Space-tracking effect and extend the existing keydown handler with an Escape branch — replace the whole keyboard effect from Task 5 with:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('.cm-editor') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        useAppStore.getState().setSelectedTables([]);
        return;
      }
      if (e.key === ' ') {
        // Don't hijack Space when a button has focus — it would both arm the
        // pan AND re-activate the focused button (e.g. a zoom control).
        if (!target?.closest('button')) spaceDown.current = true;
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useAppStore.getState().redoCanvas();
        else useAppStore.getState().undoCanvas();
      } else if (key === 'y') {
        e.preventDefault();
        useAppStore.getState().redoCanvas();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
```

Add a screen→world helper (component scope, above the pointer handlers):

```tsx
  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { x, y, zoom } = vpRef.current;
    return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
  };
```

Replace the three svg pointer handlers:

```tsx
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== svgRef.current) return;
    const wantPan = e.button === 1 || (e.button === 0 && spaceDown.current);
    if (wantPan) {
      e.preventDefault(); // best effort against middle-click autoscroll
      svgRef.current!.setPointerCapture(e.pointerId);
      panRef.current = { startX: e.clientX, startY: e.clientY, origX: vpRef.current.x, origY: vpRef.current.y };
      return;
    }
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    marqueeState.current = { start: toWorld(e.clientX, e.clientY) };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      vpRef.current = {
        ...vpRef.current,
        x: panRef.current.origX + (e.clientX - panRef.current.startX),
        y: panRef.current.origY + (e.clientY - panRef.current.startY),
      };
      applyTransform();
      return;
    }
    const m = marqueeState.current;
    const el = marqueeRef.current;
    if (!m || !el) return;
    const r = rectFromPoints(m.start, toWorld(e.clientX, e.clientY));
    el.setAttribute('x', String(r.x));
    el.setAttribute('y', String(r.y));
    el.setAttribute('width', String(r.w));
    el.setAttribute('height', String(r.h));
    el.setAttribute('visibility', 'visible');
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      panRef.current = null;
      useAppStore.getState().setViewport(vpRef.current);
      setZoomPct(Math.round(vpRef.current.zoom * 100));
      return;
    }
    const m = marqueeState.current;
    if (!m) return;
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

In the scene `<g>`, after the guide lines, add:

```tsx
          <rect ref={marqueeRef} className="marquee" visibility="hidden" vectorEffect="non-scaling-stroke" />
```

Pass the new prop to each `TableNode` (inside the existing `.map()`):

```tsx
                selected={selectedSet.has(t.id)}
```

`src/canvas/TableNode.tsx` — add to `Props`: `selected: boolean;`, destructure it, and change the root class:

```tsx
      className={`table-node${focused ? ' focused' : ''}${selected ? ' selected' : ''}`}
```

`src/canvas/EdgeLayer.tsx` — add the selection subscription and make `hot` selection-aware:

```tsx
  const selectedTableIds = useAppStore((s) => s.selectedTableIds);
  const selectedSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
```

and in the render loop:

```tsx
        const hot =
          hoveredTableId === spec.fromTableId ||
          hoveredTableId === spec.toTableId ||
          selectedSet.has(spec.fromTableId) ||
          selectedSet.has(spec.toTableId);
```

Append to `src/styles.css`:

```css
.table-node.selected .table-body { stroke: var(--accent); stroke-width: 2; }
.marquee { fill: var(--accent); fill-opacity: 0.08; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; }
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — green/clean.

- [ ] **Step 3: Manual verify (dev server)**

1. Left-drag on empty canvas → dashed marquee; release → intersecting tables outline blue and their edges highlight (multi-select aware).
2. Drag any selected table → the whole set moves as a unit, snapping as one; ONE Ctrl/Cmd-Z restores all of them.
3. Escape (canvas focused) clears the selection; a plain click on empty canvas clears it too; clicking a single table selects just it.
4. Space+drag pans; middle-button drag pans; wheel still zooms at the cursor.
5. Typing Space in the editor inserts a space (no pan hijack).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: marquee multi-select, multi-drag, selection-aware highlighting, pan modes"
```

---

### Task 7: Level-of-detail rendering + viewport culling

**Files:**
- Create: `src/canvas/lod.ts`, `src/canvas/culling.ts` (pure)
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/canvas/TableNode.tsx`, `src/canvas/EdgeLayer.tsx`
- Test: `src/canvas/lod.test.ts`, `src/canvas/culling.test.ts`

**Interfaces:**
- Produces (pure):
  - `LOD_FIELDS_MIN_ZOOM = 0.4`, `LOD_TEXT_MIN_ZOOM = 0.15`, `type LodLevel = 'full' | 'shell' | 'box'`, `lodLevel(zoom: number): LodLevel`
  - `CULL_MARGIN_FRACTION = 0.5`, `visibleWorldRect(vp: Viewport, viewW: number, viewH: number, marginFraction?: number): Rect`
- Produces (components):
  - `TableNode` gains `lod: LodLevel` prop: `'full'` = today's rendering; `'shell'` = body + header + title, no field rows; `'box'` = one colored rect, no text. Height never changes across levels.
  - `DiagramCanvas` unmounts tables outside `visibleWorldRect` (half-viewport margin each side — pop-in only appears at pan end for tables more than half a screen away, the accepted trade for keeping pan imperative); `EdgeLayer` gains a `viewRect: Rect | null` prop and skips edges with BOTH endpoints offscreen.
  - Culling cannot fight the imperative drag path: a mid-drag member that is culled simply has no element in the `nodeEls` registry — the DOM write is skipped, `drag.live` still carries its correct position into the commit.

- [ ] **Step 1: Write the failing tests**

`src/canvas/lod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LOD_FIELDS_MIN_ZOOM, LOD_TEXT_MIN_ZOOM, lodLevel } from './lod';

describe('lodLevel', () => {
  it('exposes the named thresholds', () => {
    expect(LOD_FIELDS_MIN_ZOOM).toBe(0.4);
    expect(LOD_TEXT_MIN_ZOOM).toBe(0.15);
  });
  it('selects full at and above 40%', () => {
    expect(lodLevel(1)).toBe('full');
    expect(lodLevel(0.4)).toBe('full');
  });
  it('selects shell between 15% and 40%', () => {
    expect(lodLevel(0.399)).toBe('shell');
    expect(lodLevel(0.15)).toBe('shell');
  });
  it('selects box below 15%', () => {
    expect(lodLevel(0.149)).toBe('box');
    expect(lodLevel(0.1)).toBe('box');
  });
});
```

`src/canvas/culling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { visibleWorldRect, CULL_MARGIN_FRACTION } from './culling';
import { rectsOverlap } from '../core/model/geometry';

describe('visibleWorldRect', () => {
  it('maps the screen to world coordinates with margin', () => {
    expect(CULL_MARGIN_FRACTION).toBe(0.5);
    expect(visibleWorldRect({ x: 0, y: 0, zoom: 1 }, 800, 600)).toEqual({ x: -400, y: -300, w: 1600, h: 1200 });
  });
  it('accounts for pan and zoom (no margin)', () => {
    expect(visibleWorldRect({ x: -100, y: 50, zoom: 2 }, 800, 600, 0)).toEqual({ x: 50, y: -25, w: 400, h: 300 });
  });
  it('composes with rectsOverlap as the culling predicate', () => {
    const view = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, 800, 600, 0);
    expect(rectsOverlap({ x: 700, y: 100, w: 220, h: 88 }, view)).toBe(true); // straddles right edge
    expect(rectsOverlap({ x: 900, y: 100, w: 220, h: 88 }, view)).toBe(false); // fully offscreen
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/canvas/lod.test.ts src/canvas/culling.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the pure modules**

`src/canvas/lod.ts`:

```ts
/** Named LOD thresholds (spec §6): below 40% zoom field rows drop out,
 *  below 15% tables render as colored rectangles with no text. */
export const LOD_FIELDS_MIN_ZOOM = 0.4;
export const LOD_TEXT_MIN_ZOOM = 0.15;

export type LodLevel = 'full' | 'shell' | 'box';

export function lodLevel(zoom: number): LodLevel {
  if (zoom < LOD_TEXT_MIN_ZOOM) return 'box';
  if (zoom < LOD_FIELDS_MIN_ZOOM) return 'shell';
  return 'full';
}
```

`src/canvas/culling.ts`:

```ts
import type { Rect, Viewport } from '../core/model/types';

/** Margin as a fraction of each viewport dimension, added on every side.
 *  Half a viewport keeps pop-in out of sight for anything less than a
 *  half-screen fling: culling recomputes only on gesture-end commits (pan
 *  release / the wheel's 150 ms idle commit) — the gestures themselves are
 *  imperative and never re-render. */
export const CULL_MARGIN_FRACTION = 0.5;

export function visibleWorldRect(
  vp: Viewport,
  viewW: number,
  viewH: number,
  marginFraction = CULL_MARGIN_FRACTION,
): Rect {
  const mx = viewW * marginFraction;
  const my = viewH * marginFraction;
  return {
    x: (-vp.x - mx) / vp.zoom,
    y: (-vp.y - my) / vp.zoom,
    w: (viewW + 2 * mx) / vp.zoom,
    h: (viewH + 2 * my) / vp.zoom,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/canvas/lod.test.ts src/canvas/culling.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Wire the components**

`src/canvas/TableNode.tsx` — add to `Props`: `lod: LodLevel;` with `import { type LodLevel } from './lod';`, destructure it, and replace the returned JSX body content (everything inside the root `<g>...</g>`, keeping the `<g>` element and its handlers exactly as in Task 6) with:

```tsx
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
        </>
      )}
```

`src/canvas/EdgeLayer.tsx` — give the component a props type and cull double-offscreen edges. Change the two existing imports to:

```tsx
import { getTableRect, fieldRowY, rectsOverlap } from '../core/model/geometry';
import type { Rect, Table, TablePosition } from '../core/model/types';
```

and re-declare the component with props:

```tsx
interface EdgeLayerProps {
  viewRect: Rect | null;
}

export const EdgeLayer = forwardRef<EdgeLayerHandle, EdgeLayerProps>(function EdgeLayer({ viewRect }, ref) {
```

and at the top of the `specs.map((spec) => { ... })` callback, before computing `edgePath`:

```tsx
        if (viewRect) {
          const ft = tablesById.get(spec.fromTableId);
          const tt = tablesById.get(spec.toTableId);
          const fp = positions[spec.fromTableId];
          const tp = positions[spec.toTableId];
          if (
            ft && tt && fp && tp &&
            !rectsOverlap(getTableRect(ft, fp), viewRect) &&
            !rectsOverlap(getTableRect(tt, tp), viewRect)
          ) {
            return null; // both endpoints offscreen (with margin) — skip
          }
        }
```

`src/canvas/DiagramCanvas.tsx` — add imports:

```tsx
import { lodLevel } from './lod';
import { visibleWorldRect } from './culling';
import { rectsOverlap } from '../core/model/geometry'; // merge into the geometry import
```

Add size tracking + derived values (after the store selectors):

```tsx
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const svg = svgRef.current!;
    const update = () => {
      const r = svg.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Safe to subscribe: pan commits on release and wheel commits 150 ms after
  // the last tick (Task 5's debounced commit), so this re-render fires at
  // gesture end / wheel idle — never per tick.
  const viewport = useAppStore((s) => s.viewport);
  const lod = lodLevel(viewport.zoom);
  const viewRect = size.w > 0 ? visibleWorldRect(viewport, size.w, size.h) : null;
```

Update the render: `<EdgeLayer ref={edgeLayerRef} viewRect={viewRect} />` and replace the table `.map()` callback body with a culling filter:

```tsx
          {schema.tables.map((t) => {
            const pos = positions[t.id];
            if (!pos) return null;
            if (viewRect && !rectsOverlap(getTableRect(t, pos), viewRect)) return null;
            return (
              <TableNode
                key={t.id}
                table={t}
                pos={pos}
                zoomRef={zoomRef}
                lod={lod}
                onLiveMove={handleLiveMove}
                onCommitMove={handleCommitMove}
                onHover={setHoveredTable}
                focused={t.id === editorFocusTableId}
                selected={selectedSet.has(t.id)}
                onOpenInEditor={revealTable}
                registerEl={registerNodeEl}
              />
            );
          })}
```

Append to `src/styles.css` (the focus rule from Plan 2 and the selection rule from Task 6 target `.table-body`, which the box branch does not render — without these rules marquee selection would be invisible at overview zoom):

```css
.table-box { fill: var(--table-header); stroke: var(--border); }
.table-node.selected .table-box,
.table-node.focused .table-box { stroke: var(--accent); stroke-width: 2; }
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — green/clean.

- [ ] **Step 7: Manual verify (dev server)**

1. Zoom out to ~30%: field rows vanish, headers + titles remain; ~12%: plain colored rectangles, zero text.
2. Zoom back past 40%: full detail returns; drag still snaps and undoes correctly at every LOD.
3. Zoom in far, pan a table offscreen and release — Elements panel shows the offscreen table's `<g>` unmounted; edges to it survive while it is within half a viewport of the edge; an edge with both tables far offscreen is gone.
4. Resize the window — culling bounds follow.
5. Wheel-zoom continuously across the 40% threshold — the scene scales smoothly per tick; the LOD switch and culling update land ~150 ms after the wheel stops (debounced commit), never mid-gesture.
6. Marquee-select at ~12% zoom — the box-LOD rectangles still show the accent selection outline.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: level-of-detail rendering and viewport culling"
```

---
### Task 8: Minimap

**Files:**
- Create: `src/canvas/minimapMath.ts` (pure), `src/canvas/MiniMap.tsx`
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/styles.css`
- Test: `src/canvas/minimapMath.test.ts`

**Interfaces:**
- Produces (pure):
  - `MINIMAP_W = 180`, `MINIMAP_H = 120`, `MINIMAP_PAD = 8`
  - `interface MiniTransform { scale: number; ox: number; oy: number; }` (mini = world × scale + offset)
  - `boundsOfRects(rects: Rect[]): Rect | null` (null when empty; min size 1 to avoid division by zero)
  - `minimapTransform(bounds: Rect, mapW?, mapH?, pad?): MiniTransform` (fit + center)
  - `worldToMini(t: MiniTransform, p: Point): Point`, `miniToWorld(t: MiniTransform, p: Point): Point`
- Produces (components):
  - `MiniMap` — memoized overlay, cheapest LOD (rects only, no text), renders from the same `schema`/`positions` store state. `MiniMapHandle { updateViewport(vp: Viewport): void }` moves the viewport rectangle via `setAttribute` — transform-driven, so live pan/zoom costs zero React renders. Props: `{ viewSize: { w: number; h: number }; onNavigate: (worldCenter: Point, commit: boolean) => void; }`.
  - `DiagramCanvas.applyTransform` additionally pokes `minimapRef.current?.updateViewport(...)`; `handleMinimapNav` recenters the viewport imperatively during a minimap drag and commits to the store on release.

- [ ] **Step 1: Write the failing test**

`src/canvas/minimapMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boundsOfRects, minimapTransform, worldToMini, miniToWorld, MINIMAP_W, MINIMAP_H, MINIMAP_PAD } from './minimapMath';

describe('boundsOfRects', () => {
  it('returns null for empty input', () => {
    expect(boundsOfRects([])).toBeNull();
  });
  it('returns the union bounding box', () => {
    expect(boundsOfRects([
      { x: 100, y: 100, w: 200, h: 100 },
      { x: 400, y: 250, w: 100, h: 50 },
    ])).toEqual({ x: 100, y: 100, w: 400, h: 200 });
  });
});

describe('minimapTransform', () => {
  const bounds = { x: 100, y: 100, w: 400, h: 200 };
  const t = minimapTransform(bounds);
  it('fits the bounds inside the padded map, centered', () => {
    expect(MINIMAP_W).toBe(180);
    expect(MINIMAP_H).toBe(120);
    expect(t.scale).toBeCloseTo((MINIMAP_W - 2 * MINIMAP_PAD) / 400); // width-limited: 0.41
    const topLeft = worldToMini(t, { x: 100, y: 100 });
    const bottomRight = worldToMini(t, { x: 500, y: 300 });
    expect(topLeft.x).toBeCloseTo(MINIMAP_PAD);
    expect(bottomRight.x).toBeCloseTo(MINIMAP_W - MINIMAP_PAD);
    // vertically centered: equal slack above and below
    expect(topLeft.y - 0).toBeCloseTo(MINIMAP_H - bottomRight.y);
  });
  it('round-trips world↔mini', () => {
    const p = { x: 234, y: 187 };
    const back = miniToWorld(t, worldToMini(t, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/canvas/minimapMath.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the pure module**

`src/canvas/minimapMath.ts`:

```ts
import type { Point, Rect } from '../core/model/types';

export const MINIMAP_W = 180;
export const MINIMAP_H = 120;
export const MINIMAP_PAD = 8;

export interface MiniTransform {
  scale: number;
  ox: number;
  oy: number;
}

export function boundsOfRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
}

export function minimapTransform(
  bounds: Rect,
  mapW = MINIMAP_W,
  mapH = MINIMAP_H,
  pad = MINIMAP_PAD,
): MiniTransform {
  const scale = Math.min((mapW - 2 * pad) / bounds.w, (mapH - 2 * pad) / bounds.h);
  return {
    scale,
    ox: (mapW - bounds.w * scale) / 2 - bounds.x * scale,
    oy: (mapH - bounds.h * scale) / 2 - bounds.y * scale,
  };
}

export function worldToMini(t: MiniTransform, p: Point): Point {
  return { x: p.x * t.scale + t.ox, y: p.y * t.scale + t.oy };
}

export function miniToWorld(t: MiniTransform, p: Point): Point {
  return { x: (p.x - t.ox) / t.scale, y: (p.y - t.oy) / t.scale };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/canvas/minimapMath.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Implement the component + wiring**

`src/canvas/MiniMap.tsx`:

```tsx
import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { getTableRect } from '../core/model/geometry';
import {
  MINIMAP_H, MINIMAP_W, boundsOfRects, miniToWorld, minimapTransform, worldToMini,
  type MiniTransform,
} from './minimapMath';
import type { Point, Viewport } from '../core/model/types';

export interface MiniMapHandle {
  updateViewport(vp: Viewport): void;
}

interface Props {
  viewSize: { w: number; h: number };
  onNavigate: (worldCenter: Point, commit: boolean) => void;
}

export const MiniMap = memo(forwardRef<MiniMapHandle, Props>(function MiniMap({ viewSize, onNavigate }, ref) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const viewRectEl = useRef<SVGRectElement>(null);
  const dragging = useRef(false);

  const items = useMemo(
    () =>
      schema.tables
        .filter((t) => positions[t.id])
        .map((t) => ({ id: t.id, rect: getTableRect(t, positions[t.id]), color: t.headerColor })),
    [schema, positions],
  );
  const bounds = useMemo(() => boundsOfRects(items.map((i) => i.rect)), [items]);
  const t: MiniTransform | null = bounds ? minimapTransform(bounds) : null;

  // Latest-value refs so the imperative handle never goes stale without
  // needing to re-register anything on the hot path.
  const tRef = useRef(t);
  tRef.current = t;
  const viewSizeRef = useRef(viewSize);
  viewSizeRef.current = viewSize;

  const applyViewport = useCallback((vp: Viewport) => {
    const tr = tRef.current;
    const el = viewRectEl.current;
    if (!tr || !el) return;
    const topLeft = worldToMini(tr, { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom });
    el.setAttribute('x', String(topLeft.x));
    el.setAttribute('y', String(topLeft.y));
    el.setAttribute('width', String((viewSizeRef.current.w / vp.zoom) * tr.scale));
    el.setAttribute('height', String((viewSizeRef.current.h / vp.zoom) * tr.scale));
  }, []);

  useImperativeHandle(ref, () => ({ updateViewport: applyViewport }), [applyViewport]);

  // Re-sync the viewport rect after every render (bounds/scale may have changed).
  useLayoutEffect(() => {
    applyViewport(useAppStore.getState().viewport);
  });

  if (!t || !bounds) return null;

  const navTo = (e: React.PointerEvent<SVGSVGElement>, commit: boolean) => {
    const tr = tRef.current;
    if (!tr) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onNavigate(miniToWorld(tr, { x: e.clientX - rect.left, y: e.clientY - rect.top }), commit);
  };

  return (
    <svg
      className="minimap"
      width={MINIMAP_W}
      height={MINIMAP_H}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        navTo(e, false);
      }}
      onPointerMove={(e) => {
        if (dragging.current) navTo(e, false);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        navTo(e, true);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {items.map((i) => {
        const p = worldToMini(t, i.rect);
        return (
          <rect
            key={i.id}
            x={p.x}
            y={p.y}
            width={i.rect.w * t.scale}
            height={i.rect.h * t.scale}
            className="minimap-table"
            fill={i.color ?? undefined}
          />
        );
      })}
      <rect ref={viewRectEl} className="minimap-view" />
    </svg>
  );
}));
```

`src/canvas/DiagramCanvas.tsx`:
- Import: `import { MiniMap, type MiniMapHandle } from './MiniMap';`
- Add ref: `const minimapRef = useRef<MiniMapHandle>(null);`
- Extend `applyTransform` (this is the single point every imperative pan/zoom flows through, so the minimap viewport rect stays live without React):

```tsx
  const applyTransform = () => {
    const { x, y, zoom } = vpRef.current;
    zoomRef.current = zoom;
    sceneRef.current?.setAttribute('transform', `translate(${x}, ${y}) scale(${zoom})`);
    minimapRef.current?.updateViewport(vpRef.current);
  };
```

- Add the navigation handler (stable — reads refs only):

```tsx
  const handleMinimapNav = useCallback((center: Point, commit: boolean) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const zoom = vpRef.current.zoom;
    vpRef.current = { zoom, x: rect.width / 2 - center.x * zoom, y: rect.height / 2 - center.y * zoom };
    applyTransform();
    if (commit) useAppStore.getState().setViewport(vpRef.current);
  }, []);
  // (applyTransform touches refs only; the first-render closure stays correct.)
```

- In the JSX, inside `.canvas-wrap` after the `</svg>`:

```tsx
      <MiniMap ref={minimapRef} viewSize={size} onNavigate={handleMinimapNav} />
```

Append to `src/styles.css`:

```css
.minimap {
  position: absolute; right: 12px; bottom: 52px; display: block;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  opacity: 0.92; cursor: pointer;
}
.minimap-table { fill: var(--table-header); }
.minimap-view { fill: var(--accent); fill-opacity: 0.15; stroke: var(--accent); stroke-width: 1; }
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — green/clean.

- [ ] **Step 7: Manual verify (dev server)**

1. Minimap appears bottom-right above the zoom controls, showing one colored rect per table and a translucent viewport rectangle.
2. Pan/zoom the canvas — the viewport rect tracks live (during the gesture, not just at the end).
3. Click a far corner of the minimap → the canvas recenters there; dragging inside the minimap scrubs the viewport continuously and history-commits once on release.
4. Empty diagram → no minimap rendered.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: minimap with live viewport tracking and click/drag navigation"
```

---

### Task 9: Normalizer — TableGroups + sticky notes

The `Schema` contract already has `groups: TableGroup[]` and `notes: StickyNote[]` (Plan 1 types); the normalizer currently emits them empty. This task fills them from the `@dbml/core` 8.3 parse. The raw property names live at the `any` boundary — if 8.3 places them differently (e.g. group color under `tg.settings.color`, notes only on `db.notes` or only per-schema), adapt the NORMALIZER property access; the fixtures and our-`Schema` expectations stay.

**Files:**
- Modify: `src/core/parse/parseDbml.ts`
- Test: modify `src/core/parse/parseDbml.test.ts`

**Interfaces:**
- Consumes: raw `@dbml/core` database object.
- Produces: `normalizeDatabase` fills `groups` (id `${schemaName}.${name}`, member `tableIds` normalized to `${schemaName}.${tableName}`, `color` or null) and `notes` (id = name, deduped, content string).

- [ ] **Step 1: Write the failing test**

Append to `src/core/parse/parseDbml.test.ts`:

```ts
describe('table groups and sticky notes', () => {
  it('normalizes a TableGroup with members and color', () => {
    const r = parseDbml(
      'Table a { id int }\nTable b { id int }\nTableGroup core [color: #1e69de] {\n  a\n  b\n}',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.groups).toHaveLength(1);
    const g = r.schema.groups[0];
    expect(g.id).toBe('public.core');
    expect(g.name).toBe('core');
    expect(g.tableIds).toEqual(['public.a', 'public.b']);
    expect((g.color ?? '').toLowerCase()).toBe('#1e69de');
  });

  it('normalizes a standalone Note block', () => {
    const r = parseDbml("Table a { id int }\nNote todo {\n  'ship the canvas'\n}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.notes).toHaveLength(1);
    expect(r.schema.notes[0]).toEqual({ id: 'todo', name: 'todo', content: 'ship the canvas' });
  });

  it('emits empty groups and notes when the source has none', () => {
    const r = parseDbml('Table a { id int }');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.groups).toEqual([]);
    expect(r.schema.notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/parse/parseDbml.test.ts` — Expected: FAIL (groups/notes come back empty).

- [ ] **Step 3: Implement**

In `src/core/parse/parseDbml.ts`, extend the type import:

```ts
import type {
  Schema, Table, Field, Ref, RefEndpoint, EnumDef, Relation, TableGroup, StickyNote,
} from '../model/types';
```

and inside `normalizeDatabase`, replace the final `return` and add the two collection loops just above it (after the existing per-schema loop):

```ts
  const groups: TableGroup[] = [];
  for (const schema of db.schemas ?? []) {
    const schemaName: string = schema.name ?? 'public';
    for (const tg of schema.tableGroups ?? []) {
      groups.push({
        id: `${schemaName}.${tg.name}`,
        name: String(tg.name),
        color: tg.color ?? null,
        tableIds: (tg.tables ?? []).map((t: any) => {
          const tSchema = t.schemaName ?? t.schema?.name ?? schemaName;
          const tName = t.tableName ?? t.name;
          return `${tSchema}.${tName}`;
        }),
      });
    }
  }

  // Standalone `Note name { '...' }` blocks. 8.3 exposes them on the database
  // object; scan the per-schema slot too and dedupe by name so we adapt to
  // either placement without double-emitting.
  const noteById = new Map<string, StickyNote>();
  const rawNotes: any[] = [
    ...(db.notes ?? []),
    ...(db.schemas ?? []).flatMap((s: any) => s.notes ?? []),
  ];
  for (const n of rawNotes) {
    const name = String(n?.name ?? '');
    if (!name || noteById.has(name)) continue;
    noteById.set(name, { id: name, name, content: n.content != null ? String(n.content) : '' });
  }

  return { tables, refs, enums, groups, notes: [...noteById.values()] };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/parse` — Expected: PASS (3 new tests + all existing). If a property name at the `any` boundary differs in 8.3 (e.g. `tg.color` is `tg.settings?.color`, or group members carry only `t.name`), fix the normalizer access — do NOT touch the fixtures or the expected `Schema` shapes.

- [ ] **Step 5: Commit**

```bash
git add src/core/parse/parseDbml.ts src/core/parse/parseDbml.test.ts && git commit -m "feat: normalize TableGroups and standalone notes from @dbml/core"
```

---

### Task 10: TableGroup containers on canvas

**Files:**
- Create: `src/core/layout/groups.ts`, `src/canvas/GroupLayer.tsx`
- Modify: `src/canvas/DiagramCanvas.tsx`, `src/styles.css`
- Test: `src/core/layout/groups.test.ts`

**Interfaces:**
- Produces (pure):
  - `GROUP_PADDING = 24`, `GROUP_HEADER_HEIGHT = 24`
  - `computeGroupRect(group: TableGroup, schema: Schema, positions: Record<string, TablePosition>): Rect | null` — bounding box of positioned members + padding + header strip; `null` when no member is positioned.
- Produces (components):
  - `GroupLayer` renders group rectangles BEHIND edges and tables (first child of the scene `<g>`), with a header strip, color chip, and name. Dragging the header moves all member tables as a unit via two DiagramCanvas callbacks and commits ONE undo entry.
  - DiagramCanvas: `handleGroupLiveMove(memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number): void` (imperative member + edge updates) and `handleGroupCommit(memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number, label: string): void` (one `commitCanvasCommand`).
  - Known simplification (ponytail): while a SINGLE member table is dragged, the group outline stays put until drop (it re-derives from committed positions); during a group-header drag the whole group visual moves live.

- [ ] **Step 1: Write the failing test**

`src/core/layout/groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeGroupRect, GROUP_PADDING, GROUP_HEADER_HEIGHT } from './groups';
import type { Schema, Table } from '../model/types';

const mkTable = (name: string, fieldCount: number): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: Array.from({ length: fieldCount }, (_, i) => ({
    name: `f${i}`, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
  })),
});

const schema: Schema = {
  tables: [mkTable('a', 1), mkTable('b', 2)],
  refs: [], enums: [],
  groups: [{ id: 'public.core', name: 'core', color: '#1e69de', tableIds: ['public.a', 'public.b'] }],
  notes: [],
};

describe('computeGroupRect', () => {
  it('wraps positioned members with padding and a header strip', () => {
    expect(GROUP_PADDING).toBe(24);
    expect(GROUP_HEADER_HEIGHT).toBe(24);
    const rect = computeGroupRect(schema.groups[0], schema, {
      'public.a': { x: 100, y: 100 }, // 220x60
      'public.b': { x: 400, y: 300 }, // 220x88
    });
    expect(rect).toEqual({ x: 76, y: 52, w: 568, h: 360 });
  });
  it('ignores unpositioned members', () => {
    const rect = computeGroupRect(schema.groups[0], schema, { 'public.a': { x: 0, y: 0 } });
    expect(rect).toEqual({ x: -24, y: -48, w: 268, h: 132 });
  });
  it('returns null when no member is positioned', () => {
    expect(computeGroupRect(schema.groups[0], schema, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/layout/groups.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the pure module**

`src/core/layout/groups.ts`:

```ts
import type { Rect, Schema, TableGroup, TablePosition } from '../model/types';
import { getTableRect } from '../model/geometry';

export const GROUP_PADDING = 24;
export const GROUP_HEADER_HEIGHT = 24;

/** Bounding box of the group's positioned member tables, padded, with extra
 *  headroom for the header strip. Null when nothing is positioned yet. */
export function computeGroupRect(
  group: TableGroup,
  schema: Schema,
  positions: Record<string, TablePosition>,
): Rect | null {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const rects: Rect[] = [];
  for (const id of group.tableIds) {
    const table = byId.get(id);
    const pos = positions[id];
    if (table && pos) rects.push(getTableRect(table, pos));
  }
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x)) - GROUP_PADDING;
  const minY = Math.min(...rects.map((r) => r.y)) - GROUP_PADDING - GROUP_HEADER_HEIGHT;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + GROUP_PADDING;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + GROUP_PADDING;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/layout/groups.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Implement the components**

`src/canvas/GroupLayer.tsx`:

```tsx
import { memo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { computeGroupRect, GROUP_HEADER_HEIGHT } from '../core/layout/groups';
import type { TablePosition } from '../core/model/types';

interface Props {
  zoomRef: React.RefObject<number>;
  onLiveMoveSet: (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number) => void;
  onCommitMoveSet: (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number, label: string) => void;
}

interface GroupDrag {
  memberIds: string[];
  base: Record<string, TablePosition>;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  el: SVGGElement; // the whole group <g>, moved live so rect+header track the drag
}

export const GroupLayer = memo(function GroupLayer({ zoomRef, onLiveMoveSet, onCommitMoveSet }: Props) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const drag = useRef<GroupDrag | null>(null);

  const startDrag = (memberIds: string[]) => (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const pos = useAppStore.getState().positions;
    const base: Record<string, TablePosition> = {};
    for (const id of memberIds) if (pos[id]) base[id] = pos[id];
    drag.current = {
      memberIds: memberIds.filter((id) => base[id]),
      base,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      el: e.currentTarget.parentNode as SVGGElement,
    };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    const zoom = zoomRef.current ?? 1;
    d.dx = (e.clientX - d.startX) / zoom;
    d.dy = (e.clientY - d.startY) / zoom;
    d.el.setAttribute('transform', `translate(${d.dx}, ${d.dy})`);
    onLiveMoveSet(d.memberIds, d.base, d.dx, d.dy);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.el.removeAttribute('transform');
    onCommitMoveSet(d.memberIds, d.base, d.dx, d.dy, 'move group');
  };

  return (
    <g className="group-layer">
      {schema.groups.map((g) => {
        const rect = computeGroupRect(g, schema, positions);
        if (!rect) return null;
        const color = g.color ?? 'var(--table-header)';
        return (
          <g key={g.id} className="table-group">
            <rect className="group-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={8} stroke={color} fill={color} />
            <g
              className="group-header"
              onPointerDown={startDrag(g.tableIds)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <rect x={rect.x} y={rect.y} width={rect.w} height={GROUP_HEADER_HEIGHT} rx={8} fill={color} fillOpacity={0.18} />
              <circle cx={rect.x + 12} cy={rect.y + GROUP_HEADER_HEIGHT / 2} r={5} fill={color} />
              <text x={rect.x + 24} y={rect.y + GROUP_HEADER_HEIGHT / 2} dominantBaseline="central" className="group-title">
                {g.name}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
});
```

`src/canvas/DiagramCanvas.tsx`:
- Import: `import { GroupLayer } from './GroupLayer';`
- Add the two stable callbacks (near `handleLiveMove`):

```tsx
  // Group-header drag: shift member table <g>s and their edges imperatively.
  // Culled (unmounted) members simply have no element in the registry — the
  // DOM write is skipped and the commit below still carries their positions.
  const handleGroupLiveMove = useCallback(
    (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number) => {
      const overrides: Record<string, TablePosition> = {};
      for (const id of memberIds) {
        const b = base[id];
        if (!b) continue;
        const p = { x: b.x + dx, y: b.y + dy };
        overrides[id] = p;
        nodeEls.current.get(id)?.setAttribute('transform', `translate(${p.x}, ${p.y})`);
      }
      edgeLayerRef.current?.updateTablePositions(overrides);
    },
    [],
  );

  const handleGroupCommit = useCallback(
    (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number, label: string) => {
      const tables = memberIds
        .filter((id) => base[id])
        .map((id) => ({ id, before: base[id], after: { x: base[id].x + dx, y: base[id].y + dy } }));
      useAppStore.getState().commitCanvasCommand({ label, tables, notes: [] });
    },
    [],
  );
```

- In the scene `<g>`, render groups FIRST (behind edges and tables): insert this single line as the first child of `<g ref={sceneRef}>`, immediately BEFORE the existing `<EdgeLayer ref={edgeLayerRef} viewRect={viewRect} />` line (which stays unchanged, as does everything after it):

```tsx
          <GroupLayer zoomRef={zoomRef} onLiveMoveSet={handleGroupLiveMove} onCommitMoveSet={handleGroupCommit} />
```

Append to `src/styles.css`:

```css
.group-rect { fill-opacity: 0.05; stroke-width: 1.5; stroke-dasharray: 6 4; }
.group-header { cursor: grab; }
.group-title { font-size: 12px; font-weight: 600; fill: var(--text); }
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — green/clean.

- [ ] **Step 7: Manual verify (dev server)**

Add to the doc:

```
TableGroup core [color: #1e69de] {
  users
  posts
}
```

1. A dashed tinted rectangle with a header strip, color chip, and "core" label wraps users+posts, rendered behind tables and edges.
2. Drag the header → both tables, the rect, and their edges move together live; drop → ONE Ctrl/Cmd-Z restores everything.
3. Click the header without moving → no undo entry (zero-delta guard).
4. Drag a single member table out — the group rect grows to include it on drop.
5. If 8.3 rejects the `[color: ...]` group setting in the browser (it should not, per Task 9's test), the group still renders with the default header color.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: table group containers with unit drag and single undo entry"
```

---

### Task 11: Sticky notes on canvas + persistence

**Files:**
- Create: `src/canvas/NoteNode.tsx`
- Modify: `src/core/model/geometry.ts`, `src/core/layout/placement.ts`, `src/app/store.ts`, `src/core/persist/repository.ts`, `src/app/usePersistence.ts`, `src/canvas/DiagramCanvas.tsx`, `src/styles.css`
- Test: modify `src/core/layout/placement.test.ts`, `src/app/store.test.ts`, `src/core/persist/repository.test.ts`

**Interfaces:**
- Produces:
  - Geometry: `NOTE_WIDTH = 180`, `NOTE_HEIGHT = 120`, `getNoteRect(pos: TablePosition): Rect`
  - `placeNewNotes(schema: Schema, notePositions: Record<string, TablePosition>, occupied: Rect[]): Record<string, TablePosition>` — deterministic grid-scan placement for unpositioned notes, avoiding tables and already-placed notes.
  - Store: `applyParse` success keeps positions of surviving notes (keyed by note name — no rename heuristic by design), prunes deleted ones, places new ones after tables are placed.
  - Persistence: `PersistedDiagram` gains optional `notePositions?: Record<string, TablePosition>` (optional = old records load fine); `loadDiagram` reads `rec.notePositions ?? {}`; autosave includes it.
  - `NoteNode` — draggable sticky (no snap by design), committing `{ notes: [delta] }` commands through `onCommitMove(id, before, after)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/layout/placement.test.ts` (put the two import lines with the file's existing imports at the top):

```ts
import { placeNewNotes } from './placement';
import { NOTE_WIDTH, NOTE_HEIGHT, getNoteRect } from '../model/geometry';

describe('placeNewNotes', () => {
  const note = (name: string) => ({ id: name, name, content: '' });

  it('places unpositioned notes deterministically without overlap', () => {
    const schema: Schema = { tables: [], refs: [], enums: [], groups: [], notes: [note('a'), note('b')] };
    const out = placeNewNotes(schema, {}, []);
    expect(Object.keys(out)).toEqual(['a', 'b']);
    expect(overlaps(getNoteRect(out.a), getNoteRect(out.b))).toBe(false);
    expect(placeNewNotes(schema, {}, [])).toEqual(out); // deterministic
  });

  it('avoids occupied rects and existing note positions', () => {
    const schema: Schema = { tables: [], refs: [], enums: [], groups: [], notes: [note('a'), note('b')] };
    const existing = { a: { x: 60, y: 60 } };
    const out = placeNewNotes(schema, existing, [{ x: 300, y: 60, w: 220, h: 88 }]);
    expect(out.a).toBeUndefined(); // already positioned
    expect(overlaps(getNoteRect(out.b), getNoteRect(existing.a))).toBe(false);
    expect(overlaps(getNoteRect(out.b), { x: 300, y: 60, w: 220, h: 88 })).toBe(false);
    expect(NOTE_WIDTH).toBe(180);
    expect(NOTE_HEIGHT).toBe(120);
  });
});
```

Append to `src/app/store.test.ts` (also extend `reset` — it already has `notePositions: {}` from Task 2):

```ts
describe('sticky note positions', () => {
  beforeEach(reset);
  const NOTE_SRC = "Table a { id int }\nNote todo {\n  'hello'\n}";

  it('applyParse places new notes and keeps them across edits', () => {
    useAppStore.getState().applyParse(parseDbml(NOTE_SRC), NOTE_SRC);
    const placed = useAppStore.getState().notePositions.todo;
    expect(placed).toBeDefined();
    useAppStore.setState({ notePositions: { todo: { x: 555, y: 444 } } });
    const src2 = NOTE_SRC + '\nTable b { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().notePositions.todo).toEqual({ x: 555, y: 444 });
  });

  it('applyParse prunes positions of deleted notes', () => {
    useAppStore.getState().applyParse(parseDbml(NOTE_SRC), NOTE_SRC);
    const src2 = 'Table a { id int }';
    useAppStore.getState().applyParse(parseDbml(src2), src2);
    expect(useAppStore.getState().notePositions.todo).toBeUndefined();
  });

  it('note moves commit through the command stack and undo', () => {
    useAppStore.getState().applyParse(parseDbml(NOTE_SRC), NOTE_SRC);
    const before = useAppStore.getState().notePositions.todo;
    useAppStore.getState().commitCanvasCommand({
      label: 'move note', tables: [], notes: [{ id: 'todo', before, after: { x: 9, y: 9 } }],
    });
    expect(useAppStore.getState().notePositions.todo).toEqual({ x: 9, y: 9 });
    useAppStore.getState().undoCanvas();
    expect(useAppStore.getState().notePositions.todo).toEqual(before);
  });

  it('loadDiagram restores notePositions (defaulting to empty)', () => {
    useAppStore.getState().loadDiagram({
      id: 'd5', name: 'N', dbml: NOTE_SRC,
      positions: {}, notePositions: { todo: { x: 7, y: 8 } },
      viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().notePositions).toEqual({ todo: { x: 7, y: 8 } });
    useAppStore.getState().loadDiagram({
      id: 'd6', name: 'O', dbml: 'Table x { id int }',
      positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 1,
    });
    expect(useAppStore.getState().notePositions).toEqual({});
  });
});
```

Append to `src/core/persist/repository.test.ts`:

```ts
  it('round-trips notePositions', async () => {
    await putDiagram({ ...rec('n', 5), notePositions: { todo: { x: 3, y: 4 } } });
    const got = await getDiagram('n');
    expect(got?.notePositions).toEqual({ todo: { x: 3, y: 4 } });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/layout/placement.test.ts src/app/store.test.ts src/core/persist/repository.test.ts` — Expected: FAIL (missing exports, notes not placed, TS error on `notePositions`).

- [ ] **Step 3: Implement**

Append to `src/core/model/geometry.ts`:

```ts
export const NOTE_WIDTH = 180;
export const NOTE_HEIGHT = 120;

export function getNoteRect(pos: TablePosition): Rect {
  return { x: pos.x, y: pos.y, w: NOTE_WIDTH, h: NOTE_HEIGHT };
}
```

Append to `src/core/layout/placement.ts` (uses the file's existing private `gridScan`; add `NOTE_WIDTH, NOTE_HEIGHT` to its geometry import):

```ts
/** Deterministic placement for standalone notes that have no position yet.
 *  Notes are keyed by name — no rename heuristic by design (spec §3). */
export function placeNewNotes(
  schema: Schema,
  notePositions: Record<string, TablePosition>,
  occupied: Rect[],
): Record<string, TablePosition> {
  const placed: Rect[] = [
    ...occupied,
    ...Object.values(notePositions).map((p) => ({ x: p.x, y: p.y, w: NOTE_WIDTH, h: NOTE_HEIGHT })),
  ];
  const out: Record<string, TablePosition> = {};
  for (const note of schema.notes) {
    if (notePositions[note.id]) continue;
    const spot = gridScan(NOTE_WIDTH, NOTE_HEIGHT, placed);
    out[note.id] = spot;
    placed.push({ ...spot, w: NOTE_WIDTH, h: NOTE_HEIGHT });
  }
  return out;
}
```

`src/core/persist/repository.ts` — extend the record type:

```ts
export interface PersistedDiagram {
  id: string;
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  notePositions?: Record<string, TablePosition>; // optional: pre-Plan-3 records lack it
  viewport: Viewport;
  updatedAt: number;
}
```

`src/app/store.ts`:
- Import `getTableRect` from `../core/model/geometry` and `placeNewNotes` from `../core/layout/placement`.
- `applyParse` success branch becomes (full, cumulative version):

```ts
    applyParse: (result, source) => {
      if (!result.ok) {
        set({ errors: result.errors, stale: true });
        return;
      }
      const { schema: prev, positions, notePositions, selectedTableIds } = get();
      const kept = reconcilePositions(prev, result.schema, positions);
      const placed = placeNewTables(result.schema, kept);
      const nextPositions = { ...kept, ...placed };
      const keptNotes: Record<string, TablePosition> = {};
      for (const n of result.schema.notes) {
        if (notePositions[n.id]) keptNotes[n.id] = notePositions[n.id];
      }
      const occupied = result.schema.tables
        .filter((t) => nextPositions[t.id])
        .map((t) => getTableRect(t, nextPositions[t.id]));
      const placedNotes = placeNewNotes(result.schema, keptNotes, occupied);
      const tableIds = new Set(result.schema.tables.map((t) => t.id));
      set({
        schema: result.schema,
        positions: nextPositions,
        notePositions: { ...keptNotes, ...placedNotes },
        selectedTableIds: selectedTableIds.filter((id) => tableIds.has(id)),
        errors: [],
        stale: false,
        parsedSource: source,
      });
    },
```

- `loadDiagram`: change `notePositions: {},` to `notePositions: rec.notePositions ?? {},`.

`src/app/usePersistence.ts`:
- `currentRecord` gains `notePositions: s.notePositions,` in the returned object.
- The autosave subscription selector becomes:

```ts
      (s) => [s.source, s.positions, s.viewport, s.diagramName, s.notePositions] as const,
```

`src/canvas/NoteNode.tsx`:

```tsx
import { memo, useRef } from 'react';
import type { StickyNote, TablePosition } from '../core/model/types';
import { NOTE_WIDTH, NOTE_HEIGHT } from '../core/model/geometry';

interface Props {
  note: StickyNote;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  onCommitMove: (id: string, before: TablePosition, after: TablePosition) => void;
}

export const NoteNode = memo(function NoteNode({ note, pos, zoomRef, onCommitMove }: Props) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{ startX: number; startY: number; orig: TablePosition; live: TablePosition } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, orig: pos, live: pos };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
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

`src/canvas/DiagramCanvas.tsx`:
- Imports: `import { NoteNode } from './NoteNode';` and `getNoteRect` (merge into the geometry import).
- Selector: `const notePositions = useAppStore((s) => s.notePositions);`
- Stable commit callback (near the other handlers):

```tsx
  const handleNoteCommit = useCallback((id: string, before: TablePosition, after: TablePosition) => {
    useAppStore.getState().commitCanvasCommand({
      label: 'move note',
      tables: [],
      notes: [{ id, before, after }],
    });
  }, []);
```

- Render notes after the tables `.map()` (same culling predicate; notes render above tables):

```tsx
          {schema.notes.map((n) => {
            const pos = notePositions[n.id];
            if (!pos) return null;
            if (viewRect && !rectsOverlap(getNoteRect(pos), viewRect)) return null;
            return <NoteNode key={n.id} note={n} pos={pos} zoomRef={zoomRef} onCommitMove={handleNoteCommit} />;
          })}
```

`src/styles.css` — add to the existing `:root { ... }` block:

```css
  --note-bg: #fff8c5;
  --note-border: #d8c96f;
```

and append:

```css
.sticky-note { cursor: grab; }
.note-body { fill: var(--note-bg); stroke: var(--note-border); }
.note-title { font-size: 11px; font-weight: 600; fill: var(--text); }
.note-content {
  font-size: 11px; color: var(--text); font-family: system-ui, sans-serif;
  white-space: pre-wrap; overflow: hidden; height: 100%;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit` — Expected: PASS (2 + 4 + 1 new tests), clean.

- [ ] **Step 5: Manual verify (dev server)**

1. Add `Note todo { 'ship the canvas' }` at top level → a yellow sticky appears in free space, content wrapped.
2. Drag it; Ctrl/Cmd-Z restores it; reload → position persists (autosave).
3. Delete the Note block → sticky disappears; re-add with the same name → it comes back at a fresh spot (no rename heuristic — by design).
4. Zero-move click on a note adds no undo entry.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: sticky notes — placement, drag, undo, persistence"
```

---
### Task 12: ELK auto-layout

**Worker decision (specified, not deferred):** ELK gets its OWN dedicated worker (`src/core/layout/elk.worker.ts`), NOT the parse worker. Rationale: the parse worker's protocol is `{id, source} → {id, result}` with a dead-flag adapter tuned for a stream of debounced requests; layout is a rare, explicit, one-shot request with a completely different payload. A per-run worker (create → post → receive → terminate) needs no id multiplexing, no lifecycle sharing, and keeps `elkjs` (~1.4 MB minified) in its own chunk that is not even fetched until the first auto-layout click. Fallback when `Worker` is unavailable or the worker chunk fails to load: lazy `import()` of elkjs on the main thread — which is also exactly what vitest's node environment exercises.

**Files:**
- Modify: `package.json` (add `elkjs`, exact pin)
- Create: `src/core/layout/elkGraph.ts`, `src/core/layout/elk.worker.ts`, `src/core/layout/elkLayout.ts`
- Modify: `src/canvas/DiagramCanvas.tsx`
- Test: `src/core/layout/elkGraph.test.ts`, `src/core/layout/elkLayout.test.ts`

**Interfaces:**
- Produces (pure, `elkGraph.ts`):
  - `ELK_ORIGIN = 60`, `ELK_LAYOUT_OPTIONS: Record<string, string>` (layered, direction RIGHT, node spacing 60 / 90 between layers)
  - `interface ElkNodeIn { id: string; width: number; height: number; }`, `interface ElkEdgeIn { id: string; sources: string[]; targets: string[]; }`, `interface ElkGraphIn { id: string; layoutOptions: Record<string, string>; children: ElkNodeIn[]; edges: ElkEdgeIn[]; }`
  - `buildElkGraph(schema: Schema): ElkGraphIn` (self-refs and refs to missing tables skipped)
  - `elkResultToPositions(graph: { children?: Array<{ id: string; x?: number; y?: number }> }): Record<string, TablePosition>` (offset by `ELK_ORIGIN`)
- Produces (`elkLayout.ts`): `runElkLayout(schema: Schema): Promise<Record<string, TablePosition>>` — resolves `{}` for an empty schema; worker path with in-thread fallback; rejects with an `Error` when ELK itself fails.
- Produces (UI): an `auto` button in the canvas zoom-controls — explicit trigger only; result committed as ONE `commitCanvasCommand` (label `auto-layout`, fully undoable); discards the result if the schema changed while the layout ran; zoom-to-fit afterwards. Manual positions are never otherwise disturbed (auto-layout runs on button press only — the parse pipeline never calls it).

- [ ] **Step 1: Install the dependency (exact pin)**

```bash
npm install --save-exact elkjs@0.11.1
```

Expected: `package.json` gains `"elkjs": "0.11.1"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`src/core/layout/elkGraph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildElkGraph, elkResultToPositions, ELK_ORIGIN, ELK_LAYOUT_OPTIONS } from './elkGraph';
import { parseDbml } from '../../core/parse/parseDbml';
import type { Schema } from '../model/types';

const schemaOf = (src: string): Schema => {
  const r = parseDbml(src);
  if (!r.ok) throw new Error('fixture parse failed');
  return r.schema;
};

describe('buildElkGraph', () => {
  it('maps tables to sized nodes and refs to edges', () => {
    const g = buildElkGraph(schemaOf('Table a { id int }\nTable b { id int\n a_id int }\nRef: b.a_id > a.id'));
    expect(g.layoutOptions).toBe(ELK_LAYOUT_OPTIONS);
    expect(g.children).toEqual([
      { id: 'public.a', width: 220, height: 60 },
      { id: 'public.b', width: 220, height: 88 },
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].sources).toEqual(['public.b']);
    expect(g.edges[0].targets).toEqual(['public.a']);
  });
  it('skips self-references', () => {
    const g = buildElkGraph(schemaOf('Table c { id int\n parent_id int }\nRef: c.parent_id > c.id'));
    expect(g.edges).toEqual([]);
  });
  it('produces an empty graph for an empty schema', () => {
    const g = buildElkGraph({ tables: [], refs: [], enums: [], groups: [], notes: [] });
    expect(g.children).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe('elkResultToPositions', () => {
  it('offsets ELK coordinates by the origin', () => {
    expect(elkResultToPositions({ children: [{ id: 't', x: 10, y: 20 }] })).toEqual({
      t: { x: ELK_ORIGIN + 10, y: ELK_ORIGIN + 20 },
    });
  });
});
```

`src/core/layout/elkLayout.test.ts` (node has no global `Worker`, so this exercises the real elkjs through the in-thread fallback — the same code the browser uses if the worker dies):

```ts
import { describe, it, expect } from 'vitest';
import { runElkLayout } from './elkLayout';
import { parseDbml } from '../parse/parseDbml';
import { getTableRect, rectsOverlap } from '../model/geometry';

describe('runElkLayout (in-thread fallback path)', () => {
  it('returns non-overlapping positions for every table', async () => {
    const r = parseDbml(
      'Table a { id int }\nTable b { id int\n a_id int }\nTable c { id int\n a_id int }\n' +
      'Ref: b.a_id > a.id\nRef: c.a_id > a.id',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pos = await runElkLayout(r.schema);
    expect(Object.keys(pos).sort()).toEqual(['public.a', 'public.b', 'public.c']);
    const rects = r.schema.tables.map((t) => getTableRect(t, pos[t.id]));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i], rects[j])).toBe(false);
      }
    }
  }, 20_000);

  it('resolves empty for an empty schema without touching elkjs', async () => {
    await expect(
      runElkLayout({ tables: [], refs: [], enums: [], groups: [], notes: [] }),
    ).resolves.toEqual({});
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/core/layout/elkGraph.test.ts src/core/layout/elkLayout.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

(No type shim needed: elkjs 0.11.1 ships `lib/elk.bundled.d.ts`, and the project's `moduleResolution: "bundler"` resolves the deep import together with its types.)

`src/core/layout/elkGraph.ts`:

```ts
import type { Schema, TablePosition } from '../model/types';
import { TABLE_WIDTH, tableHeight } from '../model/geometry';

export const ELK_ORIGIN = 60;

export const ELK_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
};

export interface ElkNodeIn {
  id: string;
  width: number;
  height: number;
}

export interface ElkEdgeIn {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraphIn {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNodeIn[];
  edges: ElkEdgeIn[];
}

export function buildElkGraph(schema: Schema): ElkGraphIn {
  const ids = new Set(schema.tables.map((t) => t.id));
  return {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: schema.tables.map((t) => ({
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

export function elkResultToPositions(graph: {
  children?: Array<{ id: string; x?: number; y?: number }>;
}): Record<string, TablePosition> {
  const out: Record<string, TablePosition> = {};
  for (const c of graph.children ?? []) {
    out[c.id] = { x: ELK_ORIGIN + (c.x ?? 0), y: ELK_ORIGIN + (c.y ?? 0) };
  }
  return out;
}
```

`src/core/layout/elk.worker.ts`:

```ts
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs';
import type { ElkGraphIn } from './elkGraph';

self.onmessage = async (e: MessageEvent<ElkGraphIn>) => {
  const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);
  try {
    const graph = await new ELK().layout(e.data as unknown as ElkNode);
    post({ ok: true, graph });
  } catch (err) {
    post({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
```

`src/core/layout/elkLayout.ts`:

```ts
import type { Schema, TablePosition } from '../model/types';
import type { ElkNode } from 'elkjs';
import { buildElkGraph, elkResultToPositions, type ElkGraphIn } from './elkGraph';

interface ElkWorkerReply {
  ok: boolean;
  graph?: { children?: Array<{ id: string; x?: number; y?: number }> };
  message?: string;
}

// Lazy: elkjs (~1.4 MB min) must never enter the main chunk. This path runs
// only when Worker is unavailable, or the worker chunk failed to load.
async function layoutInThread(graph: ElkGraphIn): Promise<Record<string, TablePosition>> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const res = await new ELK().layout(graph as unknown as ElkNode);
  return elkResultToPositions(res as NonNullable<ElkWorkerReply['graph']>);
}

/** One-shot layout: a fresh dedicated worker per run (created lazily on the
 *  first auto-layout click, terminated as soon as it answers). Deliberately
 *  NOT the parse worker — different payload, different lifecycle, and this
 *  keeps elkjs in its own on-demand chunk. */
export function runElkLayout(schema: Schema): Promise<Record<string, TablePosition>> {
  const graph = buildElkGraph(schema);
  if (graph.children.length === 0) return Promise.resolve({});
  let worker: Worker;
  try {
    worker = new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return layoutInThread(graph); // no Worker support (and vitest's node env)
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<ElkWorkerReply>) => {
      worker.terminate();
      if (e.data.ok && e.data.graph) resolve(elkResultToPositions(e.data.graph));
      else reject(new Error(e.data.message ?? 'auto-layout failed'));
    };
    worker.onerror = () => {
      // Worker chunk failed to load or crashed before answering: fall back
      // in-thread rather than leaving the promise pending.
      worker.terminate();
      layoutInThread(graph).then(resolve, reject);
    };
    worker.postMessage(graph);
  });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/core/layout` — Expected: PASS (4 elkGraph tests + 2 elkLayout tests + existing layout tests). The overlap test runs real elkjs in-process; first run pays the module-load cost (seconds, inside the raised 20 s timeout).

- [ ] **Step 6: Wire the button**

`src/canvas/DiagramCanvas.tsx`:
- Import: `import { runElkLayout } from '../core/layout/elkLayout';`
- Add busy state next to `zoomPct`: `const [layoutBusy, setLayoutBusy] = useState(false);`
- Add the handler (near `fit`):

```tsx
  const autoLayout = async () => {
    const { schema } = useAppStore.getState();
    if (schema.tables.length === 0 || layoutBusy) return;
    setLayoutBusy(true);
    try {
      const next = await runElkLayout(schema);
      const st = useAppStore.getState();
      if (st.schema !== schema) return; // schema changed mid-layout: stale result, discard
      const tables = Object.keys(next).map((id) => ({
        id,
        before: st.positions[id] ?? next[id], // unknown before → zero delta → pruned
        after: next[id],
      }));
      st.commitCanvasCommand({ label: 'auto-layout', tables, notes: [] });
      fit();
    } catch {
      // layout unavailable (worker + fallback both failed) — positions untouched
    } finally {
      setLayoutBusy(false);
    }
  };
```

- Add the button to the zoom controls (before `+`):

```tsx
        <button onClick={() => void autoLayout()} disabled={layoutBusy} title="Auto-layout (ELK layered)">
          auto
        </button>
```

- [ ] **Step 7: Verify build + bundle budget**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — green/clean. Then verify the chunking:

```bash
grep -l "org.eclipse.elk" dist/assets/*.js
```

Expected: the elk worker/fallback chunk file(s) ONLY — the entry `dist/assets/index-*.js` must NOT be listed. Then:

```bash
for f in dist/assets/index-*.js; do echo "$f: $(gzip -c "$f" | wc -c) bytes gzip"; done
```

Expected: within a few kB of the Plan 2 baseline (~198 kB gzip) and below the 210 kB budget.

- [ ] **Step 8: Manual verify (dev server)**

1. Network tab: no elk chunk fetched on page load. Click `auto` → elk worker chunk loads, tables reflow into layered left-to-right ranks, canvas zooms to fit.
2. ONE Ctrl/Cmd-Z restores every previous position (single undo entry); redo replays the layout.
3. Type a new table, click `auto` again — the new table participates. Editing DBML WITHOUT clicking `auto` never moves existing tables.
4. Click `auto` twice fast — button disables while busy; no double-commit.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: ELK auto-layout in a dedicated worker, single undoable command"
```

---

### Task 13: Dark/light theme

CSS-variable based: every hardcoded color in `styles.css` moves into `:root` variables; a `data-theme="dark"` attribute on `<html>` swaps the palette; the toggle lives in the toolbar and persists via the same guarded localStorage pattern as `SplitPane`'s `readSplit`/`writeSplit`. CodeMirror token colors switch to a `HighlightStyle` backed by CSS variables. `elkjs` remains the only new runtime *engine* dependency; `@lezer/highlight` is declared in `package.json` because this task imports it directly (it is already in the tree via `@codemirror/language` — zero new bundle bytes; an undeclared direct import would break under pnpm/isolated installs). ProblemsPanel's hardcoded light pinks (ledger carry-in) are folded into the same variables.

**Files:**
- Modify: `src/styles.css`, `src/app/App.tsx`, `src/editor/DbmlEditor.tsx`, `package.json`

**Interfaces:**
- Produces: `<html data-theme="dark">` toggles the palette; toolbar button flips + persists (`dbdraft.theme`); all canvas/editor/panel colors respond. No store involvement — no component needs the theme as data, CSS variables carry it everywhere.

- [ ] **Step 1: Implement `src/styles.css`**

Replace the existing `:root { ... }` block (which by now also contains `--guide`, `--note-bg`, `--note-border`) with:

```css
:root {
  --bg: #ffffff;
  --bg-panel: #f6f7f9;
  --bg-elev: #ffffff;
  --canvas-bg: #fafbfc;
  --border: #d9dde3;
  --text: #1f2430;
  --text-dim: #6b7280;
  --accent: #2f6fed;
  --table-header: #3d5a80;
  --table-bg: #ffffff;
  --table-title-text: #ffffff;
  --edge: #8a93a3;
  --edge-hover: #2f6fed;
  --error: #d33;
  --status-ok: #2e7d32;
  --badge-bg: #fdf0d5;
  --badge-text: #92600a;
  --banner-bg: #fdecea;
  --banner-text: #a33333;
  --problems-bg: #fff6f6;
  --problems-hover: #ffecec;
  --selection-bg: #eef3fe;
  --guide: #e0407f;
  --note-bg: #fff8c5;
  --note-border: #d8c96f;
  --code-keyword: #8250df;
  --code-string: #0a7d4b;
  --code-number: #b25e09;
  --code-comment: #6e7781;
  --code-attribute: #953800;
  --code-def: #0550ae;
}

:root[data-theme='dark'] {
  --bg: #16181d;
  --bg-panel: #1e2128;
  --bg-elev: #23262e;
  --canvas-bg: #101216;
  --border: #363b45;
  --text: #dfe3ea;
  --text-dim: #8b93a1;
  --accent: #5b8def;
  --table-header: #46639b;
  --table-bg: #1e222b;
  --table-title-text: #f2f5fa;
  --edge: #6b7484;
  --edge-hover: #5b8def;
  --error: #f07178;
  --status-ok: #6fbf73;
  --badge-bg: #3d3423;
  --badge-text: #e5b567;
  --banner-bg: #3a2626;
  --banner-text: #f0a8a8;
  --problems-bg: #2a2022;
  --problems-hover: #3a2a2e;
  --selection-bg: #24324a;
  --guide: #ff7ab0;
  --note-bg: #3a3623;
  --note-border: #6b633a;
  --code-keyword: #c792ea;
  --code-string: #a5d6a7;
  --code-number: #f2b366;
  --code-comment: #7a8494;
  --code-attribute: #ffcb6b;
  --code-def: #82aaff;
}
```

Then replace every remaining hardcoded color with its variable (exact edits):

| Rule | Old | New |
|---|---|---|
| `.canvas-pane` | `background: #fafbfc;` | `background: var(--canvas-bg);` |
| `.table-body` | `fill: #fff;` | `fill: var(--table-bg);` |
| `.table-title` | `fill: #fff;` | `fill: var(--table-title-text);` |
| `.status-ok` | `color: #2e7d32;` | `color: var(--status-ok);` |
| `.badge.stale` | `color: #92600a; background: #fdf0d5;` | `color: var(--badge-text); background: var(--badge-bg);` |
| `.diagram-manager button` | `background: #fff;` | `background: var(--bg-elev);` |
| `.diagram-list` | `background: #fff;` | `background: var(--bg-elev);` |
| `.diagram-list li.current` | `background: #eef3fe;` | `background: var(--selection-bg);` |
| `.banner-warning` | `background: #fdecea; color: #a33;` | `background: var(--banner-bg); color: var(--banner-text);` |
| `.zoom-controls` | `background: #fff;` | `background: var(--bg-elev);` |
| `.problems-panel` | `background: #fff6f6;` | `background: var(--problems-bg);` |
| `.problems-list button:hover` | `background: #ffecec;` | `background: var(--problems-hover);` |

Also add `color: var(--text);` to the `.diagram-manager button`, `.diagram-list .open-button`, `.problems-list button`, and `.zoom-controls button` rules (they inherited near-black defaults that vanish on dark).

Append editor-chrome overrides (the `.editor-pane` prefix outranks CodeMirror's injected two-class base-theme selectors):

```css
.editor-pane .cm-editor { background: var(--bg); color: var(--text); }
.editor-pane .cm-editor .cm-gutters { background: var(--bg-panel); color: var(--text-dim); border-right: 1px solid var(--border); }
.editor-pane .cm-editor .cm-activeLine { background: transparent; }
.editor-pane .cm-editor .cm-activeLineGutter { background: transparent; }
.editor-pane .cm-editor .cm-cursor { border-left-color: var(--text); }
.editor-pane .cm-editor .cm-selectionBackground,
.editor-pane .cm-editor.cm-focused .cm-selectionBackground { background: var(--selection-bg); }
.editor-pane .cm-editor .cm-tooltip { background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); }
.editor-pane .cm-editor .cm-tooltip-autocomplete ul li[aria-selected] { background: var(--selection-bg); color: var(--text); }
```

- [ ] **Step 2: Implement the toggle in `src/app/App.tsx`**

Add above the component (same guarded pattern as `SplitPane.readSplit`/`writeSplit`):

```tsx
import { useEffect, useState } from 'react';

const THEME_KEY = 'dbdraft.theme';
type Theme = 'light' | 'dark';

// Best-effort persistence — the app must never break because localStorage
// is unavailable or full (same contract as SplitPane's readSplit/writeSplit).
function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function writeTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // ignore — theme just won't persist
  }
}
```

Inside `App()`:

```tsx
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeTheme(theme);
  }, [theme]);
```

Add the button to the toolbar (after the Format button):

```tsx
        <button
          className="theme-button"
          title="Toggle dark/light theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
```

- [ ] **Step 3: Implement variable-driven syntax colors in `src/editor/DbmlEditor.tsx`**

First declare the direct dependency (already present in the tree — zero new bundle bytes):

```bash
npm install @lezer/highlight
```

Add imports:

```tsx
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
```

Add at module level (above the component) — the stream tokenizer's token names map onto these tags (`keyword`, `comment`, `string`, `number`, `attribute` → `attributeName`, `def` → `definition(variableName)`):

```tsx
const dbmlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: tags.string, color: 'var(--code-string)' },
  { tag: tags.number, color: 'var(--code-number)' },
  { tag: tags.attributeName, color: 'var(--code-attribute)' },
  { tag: tags.definition(tags.variableName), color: 'var(--code-def)' },
]);
```

Register it in the `extensions` array right after `dbmlLanguage` (it wins over basicSetup's `defaultHighlightStyle`, which is fallback-only):

```tsx
        syntaxHighlighting(dbmlHighlight),
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — green/clean; the main-chunk gzip size stays within the budget (the highlight style is a few hundred bytes).

- [ ] **Step 5: Manual verify (dev server)**

1. Click `Dark`: toolbar, editor (background, gutters, tokens, autocomplete tooltip), canvas background, tables, edges, guides, marquee, minimap, group rects, sticky notes, badge, statusbar all switch; no leftover white patches.
2. Break the syntax → ProblemsPanel renders dark-tinted (not the old light pink); entries readable.
3. Reload → dark persists. Toggle back to light → everything restores; reload persists light.
4. Custom `headerColor` tables and group colors keep their explicit colors in both themes.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: css-variable dark/light theme with persisted toolbar toggle"
```

---

### Task 14: Integration pass

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
npx vitest run
```
Expected: all tests pass (~150; 109 from Plan 2 + ~40 new).

```bash
npx tsc --noEmit && npm run build
```
Expected: clean. Build output: entry chunk within budget, parser worker chunk and elk chunk(s) separate.

- [ ] **Step 2: Constraint audits**

Core purity:
```bash
grep -rn "from 'react'\|from 'zustand'\|../app/\|../editor/\|../canvas/" src/core/ || true
```
Expected: no output.

Pure canvas helpers stay React-free:
```bash
grep -rn "from 'react'" src/canvas/snap.ts src/canvas/marquee.ts src/canvas/lod.ts src/canvas/culling.ts src/canvas/minimapMath.ts || true
```
Expected: no output.

Bundle budget:
```bash
grep -l "org.eclipse.elk" dist/assets/*.js
for f in dist/assets/index-*.js; do echo "$f: $(gzip -c "$f" | wc -c) bytes gzip"; done
```
Expected: elk string absent from the entry chunk; entry gzip < 210 000 bytes.

- [ ] **Step 3: Browser walkthrough**

1. **Undo routing:** move a table, type in the editor, Ctrl/Cmd-Z in editor undoes text only; Ctrl/Cmd-Z on canvas undoes the move only; double-click navigation adds zero undo entries.
2. **Snap/guides/marquee:** grid snap + edge/center guides during drag; marquee select → group drag as unit → one undo; Escape and empty-click clear; Space/middle-button pan.
3. **LOD + culling:** zoom tiers 100% → 30% → 12%; zoomed-in pan unmounts offscreen tables; edges with both ends offscreen skipped.
4. **Minimap:** live viewport rect during pan/zoom; click + drag navigation; hidden on empty diagram.
5. **Groups + notes:** TableGroup renders behind with color chip; header drag = one undo entry; sticky note drag/undo/persist across reload.
6. **Auto-layout:** explicit button only; single undo entry; fit after layout; elk chunk loads on first click only.
7. **Theme:** dark toggle persists; ProblemsPanel/editor/canvas all themed.
8. **Regression sweep:** typing→parse→stale badge flow, diagram switch/create/duplicate/delete, reload-restore, format button gating (now `parsedSource`-exact), completion, problems-panel jump, two-way navigation.

- [ ] **Step 4: CLAUDE.md touch-up (keep the invariant text accurate)**

Task 5 renamed the edge-layer handle and rerouted the drop commit; CLAUDE.md's invariants still name the old API. In `CLAUDE.md`, make these two exact replacements:

1. In the **Canvas performance contract** paragraph, replace:

```
edges re-routed imperatively through `EdgeLayer`'s `updateTablePosition` during a drag; the store commits on gesture end only.
```

with:

```
edges re-routed imperatively through `EdgeLayer`'s `updateTablePositions` during a drag; the store commits on gesture end only, via `commitCanvasCommand` (zero-delta commits are pruned, so clicks/double-clicks never pollute canvas undo history).
```

2. In the **Text vs layout** paragraph, replace:

```
canvas interactions (drag, viewport) write only layout state (`moveTable`, `setViewport`) — never DBML text.
```

with:

```
canvas interactions (drag, viewport, selection) write only layout state (`commitCanvasCommand`, `setViewport`, selection) — never DBML text.
```

- [ ] **Step 5: Commit + tag**

```bash
git add -A && git commit -m "chore: plan 3 complete — canvas depth" --allow-empty
git tag plan-3-complete
```
