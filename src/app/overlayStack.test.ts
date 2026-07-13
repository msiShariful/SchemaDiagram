import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushOverlay, overlayDepth, handleEscape } from './overlayStack';

// The stack is MODULE state — every test must drain what it pushed or the
// next test starts dirty (order-dependence). All pushes go through `push`,
// which records the disposer; beforeEach drains leftovers BEFORE stubbing a
// fresh window, so drain-time removeEventListener calls hit the OLD stub and
// each test's listener counts stay isolated.
const disposers: Array<() => void> = [];
const push = (close: () => void) => {
  const d = pushOverlay(close);
  disposers.push(d);
  return d;
};

beforeEach(() => {
  while (disposers.length > 0) disposers.pop()!();
  // node env: stub just enough window for the listener add/remove calls.
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe('overlayStack', () => {
  it('escape closes the TOPMOST overlay only, in LIFO order', () => {
    const closed: string[] = [];
    const a = push(() => { closed.push('a'); a(); });
    const b = push(() => { closed.push('b'); b(); });
    expect(overlayDepth()).toBe(2);
    expect(handleEscape()).toBe(true);
    expect(closed).toEqual(['b']); // a untouched
    expect(overlayDepth()).toBe(1);
    expect(handleEscape()).toBe(true);
    expect(closed).toEqual(['b', 'a']);
    expect(overlayDepth()).toBe(0);
    expect(handleEscape()).toBe(false); // empty stack: not handled (canvas last-resort may act)
  });

  it('dispose is idempotent and removes from the middle without disturbing order', () => {
    const closed: string[] = [];
    const a = push(() => { closed.push('a'); });
    const b = push(() => { closed.push('b'); });
    push(() => { closed.push('c'); }); // c stays undisposed — beforeEach drains it
    b();
    b(); // idempotent
    expect(overlayDepth()).toBe(2);
    handleEscape();
    expect(closed).toEqual(['c']); // c was topmost; b is gone, a still below
    a();
    expect(overlayDepth()).toBe(1);
  });

  it('attaches the window listener on first push and detaches on last dispose', () => {
    expect(overlayDepth()).toBe(0); // hermetic start — the drain guarantees it
    const w = window as unknown as { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
    const a = push(() => {});
    const b = push(() => {});
    expect(w.addEventListener).toHaveBeenCalledTimes(1);
    a();
    expect(w.removeEventListener).not.toHaveBeenCalled();
    b();
    expect(w.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
