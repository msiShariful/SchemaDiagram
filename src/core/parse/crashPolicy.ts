/** Worker crash policy (spec §9): a crashed parse worker is restarted and
 *  the in-flight source re-parsed ONCE; two consecutive crashes on identical
 *  input produce an inline error report instead of a retry loop. Pure — the
 *  adapter (workerParse.ts) owns timing and wiring, this module owns only
 *  the decision, so it is testable without a Worker or a DOM. */

export interface CrashLedger {
  /** Source text in flight at the previous crash; null after any success
   *  ("consecutive" means no successful parse in between). */
  lastCrashedSource: string | null;
}

export const INITIAL_CRASH_LEDGER: CrashLedger = { lastCrashedSource: null };

export type CrashDecision =
  | { action: 'restart'; ledger: CrashLedger }
  | { action: 'report'; ledger: CrashLedger };

/** `newestSource` is the most recent source in flight at crash time (null
 *  when the worker died with nothing pending). Report is only ever chosen
 *  for a repeat of the exact text that just crashed — a different edit
 *  always earns a fresh restart. The ledger keeps the poisoned source after
 *  a report, so an identical re-push that crashes again reports again
 *  (each user retry costs one bounded restart, never an automatic loop). */
export function decideOnCrash(ledger: CrashLedger, newestSource: string | null): CrashDecision {
  if (newestSource !== null && ledger.lastCrashedSource === newestSource) {
    return { action: 'report', ledger };
  }
  return { action: 'restart', ledger: { lastCrashedSource: newestSource } };
}
