import { useEffect, useState } from 'react';
import { useHoverMenu } from './useHoverMenu';
import { useAppStore } from './store';
import { listSnapshots } from '../core/persist/repository';
import type { DiagramSnapshot } from '../core/persist/repository';
import { restoreSnapshot } from './usePersistence';

export function HistoryPanel() {
  const diagramId = useAppStore((s) => s.diagramId);
  const menu = useHoverMenu();
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
    if (menu.open && diagramId) refresh(diagramId);
  }, [menu.open, diagramId]);

  const restore = (snap: DiagramSnapshot) => {
    // restoreSnapshot keeps the diagram id, so refreshing with the captured
    // id is safe; the pre-restore checkpoint shows up at the top of the list.
    setBusy(true);
    void restoreSnapshot(snap)
      .then(() => refresh(snap.diagramId))
      .finally(() => setBusy(false));
  };

  return (
    <div className="history-wrap" ref={menu.rootRef} {...menu.rootProps}>
      <button onClick={menu.toggle}>{menu.open ? '▲' : '▼'} history</button>
      {menu.open && (
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
