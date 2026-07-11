import { describe, it, expect } from 'vitest';
import { serializeProject, parseProject, PROJECT_FILE_VERSION } from './projectFile';

const input = {
  name: 'Shop',
  dbml: 'Table a { id int }',
  positions: { 'public.a': { x: 10, y: 20 } },
  viewport: { x: 1, y: 2, zoom: 0.75 },
};

describe('serializeProject / parseProject', () => {
  it('round-trips through JSON', () => {
    const r = parseProject(serializeProject(input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual({
      version: PROJECT_FILE_VERSION,
      name: 'Shop',
      dbml: 'Table a { id int }',
      layout: { 'public.a': { x: 10, y: 20 } },
      viewport: { x: 1, y: 2, zoom: 0.75 },
    });
  });

  it('strips unknown keys instead of carrying them along', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.evil = 'payload';
    (raw.layout as Record<string, unknown>)['public.a'] = { x: 10, y: 20, extra: true };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('evil' in r.project).toBe(false);
    expect(r.project.layout['public.a']).toEqual({ x: 10, y: 20 });
  });

  it('rejects non-JSON', () => {
    const r = parseProject('not json {');
    expect(r).toEqual({ ok: false, error: 'Not valid JSON.' });
  });

  it('rejects non-objects', () => {
    expect(parseProject('42').ok).toBe(false);
    expect(parseProject('null').ok).toBe(false);
  });

  it('rejects wrong versions with a readable message', () => {
    const r = parseProject(JSON.stringify({ ...JSON.parse(serializeProject(input)), version: 9 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('version');
    expect(r.error).toContain('9');
  });

  it('rejects missing name/dbml', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    delete raw.dbml;
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('dbml');
  });

  it('rejects malformed layout entries, naming the offender', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.layout = { 'public.a': { x: 'ten', y: 20 } };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('public.a');
  });

  it('rejects a bad viewport (non-numeric or non-positive zoom)', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.viewport = { x: 0, y: 0, zoom: 0 };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('viewport');
  });
});
