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
