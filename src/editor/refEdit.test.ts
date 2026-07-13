import { describe, it, expect } from 'vitest';
import { parseDbml } from '../core/parse/parseDbml';
import type { Ref } from '../core/model/types';
import { findRefLine, buildRefLine, refOperator, MIRRORED, formatRefText } from './refEdit';

const schemaOf = (src: string) => {
  const r = parseDbml(src);
  if (!r.ok) throw new Error(r.errors[0]?.message);
  return r.schema;
};
const refOf = (src: string, i = 0): Ref => schemaOf(src).refs[i];

const TABLES = 'Table a { x int \n y int }\nTable b { p int \n q int }\n';

describe('findRefLine', () => {
  it('locates a simple line with exact spans; a swap round-trips through the real parser', () => {
    const src = `${TABLES}Ref: a.x > b.p`;
    const ref = refOf(src);
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    expect(src.slice(m!.lineFrom, m!.lineTo)).toBe('Ref: a.x > b.p');
    expect(m!.operator).toBe('>');
    expect(m!.flipped).toBe(false);
    const swapped = src.slice(0, m!.opFrom) + '<' + src.slice(m!.opTo);
    const re = schemaOf(swapped).refs[0];
    expect(re.from.relation).toBe('1'); // a.x < b.p: one-side left
    expect(re.to.relation).toBe('*');
  });

  it('preserves a name and on-delete settings around an operator swap, byte-for-byte', () => {
    const src = `${TABLES}Ref order_fk: a.x > b.p [delete: cascade, update: no action]`;
    const ref = refOf(src);
    const m = findRefLine(src, ref)!;
    const swapped = src.slice(0, m.opFrom) + '<>' + src.slice(m.opTo);
    expect(swapped).toContain('Ref order_fk: a.x <> b.p [delete: cascade, update: no action]');
    expect(schemaOf(swapped).refs[0].from.relation).toBe('*'); // many-to-many now
  });

  it('deleting lineFrom..lineTo removes exactly the line and re-parses clean', () => {
    const src = `${TABLES}Ref: a.x > b.p\nRef: a.y > b.q\n`;
    const ref = refOf(src, 0); // a.x > b.p
    const m = findRefLine(src, ref)!;
    const after = src.slice(0, m.lineFrom) + src.slice(m.lineTo);
    const s = schemaOf(after);
    expect(s.refs).toHaveLength(1);
    expect(after).toContain('Ref: a.y > b.q');
    expect(after).not.toContain('a.x > b.p');
  });

  it('tolerates indentation, spacing, quoted tables/fields, and public-qualification', () => {
    const src = 'Table "or der" { "f 1" int }\nTable b { p int }\n   Ref:  public."or der"."f 1"   >   b.p';
    const ref = refOf(src);
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    expect(src.slice(m!.opFrom, m!.opTo)).toBe('>');
  });

  it('matches composite endpoints exactly (order-sensitive field lists)', () => {
    const src = `${TABLES}Ref: a.(x, y) > b.(p, q)`;
    const ref = refOf(src);
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    expect(m!.operator).toBe('>');
  });

  it('reports flipped when the normalized endpoints are reversed vs the written line', () => {
    const src = `${TABLES}Ref: a.x > b.p`;
    const ref = refOf(src);
    const reversed: Ref = { ...ref, from: ref.to, to: ref.from };
    const m = findRefLine(src, reversed);
    expect(m).not.toBeNull();
    expect(m!.flipped).toBe(true);
  });

  it('resolves alias-written endpoints (the parser resolves aliases — verified — so must the scanner)', () => {
    const src = 'Table users as U { id int }\nTable posts { user_id int }\nRef: posts.user_id > U.id';
    const ref = refOf(src); // normalized endpoints carry the REAL name: public.users
    const m = findRefLine(src, ref);
    expect(m).not.toBeNull();
    const swapped = src.slice(0, m!.opFrom) + '<' + src.slice(m!.opTo);
    expect(schemaOf(swapped).refs[0].from.relation).toBe('1'); // alias line rewritten in place
  });

  it('refuses a ref WRAPPED across lines (parses fine — the line-anchored scanner cannot own it)', () => {
    const src = 'Table a { x int }\nTable b { p int }\nRef: a.x >\n  b.p';
    expect(schemaOf(src).refs).toHaveLength(1); // the parser accepts the wrapped form (verified)…
    expect(findRefLine(src, refOf(src))).toBeNull(); // …we refuse honestly (popover shows the can't-locate error)
  });

  it('returns null for inline refs and for the block form (the refusal paths)', () => {
    const inlineSrc = 'Table a { id int }\nTable b { a_id int [ref: > a.id] }';
    expect(findRefLine(inlineSrc, refOf(inlineSrc))).toBeNull();
    const blockSrc = `${TABLES}Ref {\n  a.x > b.p\n}`;
    expect(findRefLine(blockSrc, refOf(blockSrc))).toBeNull();
  });

  it('tolerates a trailing // comment and never reads operator noise from it (blanked scan)', () => {
    // note: `note:` is NOT a valid ref setting in 8.3.1 ("Unknown ref setting")
    // — comments are where operator noise realistically lives.
    const src = `${TABLES}Ref: a.x - b.p // not < a real > op`;
    const ref = refOf(src);
    const m = findRefLine(src, ref)!;
    expect(src.slice(m.opFrom, m.opTo)).toBe('-');
  });
});

describe('buildRefLine / refOperator / formatRefText', () => {
  it('builds a parseable many-to-one line, omitting public', () => {
    const line = buildRefLine(
      { schemaName: 'public', tableName: 'posts', fieldName: 'user_id' },
      { schemaName: 'public', tableName: 'users', fieldName: 'id' },
    );
    expect(line).toBe('Ref: posts.user_id > users.id');
    const s = schemaOf(`Table posts { user_id int }\nTable users { id int }\n${line}`);
    expect(s.refs[0].from.relation).toBe('*');
    expect(s.refs[0].to.relation).toBe('1');
  });

  it('quotes non-identifier names, prefixes non-public schemas, parses back', () => {
    const line = buildRefLine(
      { schemaName: 'auth', tableName: 'user sessions', fieldName: 'user id' },
      { schemaName: 'public', tableName: 'users', fieldName: 'id' },
    );
    expect(line).toBe('Ref: auth."user sessions"."user id" > users.id');
    const src = `Table auth."user sessions" { "user id" int }\nTable users { id int }\n${line}`;
    expect(schemaOf(src).refs).toHaveLength(1);
  });

  it('returns null for unrepresentable names (embedded quote)', () => {
    expect(buildRefLine(
      { schemaName: 'public', tableName: 'a"b', fieldName: 'x' },
      { schemaName: 'public', tableName: 'c', fieldName: 'y' },
    )).toBeNull();
  });

  it('refOperator maps all four relation pairs; MIRRORED is an involution', () => {
    const src = `${TABLES}Ref: a.x > b.p\nRef: a.y < b.q\nTable c { m int \n n int }\nRef: c.m - b.p\nRef: c.n <> a.x`;
    const s = schemaOf(src);
    expect(s.refs.map(refOperator)).toEqual(['>', '<', '-', '<>']);
    for (const op of ['>', '<', '-', '<>'] as const) expect(MIRRORED[MIRRORED[op]]).toBe(op);
  });

  it('formatRefText strips public. and shows composite field lists', () => {
    const s = schemaOf(`${TABLES}Ref: a.(x, y) > b.(p, q)`);
    expect(formatRefText(s.refs[0])).toBe('a.(x, y) > b.(p, q)');
  });
});
