import { describe, it, expect } from 'vitest';
import { rewriteTableHeader } from './tableSettings';
import { parseDbml } from '../core/parse/parseDbml';

/** Round-trip guard: whatever we emit must parse under 'dbmlv2' and land the
 *  expected values in OUR normalized schema — the real parser is the oracle,
 *  not string expectations alone. */
function roundTrip(header: string) {
  const r = parseDbml(`${header} {\n  id integer\n}\n`);
  if (!r.ok) throw new Error(`emitted header does not parse: ${header} → ${r.errors[0]?.message}`);
  return r.schema.tables[0];
}

describe('rewriteTableHeader — headerColor', () => {
  it('appends a settings bracket to a bare header', () => {
    const out = rewriteTableHeader('Table users', { headerColor: '#2196f3' });
    expect(out).toBe('Table users [headerColor: #2196f3]');
    expect(roundTrip(out!).headerColor).toBe('#2196f3');
  });

  it('updates an existing headerColor in place', () => {
    const out = rewriteTableHeader('Table users [headerColor: #f44336]', { headerColor: '#4caf50' });
    expect(out).toBe('Table users [headerColor: #4caf50]');
    expect(roundTrip(out!).headerColor).toBe('#4caf50');
  });

  it('tolerates the trailing whitespace sourceMap slices deliver', () => {
    expect(rewriteTableHeader('Table users   ', { headerColor: '#2196f3' }))
      .toBe('Table users [headerColor: #2196f3]');
  });

  it('merges into an existing bracket without touching other settings', () => {
    const out = rewriteTableHeader("Table users [note: 'core, do not drop']", { headerColor: '#ff9800' });
    expect(out).toBe("Table users [note: 'core, do not drop', headerColor: #ff9800]");
    const t = roundTrip(out!);
    expect(t.headerColor).toBe('#ff9800');
    expect(t.note).toBe('core, do not drop');
  });

  it('a quoted note containing "headerColor:" is not a false match', () => {
    const out = rewriteTableHeader("Table users [note: 'headerColor: #000000 is fake']", { headerColor: '#009688' });
    expect(out).toBe("Table users [note: 'headerColor: #000000 is fake', headerColor: #009688]");
    expect(roundTrip(out!).headerColor).toBe('#009688');
  });

  it("handles a ']' inside a quoted setting value (greedy bracket match — not a refusal)", () => {
    const out = rewriteTableHeader("Table users [note: 'a]b']", { headerColor: '#009688' });
    expect(out).toBe("Table users [note: 'a]b', headerColor: #009688]");
    const t = roundTrip(out!);
    expect(t.headerColor).toBe('#009688');
    expect(t.note).toBe('a]b');
  });

  it('removes the setting and drops an emptied bracket', () => {
    expect(rewriteTableHeader('Table users [headerColor: #2196f3]', { headerColor: null }))
      .toBe('Table users');
    expect(rewriteTableHeader('Table users', { headerColor: null })).toBe('Table users'); // nothing to remove
  });

  it('removes only headerColor when other settings remain (either position)', () => {
    expect(rewriteTableHeader("Table users [headerColor: #2196f3, note: 'x']", { headerColor: null }))
      .toBe("Table users [note: 'x']");
    expect(rewriteTableHeader("Table users [note: 'x', headerColor: #2196f3]", { headerColor: null }))
      .toBe("Table users [note: 'x']");
  });

  it('removing a MIDDLE entry leaves clean single-space separators', () => {
    // Synthetic three-entry bracket: pins the whitespace handling (no round-trip).
    expect(
      rewriteTableHeader("Table t [note: 'a', headerColor: #2196f3, note: 'b']", { headerColor: null }),
    ).toBe("Table t [note: 'a', note: 'b']");
  });

  it('rejects a non-#RRGGBB color', () => {
    expect(rewriteTableHeader('Table users', { headerColor: 'red' })).toBeNull();
    expect(rewriteTableHeader('Table users', { headerColor: '#12345' })).toBeNull();
  });
});

describe('rewriteTableHeader — rename', () => {
  it('replaces a bare name', () => {
    const out = rewriteTableHeader('Table users', { name: 'customers' });
    expect(out).toBe('Table customers');
    expect(roundTrip(out!).name).toBe('customers');
  });

  it('quotes a name that needs quoting, and can rename a quoted table', () => {
    expect(rewriteTableHeader('Table users', { name: 'order items' })).toBe('Table "order items"');
    expect(rewriteTableHeader('Table "order items"', { name: 'orders' })).toBe('Table orders');
    expect(roundTrip('Table "order items"').name).toBe('order items');
  });

  it('preserves alias and schema qualifier', () => {
    expect(rewriteTableHeader('Table users as U', { name: 'people' })).toBe('Table people as U');
    const out = rewriteTableHeader('Table auth.users [headerColor: #16a085]', { name: 'accounts' });
    expect(out).toBe('Table auth.accounts [headerColor: #16a085]');
    const t = roundTrip(out!);
    expect(t.schemaName).toBe('auth');
    expect(t.name).toBe('accounts');
  });

  it('applies rename + color in one call', () => {
    const out = rewriteTableHeader('Table users as U', { name: 'people', headerColor: '#e91e63' });
    expect(out).toBe('Table people as U [headerColor: #e91e63]');
    expect(roundTrip(out!).headerColor).toBe('#e91e63');
  });

  it('rejects unsafe names and unrecognized header shapes', () => {
    expect(rewriteTableHeader('Table users', { name: '' })).toBeNull();
    expect(rewriteTableHeader('Table users', { name: '  ' })).toBeNull();
    expect(rewriteTableHeader('Table users', { name: 'a"b' })).toBeNull();
    expect(rewriteTableHeader('Table users /* huh */', { name: 'x' })).toBeNull();
  });
});
