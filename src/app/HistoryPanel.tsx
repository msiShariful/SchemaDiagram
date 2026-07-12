import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listSnapshots } from '../core/persist/repository';
import type { DiagramSnapshot } from '../core/persist/repository';
import { restoreSnapshot } from './usePersistence';

export function HistoryPanel() {
  const diagramId = useAppStore((s) => s.diagramId);
  const [open, setOpen] = useState(false);
  const [snaps, setSnaps] = useState<DiagramSnapshot[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = (id: string) => {
    // A fetch armed for a previous diagram can resolve AFTER the current
    // one (switch with the panel open) — drop any settlement whose id no
    // longer matches the live store instead of clobbering the list.
    const fresh = () => useAppStore.getState().diagramId === id;
    void listSnapshots(id).then(
      (rows) => { if (fresh()) setSnaps(rows); },
      () => { if (fresh()) setSnaps([]); },
    );
  };

  useEffect(() => {
    if (open && diagramId) refresh(diagramId);
  }, [open, diagramId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const restore = (snap: DiagramSnapshot) => {
    // restoreSnapshot keeps the diagram id, so refreshing with the captured
    // id is safe; the pre-restore checkpoint shows up at the top of the list.
    setBusy(true);
    void restoreSnapshot(snap)
      .then(() => refresh(snap.diagramId))
      .finally(() => setBusy(false));
  };

  return (
    <div className="history-wrap">
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} history</button>
      {open && (
        <div className="history-panel">
          <div className="history-header">Snapshots — newest first, last 20 kept</div>
          {snaps.length === 0 ? (
            <p className="history-empty">
              No snapshots yet. One is written on each autosave once the document parses cleanly.
            </p>
          ) : (
            <ul>
              {snaps.map((s) => (
                <li key={s.id}>
                  <span className="when">{new Date(s.takenAt).toLocaleString()}</span>
                  <span className="history-meta">{s.dbml.length} chars</span>
                  <button disabled={busy} onClick={() => restore(s)}>restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
