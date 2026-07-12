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
