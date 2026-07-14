import { describe, it, expect } from 'vitest';
import { STARTER_DBML, SAMPLE_DBML, createStarterDiagram } from './starter';
import { parseDbml } from '../core/parse/parseDbml';

describe('starter content', () => {
  it('starter DBML parses cleanly with tables, refs, and enums', () => {
    const r = parseDbml(STARTER_DBML);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.schema.tables.length).toBeGreaterThanOrEqual(3);
    expect(r.schema.refs.length).toBeGreaterThanOrEqual(3);
    expect(r.schema.enums.length).toBeGreaterThanOrEqual(1);
  });
  it('creates unique diagram records', () => {
    const a = createStarterDiagram();
    const b = createStarterDiagram();
    expect(a.id).not.toBe(b.id);
    expect(a.dbml).toBe(STARTER_DBML);
    expect(a.name).toBe('Untitled');
  });
  it('stamps createdAt on new starter diagrams', () => {
    const before = Date.now();
    const a = createStarterDiagram();
    expect(a.createdAt).toBeGreaterThanOrEqual(before);
    expect(a.createdAt).toBe(a.updatedAt);
  });
  it('SAMPLE_DBML parses clean with the real pipeline and carries the full feature surface', () => {
    const r = parseDbml(SAMPLE_DBML);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const s = r.schema;
    expect(s.tables).toHaveLength(8);
    expect(s.refs).toHaveLength(8);
    expect(s.enums).toHaveLength(3);
    expect(s.groups).toHaveLength(3);
    expect(s.notes).toHaveLength(1);
    expect(s.tables.every((t) => t.headerColor !== null)).toBe(true);
    expect(s.refs.some((x) => x.from.fieldNames.length === 2)).toBe(true); // composite
    expect(s.refs.some((x) => x.inline)).toBe(true); // categories self-ref (inline)
    expect(s.refs.some((x) => x.from.relation === '1' && x.to.relation === '1')).toBe(true); // one-to-one
  });
});
