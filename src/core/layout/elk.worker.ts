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
