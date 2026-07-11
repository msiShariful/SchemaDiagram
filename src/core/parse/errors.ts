export interface ParseError {
  message: string;
  line: number;
  column: number;
}

/** Normalize a thrown @dbml/core CompilerError — `{ diags: [{ message,
 *  location: { start: { line, column } } }] }` in the installed 8.3.1 — or
 *  any unknown throw, into our flat ParseError list. Shared by the DBML
 *  parse wrapper and the SQL convert facade. Deliberately free of any
 *  @dbml/core import so it is always safe in the main chunk. */
export function normalizeParseErrors(e: unknown): ParseError[] {
  const err = e as {
    diags?: Array<{ message?: string; location?: { start?: { line?: number; column?: number } } }>;
    message?: string;
  };
  if (Array.isArray(err?.diags) && err.diags.length > 0) {
    return err.diags.map((d) => ({
      message: d.message ?? 'Syntax error',
      line: d.location?.start?.line ?? 1,
      column: d.location?.start?.column ?? 1,
    }));
  }
  return [{ message: err?.message ?? 'Unknown parse error', line: 1, column: 1 }];
}
