import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkerParse, PARSER_UNAVAILABLE_MESSAGE } from './workerParse';
import type { ParseResult } from './parseDbml';

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

type WorkerRequest = { id: number; source: string };
type WorkerResponse = { id: number; result: ParseResult };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: WorkerRequest[] = [];
  terminateCount = 0;
  throwOnPost = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: WorkerRequest): void {
    if (this.throwOnPost) throw new Error('postMessage failed');
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

describe('createWorkerParse (worker path, fake Worker)', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const spawn = () => {
    const adapter = createWorkerParse();
    const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
    return { adapter, instance };
  };

  it('happy path: posts to the worker and resolves with the worker-provided result', async () => {
    const { adapter, instance } = spawn();
    const promise = adapter.parse('Table a { id int }');
    expect(instance.posted).toEqual([{ id: 0, source: 'Table a { id int }' }]);

    const workerResult: ParseResult = {
      ok: true,
      schema: {
        tables: [],
        refs: [],
        enums: [],
        groups: [],
        notes: [{ id: 'from-worker', name: 'from-worker', content: '' }],
      },
    };
    instance.onmessage?.({ data: { id: 0, result: workerResult } });

    await expect(promise).resolves.toBe(workerResult);
    expect(instance.terminateCount).toBe(0);
  });

  it('onerror settles all pending promises in-thread and later calls skip postMessage', async () => {
    const { adapter, instance } = spawn();
    const p1 = adapter.parse('Table a { id int }');
    const p2 = adapter.parse('Table b { id int }');
    expect(instance.posted).toHaveLength(2);

    instance.onerror?.();

    await expect(p1).resolves.toMatchObject({ ok: true });
    await expect(p2).resolves.toMatchObject({ ok: true });
    expect(instance.terminateCount).toBe(1);

    // Adapter is now dead: subsequent calls resolve in-thread without touching the worker.
    await expect(adapter.parse('Table c { id int }')).resolves.toMatchObject({ ok: true });
    expect(instance.posted).toHaveLength(2);
  });

  it('postMessage throwing settles that call via fallback and marks the adapter dead', async () => {
    const { adapter, instance } = spawn();
    instance.throwOnPost = true;

    await expect(adapter.parse('Table a { id int }')).resolves.toMatchObject({ ok: true });
    expect(instance.terminateCount).toBe(1);

    // Even with a now-working postMessage, the dead adapter never posts again.
    instance.throwOnPost = false;
    await expect(adapter.parse('Table b { id int }')).resolves.toMatchObject({ ok: true });
    expect(instance.posted).toHaveLength(0);
  });

  it('dispose() with a request in flight settles it and terminates exactly once', async () => {
    const { adapter, instance } = spawn();
    const inFlight = adapter.parse('Table a { id int }');
    expect(instance.posted).toHaveLength(1);

    adapter.dispose();

    await expect(inFlight).resolves.toMatchObject({ ok: true });
    expect(instance.terminateCount).toBe(1);
  });

  it('shutdown is idempotent: double dispose / dispose after onerror terminate at most once', () => {
    const first = spawn();
    first.adapter.dispose();
    first.adapter.dispose();
    expect(first.instance.terminateCount).toBe(1);

    const second = spawn();
    second.instance.onerror?.();
    second.adapter.dispose();
    expect(second.instance.terminateCount).toBe(1);
  });
});

describe('createWorkerParse (lazy parser chunk fails to load)', () => {
  // Simulates the deployed-hash-rotated / offline case: import('./parseDbml')
  // rejects. Every fallback path must settle as {ok:false, parser unavailable}
  // — never an unhandled rejection, never a promise pending forever.
  const failingLoader = () => Promise.reject(new Error('chunk load failed'));
  const unavailable = {
    ok: false,
    errors: [{ message: PARSER_UNAVAILABLE_MESSAGE, line: 1, column: 1 }],
  };

  it('no-Worker fallback resolves {ok:false, parser unavailable} instead of rejecting', async () => {
    const adapter = createWorkerParse(failingLoader); // node: no Worker global
    await expect(adapter.parse('Table a { id int }')).resolves.toEqual(unavailable);
  });

  it('dispose() with requests in flight settles them as parser-unavailable', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const adapter = createWorkerParse(failingLoader);
      const inFlight = adapter.parse('Table a { id int }');
      adapter.dispose();
      await expect(inFlight).resolves.toEqual(unavailable);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('postMessage failure with a broken loader still resolves {ok:false}', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const adapter = createWorkerParse(failingLoader);
      const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
      instance.throwOnPost = true;
      await expect(adapter.parse('Table a { id int }')).resolves.toEqual(unavailable);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
