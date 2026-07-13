import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listDiagrams } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import {
  switchDiagram, createDiagram, removeDiagram, renameDiagramById, duplicateDiagramById,
} from './usePersistence';
import { formatDiagramDate } from './relativeDate';
import { useOverlayEscape } from './overlayStack';

interface Props {
  onClose: () => void;
}

/** dbdiagram-style project dashboard (Feature C). Fetches the list on open;
 *  every mutation routes through the existing usePersistence flows (which own
 *  the autosave-invalidation race discipline) and then re-fetches. */
export function DiagramDashboard({ onClose }: Props) {
  const diagramId = useAppStore((s) => s.diagramId);
  const [items, setItems] = useState<PersistedDiagram[]>([]);
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listDiagrams().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, diagramId]);

  useOverlayEscape(true, onClose); // the dashboard exists only while open

  // P6 deferred item: the row kebab had no outside-click dismissal. Class-
  // based containment check — rows are mapped, a per-row ref would be noise.
  useEffect(() => {
    if (menuId === null) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('.dash-menu') && !el?.closest?.('.dash-kebab')) setMenuId(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuId]);

  const commitRename = (id: string, value: string) => {
    setRenamingId(null);
    void renameDiagramById(id, value).then(refresh);
  };

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((d) => d.name.toLowerCase().includes(q)) : items;

  return (
    <div className="dash-backdrop" onClick={onClose}>
      <div className="dashboard" onClick={(e) => e.stopPropagation()}>
        <aside className="dash-rail">
          <button className="dash-new" onClick={() => void createDiagram().then(onClose)}>
            New Diagram
          </button>
          <div className="dash-rail-label">My Diagrams</div>
        </aside>
        <main className="dash-main">
          <div className="dash-topbar">
            <input
              className="dash-search"
              placeholder="Search diagrams…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="dash-close" aria-label="Close" onClick={onClose}>✕</button>
          </div>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date Modified</th>
                <th>Date Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr
                  key={d.id}
                  className={`dash-row${d.id === diagramId ? ' current' : ''}`}
                  onClick={() => void switchDiagram(d.id).then(onClose)}
                >
                  <td className="dash-name">
                    {renamingId === d.id ? (
                      <input
                        autoFocus
                        defaultValue={d.name}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => setRenamingId(null)}
                        onKeyDown={(e) => {
                          e.stopPropagation(); // Escape cancels the rename, not the dashboard
                          if (e.key === 'Enter') commitRename(d.id, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                      />
                    ) : (
                      d.name
                    )}
                  </td>
                  <td className="dash-modified">{formatDiagramDate(d.updatedAt)}</td>
                  <td className="dash-created">
                    {d.createdAt !== undefined ? formatDiagramDate(d.createdAt) : '—'}
                  </td>
                  <td className="dash-actions" onClick={(e) => e.stopPropagation()}>
                    {confirmingId === d.id ? (
                      <>
                        <button
                          className="danger"
                          onClick={() => {
                            setConfirmingId(null);
                            void removeDiagram(d.id).then(refresh);
                          }}
                        >
                          confirm ✓
                        </button>
                        <button onClick={() => setConfirmingId(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="dash-kebab"
                          aria-label="Row actions"
                          onClick={() => {
                            setConfirmingId(null);
                            setMenuId(menuId === d.id ? null : d.id);
                          }}
                        >
                          ⋮
                        </button>
                        {menuId === d.id && (
                          <div className="dash-menu">
                            <button onClick={() => void switchDiagram(d.id).then(onClose)}>Open</button>
                            <button onClick={() => { setMenuId(null); setRenamingId(d.id); }}>Rename</button>
                            <button onClick={() => { setMenuId(null); void duplicateDiagramById(d.id).then(refresh); }}>
                              Duplicate
                            </button>
                            <button className="danger" onClick={() => { setMenuId(null); setConfirmingId(d.id); }}>
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td className="dash-empty" colSpan={4}>No diagrams match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
}
