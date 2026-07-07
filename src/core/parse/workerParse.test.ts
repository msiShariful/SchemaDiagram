import { describe, it, expect } from 'vitest';
import { createWorkerParse } from './workerParse';

describe('createWorkerParse (fallback path, no Worker global)', () => {
  it('parses in-thread when Worker is unavailable', async () => {
    const adapter = createWorkerParse();
    const result = await adapter.parse('Table a { id int }');
    expect(result.ok).toBe(true);
  });

  it('dispose() is safe to call and does not throw', () => {
    const adapter = createWorkerParse();
    expect(() => adapter.dispose()).not.toThrow();
  });

  it('still parses after dispose() in fallback mode (dispose only affects a real worker)', async () => {
    const adapter = createWorkerParse();
    adapter.dispose();
    const result = await adapter.parse('Table a { id int }');
    expect(result.ok).toBe(true);
  });
});
