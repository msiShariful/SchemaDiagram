export interface Field {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  increment: boolean;
  defaultValue: string | null;
  note: string | null;
  isEnum: boolean;
}

export interface Table {
  id: string; // `${schemaName}.${name}`
  schemaName: string;
  name: string;
  alias: string | null;
  headerColor: string | null;
  note: string | null;
  fields: Field[];
}

export type Relation = '1' | '*';

export interface RefEndpoint {
  tableId: string;
  fieldNames: string[];
  relation: Relation;
}

export interface Ref {
  id: string;
  from: RefEndpoint;
  to: RefEndpoint;
}

export interface EnumDef {
  id: string; // `${schemaName}.${name}`
  name: string;
  values: string[];
}

export interface TableGroup {
  id: string;
  name: string;
  tableIds: string[];
  color: string | null;
}

export interface StickyNote {
  id: string;
  name: string;
  content: string;
}

export interface Schema {
  tables: Table[];
  refs: Ref[];
  enums: EnumDef[];
  groups: TableGroup[];
  notes: StickyNote[];
}

export const EMPTY_SCHEMA: Schema = { tables: [], refs: [], enums: [], groups: [], notes: [] };

export interface TablePosition { x: number; y: number; }
export interface Viewport { x: number; y: number; zoom: number; }
export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }
