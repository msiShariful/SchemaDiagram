import type { ParseError } from '../parse/errors';
import { normalizeParseErrors } from '../parse/errors';

export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle';

/** Import-only dialects. Snowflake is deliberately NOT in SqlDialect:
 *  exporter.export(…, 'snowflake') returns an EMPTY STRING in the installed
 *  8.3.1 (verified — the sqlite situation), while importer.import(…,
 *  'snowflake') works and re-parses with 'dbmlv2'. */
export type ImportSqlDialect = SqlDialect | 'snowflake';

export type ConvertResult = { ok: true; text: string } | { ok: false; errors: ParseError[] };

// @dbml/core is ~2.7 MB gzipped — it must never land in the main chunk
// (CLAUDE.md invariant). Loaded on first use, exactly like workerParse's
// fallback path; Vite shares the chunk with the parser, and the browser
// caches it after the first conversion. A failed chunk load rejects the
// await inside the try, so it surfaces as a normal {ok:false} result.
const loadCore = () => import('@dbml/core');

/** SQL DDL → DBML text. Uses the installed 8.3.1 facade
 *  `importer.import(str, format)`, which parses with the v2 dialect parsers
 *  ('postgres' | 'mysql' | 'mssql' | 'oracle' | 'snowflake') and re-emits DBML via its own
 *  exporter — so the result is always re-parseable by our 'dbmlv2' pipeline. */
export async function importSql(sql: string, dialect: ImportSqlDialect): Promise<ConvertResult> {
  try {
    const { importer } = await loadCore();
    return { ok: true, text: importer.import(sql, dialect) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
  }
}

/** DBML text → SQL DDL. `exporter.export(str, format)` parses the DBML with
 *  the 'dbmlv2' grammar internally (verified against the 8.3.1 bundle) —
 *  the same format parseDbml uses, so anything the canvas renders exports. */
export async function exportSql(dbml: string, dialect: SqlDialect): Promise<ConvertResult> {
  try {
    const { exporter } = await loadCore();
    return { ok: true, text: exporter.export(dbml, dialect) };
  } catch (e) {
    return { ok: false, errors: normalizeParseErrors(e) };
  }
}
