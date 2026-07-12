/** Named LOD thresholds (spec §6): below 40% zoom field rows drop out,
 *  below 15% tables render as colored rectangles with no text. */
export const LOD_FIELDS_MIN_ZOOM = 0.4;
export const LOD_TEXT_MIN_ZOOM = 0.15;

export type LodLevel = 'full' | 'shell' | 'box';

export function lodLevel(zoom: number): LodLevel {
  if (zoom < LOD_TEXT_MIN_ZOOM) return 'box';
  if (zoom < LOD_FIELDS_MIN_ZOOM) return 'shell';
  return 'full';
}
