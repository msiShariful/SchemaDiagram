import { useMemo, useState } from 'react';
import { useAppStore } from '../app/store';
import { useOverlayEscape } from '../app/overlayStack';
import { centerOnTable } from './canvasNav';

const MAX_MATCHES = 8;

/** Cmd/Ctrl+K quick-search (Feature D). Pure session UI: choosing a table
 *  writes only view state (unhide/expand) and navigates — never DBML. */
export function QuickSearch({ onClose }: { onClose: () => void }) {
  const tables = useAppStore((s) => s.schema.tables);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);

  useOverlayEscape(true, onClose);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return tables.slice(0, MAX_MATCHES);
    return tables
      .filter((t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [tables, query]);
  const sel = Math.min(idx, Math.max(matches.length - 1, 0));

  const choose = (tableId: string) => {
    const s = useAppStore.getState();
    if (s.hiddenTableIds.includes(tableId)) {
      s.setHiddenTables(s.hiddenTableIds.filter((id) => id !== tableId)); // "show me this table"
    }
    const collapsedHiding = s.schema.groups
      .filter((g) => s.collapsedGroupIds.includes(g.id) && g.tableIds.includes(tableId))
      .map((g) => g.id);
    if (collapsedHiding.length > 0) {
      s.setCollapsedGroups(s.collapsedGroupIds.filter((id) => !collapsedHiding.includes(id)));
    }
    centerOnTable(tableId); // centers at the current zoom + flashes the focus outline
    onClose();
  };

  return (
    <div className="qs-backdrop" onPointerDown={onClose}>
      <div className="qs-panel" onPointerDown={(e) => e.stopPropagation()}>
        <input
          className="qs-input"
          autoFocus
          placeholder="Jump to table…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((v) => Math.min(v + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter' && matches[sel]) choose(matches[sel].id);
          }}
        />
        <ul className="qs-list">
          {matches.map((t, i) => (
            <li key={t.id}>
              <button className={i === sel ? 'qs-item active' : 'qs-item'} onClick={() => choose(t.id)}>
                <span className="qs-name">{t.name}</span>
                <span className="qs-schema">{t.schemaName}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="qs-empty">No tables match.</li>}
        </ul>
      </div>
    </div>
  );
}
