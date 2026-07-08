import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Schema, Table } from '../core/model/types';
import { blankNoise } from './sourceMap';

export const COLUMN_TYPES = [
  'int', 'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'varchar', 'char', 'text',
  'boolean', 'bool',
  'timestamp', 'timestamptz', 'datetime', 'date', 'time',
  'decimal', 'numeric', 'float', 'double', 'real',
  'json', 'jsonb', 'uuid', 'blob', 'bytea',
];

export const SETTING_OPTIONS = [
  'pk', 'primary key', 'unique', 'not null', 'null', 'increment',
  'default: ', 'note: ', 'ref: ',
];

export type DbmlContextKind =
  | 'settings' | 'column-of-table' | 'table-target' | 'field-type'
  | 'table-body' | 'top-level' | 'none';

export interface DbmlContext {
  kind: DbmlContextKind;
  tableName?: string;
  schemaName?: string;
}

const BLOCK_OPENER_RE = /(table|enum|tablegroup|indexes|project|note|ref)\s*(?:"[^"]*"|[\w.]+)?\s*(?:as\s+\w+\s*)?(?:\[[^\]]*\]\s*)?\{$/i;

/** Which block keyword encloses `pos`? Returns lowercase keyword or null (top level). */
function enclosingBlock(blanked: string, pos: number): string | null {
  const stack: string[] = [];
  for (let i = 0; i < pos; i++) {
    const ch = blanked[i];
    if (ch === '{') {
      // block openers are single-line by grammar, so scan the opener's whole line
      const before = blanked.slice(blanked.lastIndexOf('\n', i) + 1, i + 1).trimEnd();
      const m = BLOCK_OPENER_RE.exec(before);
      stack.push(m ? m[1].toLowerCase() : '?');
    } else if (ch === '}') {
      stack.pop();
    }
  }
  return stack.length ? stack[stack.length - 1] : null;
}

