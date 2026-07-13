import { describe, it, expect } from 'vitest';
import { reconcilePositions } from './reconcile';
import type { Schema, Table } from './types';

const mkTable = (name: string, fieldNames: string[]): Table => ({
  id: `public.${name}`, schemaName: 'public', name, alias: null, headerColor: null, note: null,
  fields: fieldNames.map((n) => ({
    name: n, type: 'int', pk: false, unique: false, notNull: false,
    increment: false, defaultValue: null, note: null, isEnum: false,
  })),
});
const mkSchema = (tables: Table[]): Schema => ({ tables, refs: [], enums: [], groups: [], notes: [] });

describe('reconcilePositions', () => {
  it('keeps positions of surviving tables and prunes deleted ones', () => {
    const prev = mkSchema([mkTable('a', ['id']), mkTable('b', ['id'])]);
    const next = mkSchema([mkTable('a', ['id'])]);
    const out = reconcilePositions(prev, next, { 'public.a': { x: 1, y: 2 }, 'public.b': { x: 3, y: 4 } });
    expect(out).toEqual({ 'public.a': { x: 1, y: 2 } });
  });

  it('transfers position across a rename (same field signature)', () => {
    const prev = mkSchema([mkTable('users', ['id', 'email'])]);
    const next = mkSchema([mkTable('members', ['id', 'email'])]);
    const out = reconcilePositions(prev, next, { 'public.users': { x: 100, y: 50 } });
    expect(out['public.members']).toEqual({ x: 100, y: 50 });
    expect(out['public.users']).toBeUndefined();
  });

  it('does not transfer when signatures differ', () => {
    const prev = mkSchema([mkTable('users', ['id', 'email'])]);
    const next = mkSchema([mkTable('members', ['id', 'name'])]);
    const out = reconcilePositions(prev, next, { 'public.users': { x: 100, y: 50 } });
    expect(out['public.members']).toBeUndefined();
  });

  it('transfers at most once per removed table', () => {
    const prev = mkSchema([mkTable('users', ['id'])]);
    const next = mkSchema([mkTable('members', ['id']), mkTable('people', ['id'])]);
    const out = reconcilePositions(prev, next, { 'public.users': { x: 9, y: 9 } });
    const transferred = ['public.members', 'public.people'].filter((id) => out[id]);
    expect(transferred).toHaveLength(1);
  });

  it('does not throw on a corrupted table with fields: undefined, and its signature stays stable', () => {
    // A corrupted table object (e.g. a bad parse or manual store mutation)
    // must not throw uncaught outside the error boundary — signature() guards
    // with `?? []`, treating missing fields as an empty field set.
    const corrupted = { ...mkTable('a', []), fields: undefined } as unknown as Table;
    const prev = mkSchema([corrupted]);
    const next = mkSchema([mkTable('empty', [])]); // same (empty) signature as the corrupted table
    const positions = { 'public.a': { x: 1, y: 2 } };
    expect(() => reconcilePositions(prev, next, positions)).not.toThrow();
    const out1 = reconcilePositions(prev, next, positions);
    const out2 = reconcilePositions(prev, next, positions);
    expect(out1).toEqual(out2); // stable signature: repeat calls agree
    expect(out1['public.empty']).toEqual({ x: 1, y: 2 }); // treated as empty-fields signature, so it still transfers
  });
});
