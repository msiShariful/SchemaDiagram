import { useAppStore } from '../store';
import { expandRect } from '../../core/model/geometry';
import { EXPORT_CSS, resolveCssVars } from './exportCss';
import { computeExportBounds } from './exportBounds';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Extra space around the table bounding box so orthogonal edge routes and
 *  cardinality labels that swing outside the table rects are not clipped. */
export const EXPORT_MARGIN = 48;

export interface BuiltSvg {
  markup: string;
  width: number;
  height: number;
}

/** Serialize the live canvas scene into a standalone SVG document string.
 *  - full-diagram bounds (union of all table/note/group rects + margin, via
 *    computeExportBounds), NOT the viewport
 *  - the scene <g>'s pan/zoom transform is stripped from the clone
 *  - styles inlined via an embedded <style> block, with every CSS variable
 *    resolved against the live document — theme-correct once Plan 3 lands
 *    CSS-variable theming
 *  - fonts are the system stack; nothing to embed
 *  Returns null when there is nothing to export (no canvas / nothing positioned). */
export function buildDiagramSvg(): BuiltSvg | null {
  const live = document.querySelector('svg.diagram-canvas');
  const scene = live?.firstElementChild ?? null; // the single scene <g>
  // ponytail: the clone below carries whatever LOD the live canvas is
  // currently rendered at (TableNode collapses to `.table-box`, no field
  // text, below 15% zoom — see canvas/lod.ts). Forcing a full-detail
  // re-render before serializing would mean driving DiagramCanvas's React
  // tree through an off-screen zoom, which is a real feature, not a CSS fix
  // — deferred. EXPORT_CSS styles `.table-box` so that ceiling degrades to
  // "plain colored boxes" rather than invisible/unstyled rects.
  const { schema, positions, notePositions } = useAppStore.getState();
  const bounds = computeExportBounds(schema, positions, notePositions);
  if (!scene || !bounds) return null;
  const b = expandRect(bounds, EXPORT_MARGIN);

  const rootStyle = getComputedStyle(document.documentElement);
  const getVar = (name: string) => rootStyle.getPropertyValue(name);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(b.w));
  svg.setAttribute('height', String(b.h));
  svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = resolveCssVars(EXPORT_CSS, getVar);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(b.x));
  bg.setAttribute('y', String(b.y));
  bg.setAttribute('width', String(b.w));
  bg.setAttribute('height', String(b.h));
  bg.setAttribute('fill', getVar('--bg').trim() || '#ffffff');

  // Clone the live scene; drop the viewport pan/zoom so the viewBox rules.
  // Transient UI classes (.focused, .hot) survive the clone, but EXPORT_CSS
  // defines no rules for them, so they render as normal tables/edges.
  const clone = scene.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');

  svg.append(style, bg, clone);
  return { markup: new XMLSerializer().serializeToString(svg), width: b.w, height: b.h };
}

/** Rasterize the built SVG at `scale`× via an offscreen <canvas>. The SVG is
 *  loaded through a same-origin blob URL and contains no external
 *  references, so the canvas is never tainted and toBlob is allowed. */
export async function buildPngBlob(scale = 2): Promise<Blob | null> {
  const built = buildDiagramSvg();
  if (!built) return null;
  const url = URL.createObjectURL(new Blob([built.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(built.width * scale));
    canvas.height = Math.max(1, Math.round(built.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
