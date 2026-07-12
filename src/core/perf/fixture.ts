/** Deterministic 120-table / 1,200-field / 150-ref DBML fixture — the CI
 *  performance target from spec §6/§10. Pure string generation, no imports:
 *  unit tests validate the shape (and that it parses), and the Playwright
 *  perf spec (e2e/perf.spec.ts) injects it as the parse-to-render payload. */

export const PERF_TABLE_COUNT = 120;
export const PERF_FIELDS_PER_TABLE = 10; // id + c1..c9 → 120 × 10 = 1,200 fields
export const PERF_REF_COUNT = 150; // 119 chain refs + 31 long-range refs

const FILLER_TYPES = ['varchar', 'timestamp', 'boolean', 'text', 'integer'] as const;

export function makePerfFixture(): string {
  const tables: string[] = [];
  for (let t = 1; t <= PERF_TABLE_COUNT; t++) {
    const fields = ['  id integer [pk, increment]'];
    for (let f = 1; f < PERF_FIELDS_PER_TABLE; f++) {
      // c1/c2 are ref sources → integer, matching the integer pk targets;
      // the rest cycle through the filler types for realistic text volume.
      const type = f <= 2 ? 'integer' : FILLER_TYPES[(t + f) % FILLER_TYPES.length];
      fields.push(`  c${f} ${type}`);
    }
    tables.push(`Table t${t} {\n${fields.join('\n')}\n}`);
  }

  const refs: string[] = [];
  for (let t = 2; t <= PERF_TABLE_COUNT; t++) {
    refs.push(`Ref: t${t}.c1 > t${t - 1}.id`); // 119 chain refs
  }
  const longRange = PERF_REF_COUNT - (PERF_TABLE_COUNT - 1); // 31
  for (let i = 1; i <= longRange; i++) {
    refs.push(`Ref: t${i}.c2 > t${i + 60}.id`); // t61..t91 targets, all in range
  }

  return `${tables.join('\n\n')}\n\n${refs.join('\n')}\n`;
}
