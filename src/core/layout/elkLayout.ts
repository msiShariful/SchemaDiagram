import type { Schema, TablePosition } from '../model/types';
import type { ElkNode } from 'elkjs';
import ELK from 'elkjs/lib/elk-api.js';
import { buildElkGraph, elkResultToPositions, type ElkGraphIn, type ArrangeAlgorithm } from './elkGraph';

type ElkResultGraph = { children?: Array<{ id: string; x?: number; y?: number }> };

// Lazy: elkjs (~1.4 MB min) must never enter the main chunk. This path runs
// only when Worker is unavailable, or the worker chunk failed to load.
// elk.bundled.js's own fake-worker fallback is safe to use here because
// this always runs on the main thread (or in Node), never inside a Worker —
// see elk.worker.ts for why that distinction matters.
async function layoutInThread(graph: ElkGraphIn): Promise<Record<string, TablePosition>> {
  const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js');
  const res = await new ElkBundled().layout(graph as unknown as ElkNode);
  return elkResultToPositions(res as ElkResultGraph);
}

/** One-shot layout: a fresh dedicated worker per run (created lazily on the
 *  first auto-layout click, terminated as soon as it answers). Deliberately
 *  NOT the parse worker — different payload, different lifecycle, and this
 *  keeps elkjs in its own on-demand chunk.
 *
 *  Uses elk-api.js's own ELK class (not elk.bundled.js) with a workerFactory
 *  pointing at elk.worker.ts, elkjs's own worker entry point — see that
 *  file's header comment for why. */
export function runElkLayout(
  schema: Schema,
  hiddenTableIds: readonly string[] = [],
  algorithm: ArrangeAlgorithm = 'left-right',
): Promise<Record<string, TablePosition>> {
  const graph = buildElkGraph(schema, hiddenTableIds, algorithm);
  if (graph.children.length === 0) return Promise.resolve({});

  return new Promise((resolve, reject) => {
    const fallback = () => layoutInThread(graph).then(resolve, reject);
    try {
      const elk = new ELK({
        workerFactory: () => {
          const worker = new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' });
          // Worker chunk failed to load or crashed before answering: fall
          // back in-thread rather than leaving the promise pending.
          worker.onerror = () => {
            worker.terminate();
            fallback();
          };
          return worker;
        },
      });
      elk
        .layout(graph as unknown as ElkNode)
        .then((res) => resolve(elkResultToPositions(res as ElkResultGraph)), reject)
        .finally(() => elk.terminateWorker());
    } catch {
      fallback(); // no Worker support (and vitest's node env)
    }
  });
}
