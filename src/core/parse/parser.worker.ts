import { parseDbml } from './parseDbml';

self.onmessage = (e: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = e.data;
  (self as unknown as Worker).postMessage({ id, result: parseDbml(source) });
};
