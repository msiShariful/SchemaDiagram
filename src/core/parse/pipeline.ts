import type { ParseResult } from './parseDbml';

export interface ParsePipeline {
  push(source: string): void;
  dispose(): void;
}

export function createParsePipeline(opts: {
  parse: (source: string) => Promise<ParseResult>;
  onResult: (r: ParseResult, source: string) => void;
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
      // Bump the sequence here, not when the timer fires: a push() that
      // lands while an earlier push's parse is already in flight (still
      // inside ITS OWN debounce window, or awaiting opts.parse) must
      // invalidate that in-flight work immediately. Bumping only at
      // fire-time left a gap where a pending-but-not-yet-fired debounce
      // (e.g. armed for a freshly loaded diagram) would not invalidate an
      // older in-flight parse, so a stale result could land after a
      // diagram switch.
      const mySeq = ++seq;
      timer = setTimeout(() => {
        void opts.parse(source).then((result) => {
          if (!disposed && mySeq === seq) opts.onResult(result, source);
        });
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
