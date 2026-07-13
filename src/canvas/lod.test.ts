import { describe, it, expect } from 'vitest';
import { LOD_FIELDS_MIN_ZOOM, LOD_TEXT_MIN_ZOOM, lodLevel, effectiveLod } from './lod';

describe('lodLevel', () => {
  it('exposes the named thresholds', () => {
    expect(LOD_FIELDS_MIN_ZOOM).toBe(0.4);
    expect(LOD_TEXT_MIN_ZOOM).toBe(0.15);
  });
  it('selects full at and above 40%', () => {
    expect(lodLevel(1)).toBe('full');
    expect(lodLevel(0.4)).toBe('full');
  });
  it('selects shell between 15% and 40%', () => {
    expect(lodLevel(0.399)).toBe('shell');
    expect(lodLevel(0.15)).toBe('shell');
  });
  it('selects box below 15%', () => {
    expect(lodLevel(0.149)).toBe('box');
    expect(lodLevel(0.1)).toBe('box');
  });
});

describe('effectiveLod (Plan 6 detail override)', () => {
  it('auto follows the zoom thresholds', () => {
    expect(effectiveLod(1, 'auto')).toBe('full');
    expect(effectiveLod(0.3, 'auto')).toBe('shell');
    expect(effectiveLod(0.1, 'auto')).toBe('box');
  });

  it('an override wins over zoom at both extremes', () => {
    expect(effectiveLod(0.05, 'full')).toBe('full');
    expect(effectiveLod(1, 'headers')).toBe('shell');
    expect(effectiveLod(1, 'boxes')).toBe('box');
  });
});
