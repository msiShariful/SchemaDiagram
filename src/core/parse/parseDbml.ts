import { Parser } from '@dbml/core';
import type { Schema, Table, Field, Ref, RefEndpoint, EnumDef, Relation } from '../model/types';
import type { ParseError } from './errors';
import { normalizeParseErrors } from './errors';

export type { ParseError } from './errors';
export type ParseResult = { ok: true; schema: Schema } | { ok: false; errors: ParseError[] };

export function parseDbml(source: string): ParseResult {
  try {
    // 'dbmlv2' is the ANTLR-based DBML parser (dbdiagram.io's current syntax);
    // the legacy 'dbml' peg parser rejects single-line blocks like `Table a { id int }`.
    const db = new Parser().parse(source, 'dbmlv2');
    return { ok: true, schema: normalizeDatabase(db) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeDatabase(db: any): Schema {
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
        refs.push({ id: `ref-${refs.length}-${eps[0].tableId}-${eps[1].tableId}`, from: eps[0], to: eps[1] });
      }
    }
  }
  return { tables, refs, enums, groups: [], notes: [] }; // groups/notes normalized in Plan 3 (canvas depth)
}
