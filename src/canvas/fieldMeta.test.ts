import { describe, it, expect } from 'vitest';
import type { Field } from '../core/model/types';
import { fieldBadges, fieldTooltip } from './fieldMeta';

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
