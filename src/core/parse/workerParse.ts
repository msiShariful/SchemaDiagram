import { parseDbml, type ParseResult } from './parseDbml';

export interface WorkerParseAdapter {
  parse(source: string): Promise<ParseResult>;
  dispose(): void;
}

export function createWorkerParse(): WorkerParseAdapter {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    // No Worker support → in-thread for the lifetime of this adapter.
    return { parse: async (source) => parseDbml(source), dispose() {} };
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
      p.resolve(parseDbml(p.source));
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
      if (dead) return Promise.resolve(parseDbml(source));
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
