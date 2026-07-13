import { useMemo, useState } from 'react';
import { useAppStore } from '../app/store';
import { centerOnTable } from './canvasNav';
import type { Table } from '../core/model/types';

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Zm7 2.3A2.3 2.3 0 1 0 8 5.7a2.3 2.3 0 0 0 0 4.6Z"
        fill="currentColor"
        opacity={off ? 0.3 : 1}
      />
      {off && <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

interface Props {
  // Expanded flag lifted to DiagramCanvas (session-local, deliberately not
  // persisted / not in the zustand store) so it can toggle a class on
  // .canvas-wrap and shift the zoom controls + minimap out from under the
  // panel. setExpanded is a plain useState setter — referentially stable.
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

/** Diagram Views (Feature D). Table visibility is VIEW state — hiddenTableIds
 *  in the store, persisted with the diagram, never written to DBML. Search
 *  filters which rows are LISTED; the schema counts and the schema-level eye
 *  always operate on the schema's FULL table set. */
export function DiagramViewsSidebar({ expanded, setExpanded }: Props) {
  const [query, setQuery] = useState('');
  const tables = useAppStore((s) => s.schema.tables);
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  const setHiddenTables = useAppStore((s) => s.setHiddenTables);
  const hidden = useMemo(() => new Set(hiddenTableIds), [hiddenTableIds]);

  const groups = useMemo(() => {
    const m = new Map<string, Table[]>();
    for (const t of tables) m.set(t.schemaName, [...(m.get(t.schemaName) ?? []), t]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tables]);
  const q = query.trim().toLowerCase();

  const toggleTable = (id: string) => {
    setHiddenTables(
      hidden.has(id) ? hiddenTableIds.filter((h) => h !== id) : [...hiddenTableIds, id],
    );
  };
  // Clicking a HIDDEN table's name centers on a table with no mounted node
  // (flash targets nothing). Unhide first — "show me this table" is the
  // intent — then center; the eye stays the pure visibility control.
  const centerOn = (id: string) => {
    if (hidden.has(id)) setHiddenTables(hiddenTableIds.filter((h) => h !== id));
    centerOnTable(id);
  };
  const toggleSchema = (members: Table[]) => {
    const ids = members.map((t) => t.id);
    if (ids.some((id) => !hidden.has(id))) {
      setHiddenTables([...new Set([...hiddenTableIds, ...ids])]); // hide all
    } else {
      const drop = new Set(ids);
      setHiddenTables(hiddenTableIds.filter((h) => !drop.has(h))); // show all
    }
  };

  if (!expanded) {
    return (
      <button className="views-tab" title="Diagram Views" onClick={() => setExpanded(true)}>
        ‹
      </button>
    );
  }

  return (
    <div className="views-panel">
      <div className="views-header">
        <span>Diagram Views</span>
        <button className="views-collapse" title="Collapse" onClick={() => setExpanded(false)}>›</button>
      </div>
      <input
        className="views-search"
        placeholder="Search tables…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="views-groupby">Group by: Schema</div>
      <div className="views-tree">
        {groups.map(([schemaName, members]) => {
          const listed = q ? members.filter((t) => t.name.toLowerCase().includes(q)) : members;
          if (q && listed.length === 0) return null;
          const visibleCount = members.filter((t) => !hidden.has(t.id)).length;
          return (
            <div key={schemaName}>
              <div className="views-schema">
                <span className="views-schema-name">{schemaName}</span>
                <span className="views-count">{visibleCount}/{members.length}</span>
                <button
                  className="views-eye"
                  aria-label="Toggle visibility"
                  title={visibleCount > 0 ? 'Hide all tables in this schema' : 'Show all tables in this schema'}
                  onClick={() => toggleSchema(members)}
                >
                  <EyeIcon off={visibleCount === 0} />
                </button>
              </div>
              {listed.map((t) => (
                <div key={t.id} className="views-table-row">
                  <button className="views-name" title="Center on this table" onClick={() => centerOn(t.id)}>
                    {t.name}
                  </button>
                  <button className="views-eye" aria-label="Toggle visibility" onClick={() => toggleTable(t.id)}>
                    <EyeIcon off={hidden.has(t.id)} />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="views-footer">
        <button className="views-all" title="Show every table" onClick={() => setHiddenTables([])}>
          All
        </button>
      </div>
    </div>
  );
}
