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
