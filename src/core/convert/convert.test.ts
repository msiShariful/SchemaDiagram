import { describe, it, expect } from 'vitest';
import { importSql, exportSql } from './convert';
import { parseDbml } from '../parse/parseDbml';

const DBML = `Table users {
  id integer [pk]
  email varchar [not null]
}

Table posts {
  id integer [pk]
  user_id integer
}

Ref: posts.user_id > users.id
`;

describe('exportSql', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle'] as const)('emits CREATE TABLE DDL for %s', async (d) => {
    const r = await exportSql(DBML, d);
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.text).toContain('CREATE TABLE');
    expect(r.text).toContain('users');
    expect(r.text).toContain('posts');
  });

  it('handles single-line DBML (dbmlv2 grammar, not the legacy peg parser)', async () => {
    const r = await exportSql('Table a { id int }', 'postgres');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.text).toContain('CREATE TABLE');
  });

  it('reports errors with line info for broken DBML, without throwing', async () => {
    const r = await exportSql('Table broken {', 'postgres');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message.length).toBeGreaterThan(0);
    expect(r.errors[0].line).toBeGreaterThanOrEqual(1);
  });
});

describe('importSql', () => {
  it('converts postgres DDL to DBML', async () => {
    const sql =
      'CREATE TABLE users (id integer PRIMARY KEY, email varchar(255) NOT NULL UNIQUE);';
    const r = await importSql(sql, 'postgres');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    expect(r.text).toContain('Table "users"');
    expect(r.text).toContain('[pk]');
  });

  it('round-trips DBML → SQL → DBML per dialect', async () => {
    for (const d of ['postgres', 'mysql', 'mssql'] as const) {
      const sql = await exportSql(DBML, d);
      if (!sql.ok) throw new Error(`export ${d} failed: ${sql.errors[0]?.message}`);
      const back = await importSql(sql.text, d);
      if (!back.ok) throw new Error(`import ${d} failed: ${back.errors[0]?.message}`);
      const parsed = parseDbml(back.text);
      if (!parsed.ok) throw new Error(`re-parse ${d} failed: ${parsed.errors[0]?.message}`);
      expect(parsed.schema.tables.map((t) => t.name).sort()).toEqual(['posts', 'users']);
      expect(parsed.schema.refs).toHaveLength(1);
    }
  });

  it('fails with the importer message on invalid SQL, current state untouched semantics', async () => {
    const r = await importSql('NOT VALID SQL AT ALL;', 'postgres');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/mismatched|extraneous|expecting/i);
    expect(r.errors[0].line).toBe(1);
  });

  it('converts oracle DDL to DBML that our dbmlv2 pipeline re-parses', async () => {
    const sql = 'CREATE TABLE refunds (id NUMBER PRIMARY KEY, amount NUMBER(10,2) NOT NULL);';
    const r = await importSql(sql, 'oracle');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const parsed = parseDbml(r.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schema.tables[0].name).toBe('refunds');
    expect(parsed.schema.tables[0].fields.map((f) => f.name)).toEqual(['id', 'amount']);
  });

  it('converts snowflake DDL to DBML that our dbmlv2 pipeline re-parses (import-only dialect)', async () => {
    const sql = 'CREATE TABLE settlements (id NUMBER PRIMARY KEY, gross NUMBER(12,2) NOT NULL);';
    const r = await importSql(sql, 'snowflake');
    if (!r.ok) throw new Error(r.errors[0]?.message);
    const parsed = parseDbml(r.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schema.tables[0].name).toBe('settlements');
    expect(parsed.schema.tables[0].fields.map((f) => f.name)).toEqual(['id', 'gross']);
  });
});
