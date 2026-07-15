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

  it('rejects a "__proto__" layout key instead of hijacking the prototype', () => {
    const r = parseProject(
      '{"version":1,"name":"Shop","dbml":"Table a { id int }","layout":{"__proto__":{"x":111,"y":222},"public.a":{"x":1,"y":2}},"viewport":{"x":0,"y":0,"zoom":1}}',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('not allowed');
    // pin the no-global-pollution property
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('round-trips notePositions when provided', () => {
    const r = parseProject(serializeProject({ ...input, notePositions: { note1: { x: 5, y: 6 } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.notePositions).toEqual({ note1: { x: 5, y: 6 } });
  });

  it('leaves notePositions absent (and still valid) when not provided', () => {
    const r = parseProject(serializeProject(input)); // input has no notePositions
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.version).toBe(PROJECT_FILE_VERSION);
    expect('notePositions' in r.project).toBe(false);
  });

  it('rejects a "__proto__" notePositions key instead of hijacking the prototype', () => {
    const r = parseProject(
      '{"version":1,"name":"Shop","dbml":"Table a { id int }","layout":{},"notePositions":{"__proto__":{"x":1,"y":2}},"viewport":{"x":0,"y":0,"zoom":1}}',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('not allowed');
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('rejects malformed notePositions entries, naming the offender', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.notePositions = { note1: { x: 'nope', y: 1 } };
    const r = parseProject(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('note1');
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

describe('hiddenTableIds (Plan 6, optional — backward compatible)', () => {
  it('round-trips hiddenTableIds and accepts files without them', () => {
    const r = parseProject(serializeProject({ ...input, hiddenTableIds: ['public.a'] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.hiddenTableIds).toEqual(['public.a']);

    const old = parseProject(serializeProject(input)); // pre-Plan-6 shape: no key at all
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect('hiddenTableIds' in old.project).toBe(false);
  });

  it('omits the key when nothing is hidden (files stay byte-stable for old consumers)', () => {
    expect(serializeProject({ ...input, hiddenTableIds: [] })).not.toContain('hiddenTableIds');
  });

  it('rejects malformed hiddenTableIds (non-array, non-string entries)', () => {
    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.hiddenTableIds = { 'public.a': true };
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
    raw.hiddenTableIds = ['public.a', 7];
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
  });
});

describe('collapsedGroupIds (Plan 7, optional — backward compatible)', () => {
  it('round-trips, omits when empty, and rejects malformed values', () => {
    const r = parseProject(serializeProject({ ...input, collapsedGroupIds: ['public.g1'] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.collapsedGroupIds).toEqual(['public.g1']);

    expect(serializeProject({ ...input, collapsedGroupIds: [] })).not.toContain('collapsedGroupIds');
    const old = parseProject(serializeProject(input));
    expect(old.ok && !('collapsedGroupIds' in old.project)).toBe(true);

    const raw = JSON.parse(serializeProject(input)) as Record<string, unknown>;
    raw.collapsedGroupIds = 'public.g1';
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
    raw.collapsedGroupIds = ['public.g1', 7];
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false);
  });
});

describe('noteColors (optional — backward compatible)', () => {
  it('round-trips, omits when empty, and rejects malformed values', () => {
    const base = { name: 'n', dbml: 'Table t { id int }', positions: {}, viewport: { x: 0, y: 0, zoom: 1 } };
    const out = serializeProject({ ...base, noteColors: { memo: '#cfe5ff' } });
    const r = parseProject(out);
    if (!r.ok) throw new Error(r.error);
    expect(r.project.noteColors).toEqual({ memo: '#cfe5ff' });
    // empty map omitted from the file
    expect(JSON.parse(serializeProject({ ...base, noteColors: {} }))).not.toHaveProperty('noteColors');
    // absent stays valid (older files)
    const legacy = parseProject(serializeProject(base));
    if (!legacy.ok) throw new Error(legacy.error);
    expect(legacy.project.noteColors).toBeUndefined();
    // trust boundary: non-hex values rejected
    const bad = JSON.parse(out);
    bad.noteColors = { memo: 'javascript:alert(1)' };
    expect(parseProject(JSON.stringify(bad)).ok).toBe(false);
    const badType = JSON.parse(out);
    badType.noteColors = ['#cfe5ff'];
    expect(parseProject(JSON.stringify(badType)).ok).toBe(false);
  });
});

describe('noteSizes (optional — backward compatible)', () => {
  it('round-trips, omits when empty, and rejects malformed values', () => {
    const base = { name: 'n', dbml: 'Table t { id int }', positions: {}, viewport: { x: 0, y: 0, zoom: 1 } };
    const out = serializeProject({ ...base, noteSizes: { memo: { w: 260, h: 180 } } });
    const r = parseProject(out);
    if (!r.ok) throw new Error(r.error);
    expect(r.project.noteSizes).toEqual({ memo: { w: 260, h: 180 } });
    expect(JSON.parse(serializeProject({ ...base, noteSizes: {} }))).not.toHaveProperty('noteSizes');
    const bad = JSON.parse(out);
    bad.noteSizes = { memo: { w: -5, h: 100 } };
    expect(parseProject(JSON.stringify(bad)).ok).toBe(false);
    const bad2 = JSON.parse(out);
    bad2.noteSizes = { memo: { w: 'wide', h: 100 } };
    expect(parseProject(JSON.stringify(bad2)).ok).toBe(false);
  });
});
