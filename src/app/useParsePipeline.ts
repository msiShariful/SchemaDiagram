import { useEffect } from 'react';
import { useAppStore } from './store';
import { createParsePipeline } from '../core/parse/pipeline';
import { createWorkerParse } from '../core/parse/workerParse';

type StoreState = ReturnType<typeof useAppStore.getState>;

// Key off [diagramId, source] rather than source alone: loadDiagram (diagram
// switch/new/duplicate) can set a source that is byte-identical to the one
// already in state (e.g. duplicateDiagram copies the current text verbatim).
// A source-only selector would then see no change and never re-parse, leaving
// the canvas stuck on the EMPTY_SCHEMA that loadDiagram resets to.
// Exported so parseResubscribe.test.ts guards this exact subscription key.
export const parseKeySelector = (s: StoreState) => [s.diagramId, s.source] as const;
export const parseKeyEquals = (
  a: readonly [string | null, string],
  b: readonly [string | null, string],
): boolean => a.every((v, i) => Object.is(v, b[i]));

export function useParsePipeline(): void {
  useEffect(() => {
    const adapter = createWorkerParse();
    const pipeline = createParsePipeline({
      parse: adapter.parse,
      onResult: (r) => useAppStore.getState().applyParse(r),
      debounceMs: 300,
    });
    pipeline.push(useAppStore.getState().source);
    const unsub = useAppStore.subscribe(
      parseKeySelector,
      ([, source]) => pipeline.push(source),
      { equalityFn: parseKeyEquals },
    );
    return () => {
      unsub();
      pipeline.dispose();
      adapter.dispose();
    };
  }, []);
}
