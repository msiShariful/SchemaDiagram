import { describe, it, expect } from 'vitest';
import { makePerfFixture, PERF_TABLE_COUNT, PERF_FIELDS_PER_TABLE, PERF_REF_COUNT } from './fixture';
import { parseDbml } from '../parse/parseDbml';

describe('makePerfFixture', () => {
  const dbml = makePerfFixture();

  it('parses cleanly and matches the spec §6 shape: 120 tables / 1200 fields / 150 refs', () => {
    const r = parseDbml(dbml);
    if (!r.ok) throw new Error(`fixture does not parse: ${r.errors[0]?.message}`);
    expect(r.schema.tables).toHaveLength(PERF_TABLE_COUNT);
    expect(r.schema.tables.reduce((n, t) => n + t.fields.length, 0)).toBe(
      PERF_TABLE_COUNT * PERF_FIELDS_PER_TABLE,
    );
    expect(r.schema.refs).toHaveLength(PERF_REF_COUNT);
  });

  it('is deterministic (same string every call — stable perf baselines)', () => {
    expect(makePerfFixture()).toBe(dbml);
  });
});
