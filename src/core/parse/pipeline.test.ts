import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createParsePipeline } from './pipeline';
import type { ParseResult } from './parseDbml';

const okResult = (tag: string): ParseResult => ({
  ok: true,
  schema: { tables: [], refs: [], enums: [], groups: [], notes: [{ id: tag, name: tag, content: '' }] },
});

describe('createParsePipeline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid pushes into one parse', async () => {
    const parse = vi.fn(async (s: string) => okResult(s));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 300 });
    p.push('a'); p.push('ab'); p.push('abc');
    await vi.advanceTimersByTimeAsync(299);
    expect(parse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith('abc');
    expect(onResult).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it('drops stale results when a newer parse finishes first', async () => {
    const resolvers: Array<(r: ParseResult) => void> = [];
    const parse = vi.fn((s: string) => new Promise<ParseResult>((res) => resolvers.push((r) => res(r ?? okResult(s)))));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });
    p.push('first');
    await vi.advanceTimersByTimeAsync(10);
    p.push('second');
    await vi.advanceTimersByTimeAsync(10);
    expect(parse).toHaveBeenCalledTimes(2);
    resolvers[1](okResult('second')); // newer finishes first
    await vi.runAllTimersAsync();
    resolvers[0](okResult('first')); // stale finishes late
    await vi.runAllTimersAsync();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect((onResult.mock.calls[0][0] as ParseResult & { ok: true }).schema.notes[0].id).toBe('second');
    p.dispose();
  });

  it('delivers nothing after dispose', async () => {
    const parse = vi.fn(async (s: string) => okResult(s));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });
    p.push('a');
    p.dispose();
    await vi.runAllTimersAsync();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('invalidates an in-flight parse when a push arrives during its debounce window (diagram-switch race)', async () => {
    // Regression for: push(A) fires and its parse is in flight; push(B)
    // arrives (e.g. a diagram switch) while still inside B's own debounce
    // window, i.e. before B's timer has fired. A's late result must NOT be
    // delivered — only bumping `seq` when a timer *fires* misses this,
    // because at the moment A resolves, B's timer hasn't fired yet either,
    // so a fire-time-only bump would still equal A's captured sequence.
    const resolvers: Array<(r: ParseResult) => void> = [];
    const parse = vi.fn(
      (s: string) => new Promise<ParseResult>((res) => resolvers.push((r) => res(r ?? okResult(s)))),
    );
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });

    p.push('A');
    await vi.advanceTimersByTimeAsync(10); // A's debounce elapses; parse('A') now in flight
    expect(parse).toHaveBeenCalledTimes(1);

    p.push('B'); // arrives while A is in flight, still inside B's own debounce window
    expect(parse).toHaveBeenCalledTimes(1); // B hasn't fired yet

    resolvers[0](okResult('A')); // A's parse resolves late
    await vi.advanceTimersByTimeAsync(0); // flush A's .then() without letting B's timer fire
    expect(onResult).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10); // B's debounce elapses
    expect(parse).toHaveBeenCalledTimes(2);
    resolvers[1](okResult('B'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect((onResult.mock.calls[0][0] as ParseResult & { ok: true }).schema.notes[0].id).toBe('B');
    p.dispose();
  });

  it('passes the parsed source alongside the result', async () => {
    const parse = vi.fn(async (s: string) => okResult(s));
    const onResult = vi.fn();
    const p = createParsePipeline({ parse, onResult, debounceMs: 10 });
    p.push('abc');
    await vi.advanceTimersByTimeAsync(10);
    await vi.runAllTimersAsync();
    expect(onResult).toHaveBeenCalledWith(okResult('abc'), 'abc');
    p.dispose();
  });
});
