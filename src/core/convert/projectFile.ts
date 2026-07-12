import type { TablePosition, Viewport } from '../model/types';

export const PROJECT_FILE_VERSION = 1;

/** On-disk project file: DBML + layout + viewport (spec §3 Export row).
 *  `layout` is this codebase's `positions` map, keyed by `${schema}.${table}`. */
export interface ProjectFile {
  version: 1;
  name: string;
  dbml: string;
  layout: Record<string, TablePosition>;
  viewport: Viewport;
}

export type ProjectParseResult =
  | { ok: true; project: ProjectFile }
  | { ok: false; error: string };

export function serializeProject(p: {
  name: string;
  dbml: string;
  positions: Record<string, TablePosition>;
  viewport: Viewport;
}): string {
  const file: ProjectFile = {
    version: PROJECT_FILE_VERSION,
    name: p.name,
    dbml: p.dbml,
    layout: p.positions,
    viewport: p.viewport,
  };
  return JSON.stringify(file, null, 2);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate an untrusted project file. Rebuilds sanitized objects (unknown
 *  keys dropped, reserved layout keys like "__proto__" rejected) — this is a
 *  trust boundary. Errors are user-readable. */
export function parseProject(text: string): ProjectParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Not a project file (expected a JSON object).' };
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== PROJECT_FILE_VERSION) {
    return { ok: false, error: `Unsupported project file version: ${String(o.version)} (expected ${PROJECT_FILE_VERSION}).` };
  }
  if (typeof o.name !== 'string' || typeof o.dbml !== 'string') {
    return { ok: false, error: 'Project file is missing "name" or "dbml".' };
  }
  if (typeof o.layout !== 'object' || o.layout === null || Array.isArray(o.layout)) {
    return { ok: false, error: 'Project file "layout" must be an object of table positions.' };
  }
  const layout: Record<string, TablePosition> = {};
  for (const [k, v] of Object.entries(o.layout as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return { ok: false, error: `Project file layout entry "${k}" is not allowed.` };
    }
    const p = v as { x?: unknown; y?: unknown } | null;
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
      return { ok: false, error: `Project file layout entry "${k}" must have numeric x/y.` };
    }
    layout[k] = { x: p.x, y: p.y };
  }
  const vp = o.viewport as { x?: unknown; y?: unknown; zoom?: unknown } | null | undefined;
  if (!vp || !isFiniteNumber(vp.x) || !isFiniteNumber(vp.y) || !isFiniteNumber(vp.zoom) || vp.zoom <= 0) {
    return { ok: false, error: 'Project file "viewport" must have numeric x, y and a positive zoom.' };
  }
  return {
    ok: true,
    project: {
      version: PROJECT_FILE_VERSION,
      name: o.name,
      dbml: o.dbml,
      layout,
      viewport: { x: vp.x, y: vp.y, zoom: vp.zoom },
    },
  };
}
