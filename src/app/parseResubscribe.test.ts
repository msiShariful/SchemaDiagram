import { describe, it, expect } from 'vitest';
import { useAppStore, type DiagramRecord } from './store';
import { parseKeySelector, parseKeyEquals } from './useParsePipeline';

// Regression guard for the parse-pipeline subscription key.
// duplicateDiagram loads a record whose dbml text is byte-identical to the
// current source; a source-only subscription would not fire, leaving the
// canvas stuck on the EMPTY_SCHEMA that loadDiagram resets to. The pipeline
// must therefore key off [diagramId, source] (parseKeySelector).

const rec = (id: string): DiagramRecord => ({
  id,
  name: 'n',
  dbml: 'Table a { id int }',
  positions: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  updatedAt: 1,
});

describe('parse pipeline subscription key', () => {
  it('fires when a duplicate with identical dbml but a new id is loaded', () => {
    useAppStore.getState().loadDiagram(rec('orig'));
    let calls = 0;
    const unsub = useAppStore.subscribe(
      parseKeySelector,
      () => { calls += 1; },
      { equalityFn: parseKeyEquals },
    );
    useAppStore.getState().loadDiagram(rec('copy')); // same dbml text, new id
    expect(calls).toBe(1);
    unsub();
  });

  it('does not fire on unrelated state changes', () => {
    useAppStore.getState().loadDiagram(rec('base'));
    let calls = 0;
    const unsub = useAppStore.subscribe(
      parseKeySelector,
      () => { calls += 1; },
      { equalityFn: parseKeyEquals },
    );
    useAppStore.getState().setHoveredTable('public.a');
    useAppStore.getState().setStorageUnavailable(true);
    expect(calls).toBe(0);
    unsub();
  });
});
