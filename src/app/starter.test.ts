import { describe, it, expect } from 'vitest';
import { STARTER_DBML, createStarterDiagram } from './starter';
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
});
