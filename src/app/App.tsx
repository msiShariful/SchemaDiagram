import { DbmlEditor } from '../editor/DbmlEditor';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { useParsePipeline } from './useParsePipeline';
import { useAppStore } from './store';
import { DiagramManager } from './DiagramManager';
import { usePersistence } from './usePersistence';

export function App() {
  useParsePipeline();
  usePersistence();
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const storageUnavailable = useAppStore((s) => s.storageUnavailable);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <span className="brand">DBDraft</span>
        <DiagramManager />
        {stale && <span className="badge stale">diagram out of date</span>}
      </header>
      {storageUnavailable && (
        <div className="banner-warning">
          Browser storage is unavailable — your work is NOT being saved. Keep this tab open.
        </div>
      )}
      <main className="workspace">
        <section className="editor-pane">
          <DbmlEditor />
        </section>
        <div className="divider" />
        <section className="canvas-pane">
          <DiagramCanvas />
        </section>
      </main>
      <footer className="statusbar">
        <span className={errors.length ? 'status-errors' : 'status-ok'}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : '✓ parsed'}
        </span>
        <span className="status-dim">{tableCount} tables</span>
      </footer>
    </div>
  );
}