// column-of-table: word(.word)? '.' partial-word at cursor
const COLUMN_DOT_RE = /(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\.\w*$/;

export function detectContext(text: string, pos: number): DbmlContext {
  const blanked = blankNoise(text);
  const lineStart = blanked.lastIndexOf('\n', pos - 1) + 1;
  const linePrefix = blanked.slice(lineStart, pos);

  // settings: unclosed '[' on this line before the cursor
  const opens = (linePrefix.match(/\[/g) ?? []).length;
  const closes = (linePrefix.match(/\]/g) ?? []).length;
  if (opens > closes) {
    // inside an in-progress inline `ref:` setting, targets beat setting keywords
    const bracketStack: number[] = [];
    for (let i = 0; i < linePrefix.length; i++) {
      if (linePrefix[i] === '[') bracketStack.push(i);
      else if (linePrefix[i] === ']') bracketStack.pop();
    }
    const lastOpen = bracketStack.length ? bracketStack[bracketStack.length - 1] : -1;
    const segment = linePrefix.slice(lastOpen + 1);
    if (/ref\s*:[^,\]]*$/i.test(segment)) {
      const dm = COLUMN_DOT_RE.exec(segment);
      if (dm) return { kind: 'column-of-table', tableName: dm[2], schemaName: dm[1] };
      if (/ref\s*:\s*[<>-]?\s*[\w."]*$/i.test(segment)) return { kind: 'table-target' };
    }
    return { kind: 'settings' };
  }

  const dotMatch = COLUMN_DOT_RE.exec(linePrefix);
  if (dotMatch) {
    return { kind: 'column-of-table', tableName: dotMatch[2], schemaName: dotMatch[1] };
  }

  const block = enclosingBlock(blanked, pos);
  const trimmed = linePrefix.trimStart();

  // Ref targets: "Ref:", "Ref name:", or after a relation operator
  if (/^ref\b[^:]*:\s*[\w."]*$/i.test(trimmed)) return { kind: 'table-target' };
  if (/[<>-]\s*[\w."]*$/.test(trimmed) && (block === 'ref' || /^ref\b/i.test(trimmed) || block === null))
    return { kind: 'table-target' };
  if (block === 'ref') return { kind: 'table-target' };
  if (block === 'tablegroup') return { kind: 'table-target' };

  if (block === 'table') {
    // field-type: exactly one word already typed, then whitespace, then (partial) cursor word
    if (/^[A-Za-z_"][\w"]*\s+[\w()]*$/.test(trimmed)) return { kind: 'field-type' };
    if (trimmed === '') return { kind: 'table-body' };
    return { kind: 'none' }; // field-name position or beyond
  }
  if (block === null) {
    if (/^[\w]*$/.test(trimmed)) return { kind: 'top-level' };
    return { kind: 'none' };
  }
  return { kind: 'none' }; // enum/indexes/project/unknown bodies
}

function tableCompletions(schema: Schema): Completion[] {
  const out: Completion[] = [];
  for (const t of schema.tables) {
    out.push({
      label: t.name,
      type: 'class',
      detail: t.schemaName !== 'public' ? t.schemaName : undefined,
      apply: t.schemaName === 'public' ? t.name : `${t.schemaName}.${t.name}`,
    });
    if (t.alias) out.push({ label: t.alias, type: 'class', detail: `alias of ${t.name}` });
  }
  return out;
}

function resolveTable(schema: Schema, ctx: DbmlContext): Table | undefined {
  return schema.tables.find((t) => {
    if (ctx.schemaName) return t.schemaName === ctx.schemaName && t.name === ctx.tableName;
    return t.name === ctx.tableName || t.alias === ctx.tableName;
  });
}

const TOP_SNIPPETS: Completion[] = [
  snippetCompletion('Table ${name} {\n  id integer [pk]\n  ${}\n}', { label: 'Table', type: 'keyword', detail: 'block' }),
  snippetCompletion('Ref: ${from_table}.${from_column} > ${to_table}.${to_column}', { label: 'Ref', type: 'keyword', detail: 'relationship' }),
  snippetCompletion('Enum ${name} {\n  ${value}\n}', { label: 'Enum', type: 'keyword', detail: 'block' }),
  snippetCompletion('TableGroup ${name} {\n  ${}\n}', { label: 'TableGroup', type: 'keyword', detail: 'block' }),
  snippetCompletion("Note ${name} {\n  '${content}'\n}", { label: 'Note', type: 'keyword', detail: 'sticky note' }),
];

const TABLE_BODY_SNIPPETS: Completion[] = [
  snippetCompletion('indexes {\n  (${columns})\n}', { label: 'indexes', type: 'keyword', detail: 'block' }),
  snippetCompletion("Note: '${text}'", { label: 'Note', type: 'keyword', detail: 'table note' }),
];

export function createDbmlCompletion(getSchema: () => Schema) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w]*/);
    const from = word ? word.from : context.pos;
    if (!context.explicit && word && word.from === word.to) return null;

    const dctx = detectContext(context.state.doc.toString(), context.pos);
    const schema = getSchema();

    switch (dctx.kind) {
      case 'settings':
        return { from, options: SETTING_OPTIONS.map((s) => ({ label: s, type: 'keyword' })) };
      case 'table-target':
        return { from, options: tableCompletions(schema) };
      case 'column-of-table': {
        const table = resolveTable(schema, dctx);
        if (!table) return null;
        return { from, options: table.fields.map((f) => ({ label: f.name, type: 'property', detail: f.type })) };
      }
      case 'field-type': {
        const types: Completion[] = COLUMN_TYPES.map((t) => ({ label: t, type: 'type' }));
        const enums: Completion[] = schema.enums.map((e) => ({ label: e.name, type: 'enum', detail: 'enum' }));
        return { from, options: [...types, ...enums] };
      }
      case 'top-level':
        return { from, options: TOP_SNIPPETS };
      case 'table-body':
        return { from, options: TABLE_BODY_SNIPPETS };
      case 'none':
        return null;
    }
  };
}
