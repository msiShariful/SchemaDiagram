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
