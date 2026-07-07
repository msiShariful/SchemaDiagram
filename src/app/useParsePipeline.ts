import { useEffect } from 'react';
import { useAppStore } from './store';
import { createParsePipeline } from '../core/parse/pipeline';
import { createWorkerParse } from '../core/parse/workerParse';

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
      (s) => s.source,
      (source) => pipeline.push(source),
    );
    return () => {
      unsub();
      pipeline.dispose();
      adapter.dispose();
    };
  }, []);
}
