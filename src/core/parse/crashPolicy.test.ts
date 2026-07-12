import { describe, it, expect } from 'vitest';
import { decideOnCrash, INITIAL_CRASH_LEDGER } from './crashPolicy';

const SRC_A = 'Table a { id int }';
const SRC_B = 'Table b { id int }';

describe('decideOnCrash (spec §9: restart once, report on 2nd identical crash)', () => {
  it('first crash on a source → restart, remembering that source', () => {
    const d = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    expect(d.action).toBe('restart');
    expect(d.ledger.lastCrashedSource).toBe(SRC_A);
  });

  it('second consecutive crash on the identical source → report, no retry loop', () => {
    const first = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    const second = decideOnCrash(first.ledger, SRC_A);
    expect(second.action).toBe('report');
  });

  it('crash on a DIFFERENT source after a crash → restart again', () => {
    const first = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    const second = decideOnCrash(first.ledger, SRC_B);
    expect(second.action).toBe('restart');
    expect(second.ledger.lastCrashedSource).toBe(SRC_B);
  });

  it('report keeps the poisoned source, so a re-push of the same text reports again', () => {
    const first = decideOnCrash(INITIAL_CRASH_LEDGER, SRC_A);
    const second = decideOnCrash(first.ledger, SRC_A);
    const third = decideOnCrash(second.ledger, SRC_A);
    expect(third.action).toBe('report');
  });

  it('a crash with nothing in flight → restart, and the ledger clears', () => {
    const d = decideOnCrash({ lastCrashedSource: SRC_A }, null);
    expect(d.action).toBe('restart');
    expect(d.ledger.lastCrashedSource).toBeNull();
  });
});
