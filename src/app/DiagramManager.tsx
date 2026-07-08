import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listDiagrams } from '../core/persist/repository';
import type { PersistedDiagram } from '../core/persist/repository';
import { switchDiagram, createDiagram, duplicateDiagram, removeDiagram, renameDiagram } from './usePersistence';

export function DiagramManager() {
  const diagramId = useAppStore((s) => s.diagramId);
  const diagramName = useAppStore((s) => s.diagramName);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PersistedDiagram[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  const refresh = () => {
    void listDiagrams().then(setItems).catch(() => setItems([]));
  };

  useEffect(() => {
    setConfirmingId(null); // an armed delete must not survive close/reopen or a diagram switch
    if (open) void listDiagrams().then(setItems).catch(() => setItems([]));
  }, [open, diagramId]);

  return (
    <div className="diagram-manager">
      {editingName ? (
        <input
          className="name-input"
          autoFocus
          defaultValue={diagramName}
          onBlur={(e) => { void renameDiagram(e.target.value).then(refresh); setEditingName(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      ) : (
        <button className="name-button" onClick={() => setEditingName(true)} title="Rename">
          {diagramName} ✎
        </button>
      )}
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} diagrams</button>
      <button onClick={() => void createDiagram()}>+ new</button>
      <button onClick={() => void duplicateDiagram()}>duplicate</button>
      {open && (
        <ul className="diagram-list">
          {items.map((d) => (
            <li key={d.id} className={d.id === diagramId ? 'current' : ''}>
              <button className="open-button" onClick={() => { void switchDiagram(d.id); setOpen(false); }}>
                {d.name}
              </button>
              <span className="when">{new Date(d.updatedAt).toLocaleString()}</span>
              {confirmingId === d.id ? (
                <>
                  <button className="danger" onClick={() => { void removeDiagram(d.id).then(refresh); setConfirmingId(null); }}>confirm ✓</button>
                  <button onClick={() => setConfirmingId(null)}>✕</button>
                </>
              ) : (
                <button onClick={() => setConfirmingId(d.id)}>delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
