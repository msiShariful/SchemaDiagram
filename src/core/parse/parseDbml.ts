import { Parser } from '@dbml/core';
import type {
  Schema, Table, Field, Ref, RefEndpoint, EnumDef, Relation, TableGroup, StickyNote,
} from '../model/types';
import type { ParseError } from './errors';
import { normalizeParseErrors } from './errors';
import { blankNoise } from './blankNoise';

export type { ParseError } from './errors';
export type ParseResult = { ok: true; schema: Schema } | { ok: false; errors: ParseError[] };

export function parseDbml(source: string): ParseResult {
  try {
    // 'dbmlv2' is the ANTLR-based DBML parser (dbdiagram.io's current syntax);
    // the legacy 'dbml' peg parser rejects single-line blocks like `Table a { id int }`.
    const db = new Parser().parse(source, 'dbmlv2');
    return { ok: true, schema: normalizeDatabase(db, blankNoise(source)) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
  }
}

// Empirical (8.3.1): parsed refs carry NO inline flag — only `token`. An
// inline ref's token starts at the `ref:` INSIDE a field's settings bracket,
// so the previous non-whitespace character is `[` or `,`. A standalone
// `Ref…` statement is preceded by `}`/`]`/nothing. The scan runs on
// comment/string-blanked text so `// a comment,` can't fake an inline ref.
function isInlineRef(blanked: string, offset: number | undefined): boolean {
  if (offset === undefined) return false; // no token info — standalone; findRefLine still refuses safely
  let i = offset - 1;
  while (i >= 0 && /\s/.test(blanked[i])) i--;
  return i >= 0 && (blanked[i] === '[' || blanked[i] === ',');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeDatabase(db: any, blanked: string): Schema {
  const tables: Table[] = [];
  const refs: Ref[] = [];
  const enums: EnumDef[] = [];
  const enumNames = new Set<string>();

  for (const schema of db.schemas ?? []) {
    const schemaName: string = schema.name ?? 'public';
    for (const en of schema.enums ?? []) {
      enums.push({
        id: `${schemaName}.${en.name}`,
        name: en.name,
        values: (en.values ?? []).map((v: any) => v.name),
      });
      enumNames.add(en.name);
    }
  }
  const enumsByName = new Map(enums.map((e) => [e.name, e]));

  for (const schema of db.schemas ?? []) {
    const schemaName: string = schema.name ?? 'public';
    for (const t of schema.tables ?? []) {
      const fields: Field[] = (t.fields ?? []).map((f: any) => ({
        name: f.name,
        type: f.type?.type_name ?? String(f.type ?? ''),
        pk: !!f.pk,
        unique: !!f.unique,
        notNull: !!f.not_null,
        increment: !!f.increment,
        defaultValue: f.dbdefault != null ? String(f.dbdefault.value) : null,
        note: f.note ? String(f.note) : null,
        isEnum: enumNames.has(f.type?.type_name ?? ''),
        enumValues: enumsByName.get(f.type?.type_name ?? '')?.values ?? null,
      }));
      tables.push({
        id: `${schemaName}.${t.name}`,
        schemaName,
        name: t.name,
        alias: t.alias ?? null,
        headerColor: t.headerColor ?? null,
        note: t.note ? String(t.note) : null,
        fields,
      });
    }
    for (const r of schema.refs ?? []) {
      const eps = (r.endpoints ?? []).map((ep: any): RefEndpoint => ({
        tableId: `${ep.schemaName ?? schemaName}.${ep.tableName}`,
        fieldNames: ep.fieldNames ?? [],
        relation: (ep.relation === '1' ? '1' : '*') as Relation,
      }));
      if (eps.length === 2) {
        const tokenStart = r.token?.start;
        refs.push({
          id: `ref-${refs.length}-${eps[0].tableId}-${eps[1].tableId}`,
          from: eps[0],
          to: eps[1],
          inline: isInlineRef(blanked, tokenStart?.offset),
          pos: typeof tokenStart?.line === 'number'
            ? { line: tokenStart.line, column: tokenStart.column ?? 1 }
            : null,
        });
      }
    }
  }
  const groups: TableGroup[] = [];
  for (const schema of db.schemas ?? []) {
    const schemaName: string = schema.name ?? 'public';
    for (const tg of schema.tableGroups ?? []) {
      groups.push({
        id: `${schemaName}.${tg.name}`,
        name: String(tg.name),
        color: tg.color ?? null,
        tableIds: (tg.tables ?? []).map((t: any) => {
          const tSchema = t.schemaName ?? t.schema?.name ?? schemaName;
          const tName = t.tableName ?? t.name;
          return `${tSchema}.${tName}`;
        }),
      });
    }
  }

  // Standalone `Note name { '...' }` blocks. 8.3 exposes them on the database
  // object; scan the per-schema slot too and dedupe by name so we adapt to
  // either placement without double-emitting.
  const noteById = new Map<string, StickyNote>();
  const rawNotes: any[] = [
    ...(db.notes ?? []),
    ...(db.schemas ?? []).flatMap((s: any) => s.notes ?? []),
  ];
  for (const n of rawNotes) {
    const name = String(n?.name ?? '');
    if (!name || noteById.has(name)) continue;
    noteById.set(name, { id: name, name, content: n.content != null ? String(n.content) : '' });
  }

  return { tables, refs, enums, groups, notes: [...noteById.values()] };
}
