import { describe, it, expect } from 'vitest';
import { formatDiagramDate, ordinal } from './relativeDate';

describe('ordinal', () => {
  it('handles st/nd/rd/th including the 11-13 exceptions', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(31)).toBe('31st');
  });
});

describe('formatDiagramDate', () => {
  // Local-time constructors keep these assertions timezone-independent.
  const at = (y: number, mo: number, d: number, h: number, mi: number) =>
    new Date(y, mo, d, h, mi).getTime();

  it('same calendar day → "Today at h:mm AM/PM"', () => {
    const now = at(2026, 6, 13, 12, 0);
    expect(formatDiagramDate(at(2026, 6, 13, 9, 55), now)).toBe('Today at 9:55 AM');
    expect(formatDiagramDate(at(2026, 6, 13, 17, 46), now)).toBe('Today at 5:46 PM');
    expect(formatDiagramDate(at(2026, 6, 13, 0, 5), now)).toBe('Today at 12:05 AM');
    expect(formatDiagramDate(at(2026, 6, 13, 12, 0), now)).toBe('Today at 12:00 PM');
  });

  it('other days → "June 3rd 2024, 5:46 PM" shape', () => {
    const now = at(2026, 6, 13, 12, 0);
    expect(formatDiagramDate(at(2024, 5, 3, 17, 46), now)).toBe('June 3rd 2024, 5:46 PM');
    expect(formatDiagramDate(at(2025, 0, 21, 8, 5), now)).toBe('January 21st 2025, 8:05 AM');
  });

  it('yesterday at the same clock time is NOT "Today"', () => {
    const now = at(2026, 6, 13, 9, 0);
    expect(formatDiagramDate(at(2026, 6, 12, 9, 0), now)).toBe('July 12th 2026, 9:00 AM');
  });
});
