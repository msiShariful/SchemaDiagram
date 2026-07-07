import type { ParseResult } from './parseDbml';

export interface ParsePipeline {
  push(source: string): void;
  dispose(): void;
}

export function createParsePipeline(opts: {
  parse: (source: string) => Promise<ParseResult>;
  onResult: (r: ParseResult) => void;
  debounceMs?: number;
}): ParsePipeline {
  const debounceMs = opts.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let disposed = false;

  return {
    push(source: string) {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const mySeq = ++seq;
        void opts.parse(source).then((result) => {
          if (!disposed && mySeq === seq) opts.onResult(result);
        });
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
