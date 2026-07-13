import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkerParse, PARSER_UNAVAILABLE_MESSAGE, WORKER_CRASHED_MESSAGE } from './workerParse';
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
  // Set before a spawn you expect to happen next (e.g. right before the crash
  // that triggers a restart) — read once by the constructor, then cleared.
  static throwOnNthPostForNext: number | null = null;
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: WorkerRequest[] = [];
  terminateCount = 0;
  throwOnPost = false;
  throwOnNthPost: number | null = null; // 1-indexed postMessage call to throw on

  constructor() {
    this.throwOnNthPost = FakeWorker.throwOnNthPostForNext;
    FakeWorker.throwOnNthPostForNext = null;
    FakeWorker.instances.push(this);
  }

  postMessage(msg: WorkerRequest): void {
    if (this.throwOnPost) throw new Error('postMessage failed');
    if (this.throwOnNthPost === this.posted.length + 1) throw new Error('postMessage failed on nth call');
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

  const okResult: ParseResult = {
    ok: true,
    schema: { tables: [], refs: [], enums: [], groups: [], notes: [] },
  };

  it('happy path: posts to the worker and resolves with the worker-provided result', async () => {
    const { adapter, instance } = spawn();
    const promise = adapter.parse('Table a { id int }');
    expect(instance.posted).toEqual([{ id: 0, source: 'Table a { id int }' }]);
    instance.onmessage?.({ data: { id: 0, result: okResult } });
    await expect(promise).resolves.toBe(okResult);
    expect(instance.terminateCount).toBe(0);
  });

  it('a crash restarts the worker and re-parses the in-flight source once (spec §9)', async () => {
    const { adapter, instance } = spawn();
    const p = adapter.parse('Table a { id int }');
    instance.onerror?.(); // crash #1
    expect(instance.terminateCount).toBe(1);
    expect(FakeWorker.instances).toHaveLength(2); // restarted
    const second = FakeWorker.instances[1];
    expect(second.posted).toEqual([{ id: 1, source: 'Table a { id int }' }]); // re-posted
    second.onmessage?.({ data: { id: 1, result: okResult } });
    await expect(p).resolves.toBe(okResult);
  });

  it('a postMessage throw partway through the restart re-post loop settles every entry instead of hanging one', async () => {
    // Three entries pending when the worker crashes. The fresh worker throws
    // on its 2nd postMessage (the re-post of entry #2), which shuts the
    // adapter down mid-loop. Without the dead-guard, entry #3 would still be
    // posted to that now-terminated worker and never resolve.
    const { adapter, instance } = spawn();
    const p1 = adapter.parse('Table a { id int }');
    const p2 = adapter.parse('Table b { id int }');
    const p3 = adapter.parse('Table c { id int }');
    FakeWorker.throwOnNthPostForNext = 2;
    instance.onerror?.(); // crash: restart re-posts all three entries on the fresh worker
    const w2 = FakeWorker.instances[FakeWorker.instances.length - 1];
    expect(w2.posted).toHaveLength(1); // only the 1st re-post reached postMessage before the throw
    expect(w2.terminateCount).toBe(1); // the throw shut the fresh worker down too
    await expect(p1).resolves.toMatchObject({ ok: true });
    await expect(p2).resolves.toMatchObject({ ok: true });
    await expect(p3).resolves.toMatchObject({ ok: true }); // the entry the bug would have stranded
  });

  it('two consecutive crashes on identical input resolve with the inline crash error, nothing auto-retried', async () => {
    const { adapter, instance } = spawn();
    const p = adapter.parse('Table a { id int }');
    instance.onerror?.(); // crash #1 → restart + re-post
    FakeWorker.instances[1].onerror?.(); // crash #2, same source → report
    const r = await p;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toBe(WORKER_CRASHED_MESSAGE);
    // a THIRD worker exists to serve future (different) input,
    // but the crashed source was NOT auto re-posted — no retry loop.
    expect(FakeWorker.instances).toHaveLength(3);
    expect(FakeWorker.instances[2].posted).toHaveLength(0);
    // future parses go to the fresh worker
    const p2 = adapter.parse('Table b { id int }');
    expect(FakeWorker.instances[2].posted).toEqual([{ id: 2, source: 'Table b { id int }' }]);
    FakeWorker.instances[2].onmessage?.({ data: { id: 2, result: okResult } });
    await expect(p2).resolves.toBe(okResult);
  });

  it('a successful response breaks the crash chain: the same source crashing later restarts again', async () => {
    const { adapter, instance } = spawn();
    const p1 = adapter.parse('Table a { id int }');
    instance.onerror?.(); // crash #1 → restart, re-post as id 1
    const w2 = FakeWorker.instances[1];
    w2.onmessage?.({ data: { id: 1, result: okResult } }); // success resets the ledger
    await p1;
    const p2 = adapter.parse('Table a { id int }'); // id 2, same text as the old crash
    w2.onerror?.(); // crash again — but the chain was broken
    const w3 = FakeWorker.instances[2];
    expect(w3.posted).toEqual([{ id: 3, source: 'Table a { id int }' }]); // restart, not report
    w3.onmessage?.({ data: { id: 3, result: okResult } });
    await expect(p2).resolves.toBe(okResult);
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

  it('shutdown is idempotent: double dispose terminates the live worker at most once', () => {
    const first = spawn();
    first.adapter.dispose();
    first.adapter.dispose();
    expect(first.instance.terminateCount).toBe(1);

    // crash → the FIRST worker is terminated by the restart; dispose then
    // terminates the SECOND. Neither is ever terminated twice.
    const second = spawn();
    second.instance.onerror?.();
    second.adapter.dispose();
    expect(second.instance.terminateCount).toBe(1);
    expect(FakeWorker.instances[FakeWorker.instances.length - 1].terminateCount).toBe(1);
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
