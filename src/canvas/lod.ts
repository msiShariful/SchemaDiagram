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

/** Feature E's Detail dropdown. An override wins over the zoom thresholds;
 *  'auto' is today's behavior. Culling stays zoom/viewport-based regardless:
 *  overriding to 'full' at 10% zoom renders full detail for the tables that
 *  survive culling — it never mounts the whole scene. */
export type LodOverride = 'auto' | 'full' | 'headers' | 'boxes';

export function effectiveLod(zoom: number, override: LodOverride): LodLevel {
  switch (override) {
    case 'full': return 'full';
    case 'headers': return 'shell';
    case 'boxes': return 'box';
    default: return lodLevel(zoom);
  }
}
