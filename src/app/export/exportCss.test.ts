import { describe, it, expect } from 'vitest';
import { EXPORT_CSS, resolveCssVars, safeFilename } from './exportCss';

describe('EXPORT_CSS', () => {
  it('covers every canvas class the scene uses', () => {
    for (const sel of [
      '.table-body', '.table-header', '.table-title', '.field-name',
      '.field-type', '.row-line', '.edge path', '.edge-label',
    ]) {
      expect(EXPORT_CSS).toContain(sel);
    }
  });
});

describe('resolveCssVars', () => {
  const vars: Record<string, string> = { '--border': '#d9dde3', '--text': ' #1f2430 ' };
  const getVar = (n: string) => vars[n] ?? '';

  it('replaces var() references with concrete values, trimming whitespace', () => {
    expect(resolveCssVars('stroke: var(--border);', getVar)).toBe('stroke: #d9dde3;');
    expect(resolveCssVars('fill: var(--text);', getVar)).toBe('fill: #1f2430;');
  });
  it('uses the literal fallback when the variable is not defined', () => {
    expect(resolveCssVars('fill: var(--missing, #abc);', getVar)).toBe('fill: #abc;');
  });
  it('resolves every var in EXPORT_CSS given a full variable map', () => {
    expect(resolveCssVars(EXPORT_CSS, () => '#123456')).not.toContain('var(');
  });
});

describe('safeFilename', () => {
  it('strips path and reserved characters', () => {
    expect(safeFilename('my/diagram: v2?')).toBe('my_diagram_ v2_');
  });
  it('falls back for empty names', () => {
    expect(safeFilename('   ')).toBe('diagram');
  });
});
