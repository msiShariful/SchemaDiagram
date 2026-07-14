import type { Field } from '../core/model/types';

/** Feature B label helpers — pure, unit-tested; TableNode renders the
 *  results. pk is NOT a badge here: the name already carries the 🔑 prefix. */

export function fieldBadges(f: Field): string {
  const out: string[] = [];
  if (f.notNull) out.push('NN');
  if (f.unique) out.push('U');
  if (f.increment) out.push('++');
  return out.join(' ');
}

/** Body for the row's SVG <title> (native tooltip — zero positioning code);
 *  null means "mount no title". defaultValue uses a null check: '0' and ''
 *  are real defaults. */
export function fieldTooltip(f: Field): string | null {
  const lines: string[] = [];
  if (f.note) lines.push(f.note);
  if (f.defaultValue !== null) lines.push(`default: ${f.defaultValue}`);
  if (f.enumValues && f.enumValues.length > 0) lines.push(`enum: ${f.enumValues.join(' | ')}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

/* Row/title truncation: SVG text has no text-overflow, so the 220px row is
 * fit by character estimate. Per-char widths are deliberately GENEROUS
 * (system-ui at each class's font-size) — worst case a char truncates one
 * early; overlap can't happen. Truncated names surface in full via the row
 * <title> tooltip. */
const ROW_TEXT_PX = 200; // TABLE_WIDTH − 10px padding each side
const NAME_PX_PER_CHAR = 7; // .field-name 12px
const TYPE_PX_PER_CHAR = 6.5; // .field-type 11px
const BADGE_PX_PER_CHAR = 5; // .field-badges 8px + letter-spacing
const COL_GAP_PX = 8;
const PK_PREFIX_PX = 18; // 🔑 + space
const NOTE_DOT_PX = 10; // ' ●' tspan
const TYPE_MAX_PX = 100; // cap the type column so long names keep room

const ellipsize = (s: string, maxPx: number, pxPerChar: number): string => {
  const max = Math.floor(maxPx / pxPerChar);
  return s.length <= max ? s : max <= 1 ? '…' : `${s.slice(0, max - 1)}…`;
};

export function fitFieldRow(
  name: string,
  type: string,
  badges: string,
  pk: boolean,
  hasNote: boolean,
): { name: string; type: string; nameTruncated: boolean } {
  const fitType = ellipsize(type, TYPE_MAX_PX, TYPE_PX_PER_CHAR);
  const typePx = fitType.length * TYPE_PX_PER_CHAR;
  const badgesPx = badges === '' ? 0 : (badges.length + 1) * BADGE_PX_PER_CHAR;
  const namePx =
    ROW_TEXT_PX - COL_GAP_PX - typePx - badgesPx - (pk ? PK_PREFIX_PX : 0) - (hasNote ? NOTE_DOT_PX : 0);
  const fitName = ellipsize(name, namePx, NAME_PX_PER_CHAR);
  return { name: fitName, type: fitType, nameTruncated: fitName !== name };
}

/** Header title: 220 − 10 left pad − 26 gear zone, 13px semibold. */
export function fitTableTitle(name: string): string {
  return ellipsize(name, 184, 8);
}
