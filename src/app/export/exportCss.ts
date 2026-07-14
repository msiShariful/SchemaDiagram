/** Pure helpers for diagram export. No DOM access at module level — this
 *  file is unit-tested in vitest's node environment; the DOM-touching SVG
 *  serialization lives in svgExport.ts. */

/** SVG-relevant subset of src/styles.css, kept as var() references so the
 *  values are resolved from the LIVE document at export time — when Plan 3
 *  lands CSS-variable theming (dark mode), exports automatically pick up
 *  the active theme without touching this file.
 *  ponytail: selectors duplicated from styles.css by hand; if a canvas
 *  class is renamed there, rename it here too. */
export const EXPORT_CSS = [
  'text { font-family: system-ui, sans-serif; }',
  '.table-body { fill: #fff; stroke: var(--border); }',
  '.table-header { fill: var(--table-header); }',
  '.table-title { fill: #fff; font-size: 13px; font-weight: 600; }',
  '.field-name { font-size: 12px; fill: var(--text); }',
  '.field-name.pk { font-weight: 600; }',
  '.field-type { font-size: 11px; fill: var(--text-dim); }',
  '.row-line { stroke: var(--border); }',
  '.edge path { fill: none; stroke: var(--edge); stroke-width: 1.5; }',
  '.edge-label { font-size: 10px; fill: var(--text-dim); }',
  // Plan 3 canvas elements — LOD box fallback, groups, sticky notes.
  '.table-box { fill: var(--table-header); stroke: var(--border); }',
  '.group-rect { fill-opacity: 0.05; stroke-width: 1.5; stroke-dasharray: 6 4; }',
  '.group-title { font-size: 12px; font-weight: 600; fill: var(--text); }',
  '.note-body { fill: var(--note-bg); stroke: var(--note-border); }',
  '.note-title { font-size: 11px; font-weight: 600; fill: var(--text); }',
  '.note-content { font-size: 11px; color: var(--text); font-family: system-ui, sans-serif; white-space: pre-wrap; overflow: hidden; height: 100%; }',
  // Plan 7 Feature B: field badges + note dots.
  '.field-badges { font-size: 8px; fill: var(--text-dim); letter-spacing: 0.03em; }',
  '.field-note-dot { font-size: 7px; fill: var(--accent); }',
  // Plan 7 Feature E: collapsed-group pill + chevrons.
  '.group-pill { fill-opacity: 0.22; stroke-width: 1.5; }',
  '.group-collapse-bg { fill: var(--bg-elev); stroke: var(--border); }',
  '.group-collapse-glyph { font-size: 10px; fill: var(--text); }',
].join('\n');

/** Replace every `var(--name)` / `var(--name, fallback)` with a concrete
 *  value from `getVar`, falling back to the literal fallback, then ''. */
export function resolveCssVars(css: string, getVar: (name: string) => string): string {
  return css.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_m, name: string, fallback?: string) => {
      const v = getVar(name).trim();
      if (v !== '') return v;
      return (fallback ?? '').trim();
    },
  );
}

/** Turn a diagram name into a safe cross-platform filename stem. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned === '' ? 'diagram' : cleaned;
}
