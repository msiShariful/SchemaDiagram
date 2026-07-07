import { parseDbml, type ParseResult } from './parseDbml';

export function createWorkerParse(): (source: string) => Promise<ParseResult> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return async (source) => parseDbml(source); // no Worker support → in-thread
  }
  let nextId = 0;
  const pending = new Map<number, { source: string; resolve: (r: ParseResult) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; result: ParseResult }>) => {
    pending.get(e.data.id)?.resolve(e.data.result);
    pending.delete(e.data.id);
  };
  worker.onerror = () => {
    // Worker died: answer everything in-flight on the main thread instead.
    for (const [id, p] of pending) {
      p.resolve(parseDbml(p.source));
      pending.delete(id);
    }
  };
  return (source) =>
    new Promise<ParseResult>((resolve) => {
      const id = nextId++;
      pending.set(id, { source, resolve });
      worker.postMessage({ id, source });
    });
}
