import { describe, it, expect } from 'vitest';
import type { Field } from '../core/model/types';
import { fieldBadges, fieldTooltip, fitFieldRow, fitTableTitle } from './fieldMeta';

const base: Field = {
  name: 'f', type: 'int', pk: false, unique: false, notNull: false,
  increment: false, defaultValue: null, note: null, isEnum: false, enumValues: null,
};

describe('fieldBadges', () => {
  it('emits compact badges in NN U ++ order, empty when unconstrained', () => {
    expect(fieldBadges(base)).toBe('');
    expect(fieldBadges({ ...base, notNull: true })).toBe('NN');
    expect(fieldBadges({ ...base, notNull: true, unique: true, increment: true })).toBe('NN U ++');
  });
});

describe('fieldTooltip', () => {
  it('is null when there is nothing to say', () => {
    expect(fieldTooltip(base)).toBeNull();
  });

  it('stacks note, default, and enum values in that order', () => {
    expect(
      fieldTooltip({
        ...base, note: 'markdown supported', defaultValue: "'draft'",
        isEnum: true, enumValues: ['draft', 'published'],
      }),
    ).toBe("markdown supported\ndefault: 'draft'\nenum: draft | published");
  });

  it('shows a default of empty-string/zero correctly (null check, not truthiness)', () => {
    expect(fieldTooltip({ ...base, defaultValue: '0' })).toBe('default: 0');
  });
});

describe('fitFieldRow', () => {
  it('leaves ordinary rows untouched', () => {
    const fit = fitFieldRow('user_id', 'integer', 'NN', false, false);
    expect(fit).toEqual({ name: 'user_id', type: 'integer', nameTruncated: false });
  });

  it('ellipsizes a long name so it never reaches the badge/type column (the hrm_payroll case)', () => {
    const fit = fitFieldRow('hrm_payroll_employee_id', 'unsignedBigInt', 'NN', false, false);
    expect(fit.type).toBe('unsignedBigInt'); // under the type cap — kept whole
    expect(fit.nameTruncated).toBe(true);
    expect(fit.name.endsWith('…')).toBe(true);
    // conservative budget: name px + gap + type px + badge px never exceeds the row
    const namePx = fit.name.length * 7;
    const typePx = fit.type.length * 6.5;
    const badgePx = ('NN'.length + 1) * 5;
    expect(namePx + 8 + typePx + badgePx).toBeLessThanOrEqual(200);
  });

  it('caps a runaway type and charges pk/note prefixes against the name budget', () => {
    const fit = fitFieldRow('name', 'character varying(255) with time zone', '', true, true);
    expect(fit.type.endsWith('…')).toBe(true);
    expect(fit.type.length).toBeLessThanOrEqual(Math.floor(100 / 6.5));
    const shorter = fitFieldRow('a_moderately_long_field_name', 'integer', 'NN U ++', true, true);
    const longer = fitFieldRow('a_moderately_long_field_name', 'integer', '', false, false);
    expect(shorter.name.length).toBeLessThanOrEqual(longer.name.length);
  });
});

describe('fitTableTitle', () => {
  it('keeps short titles and ellipsizes long ones inside the header', () => {
    expect(fitTableTitle('users')).toBe('users');
    const long = fitTableTitle('hrm_payroll_employee_components');
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(Math.floor(184 / 8));
  });
});
