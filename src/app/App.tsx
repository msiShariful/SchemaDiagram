import { useState } from 'react';
import { DbmlEditor } from '../editor/DbmlEditor';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { useParsePipeline } from './useParsePipeline';
import { useAppStore } from './store';
import { DiagramManager } from './DiagramManager';
import { usePersistence } from './usePersistence';
import { SplitPane } from './SplitPane';
import { ProblemsPanel } from './ProblemsPanel';
import { applyFormat } from '../editor/editorNav';
import { ExportMenu } from './ExportMenu';
import { ImportDialog } from './ImportDialog';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';

export function App() {
  useParsePipeline();
  usePersistence();
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const storageUnavailable = useAppStore((s) => s.storageUnavailable);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <span className="brand">DBDraft</span>
        <DiagramManager />
        <button onClick={() => setImportOpen(true)}>Import</button>
        <button
          className="format-button"
          disabled={stale || errors.length > 0}
          title="Format document (Ctrl/Cmd-Shift-F)"
          onClick={() => applyFormat()}
        >
          Format
        </button>
        <ExportMenu />
        {stale && <span className="badge stale">diagram out of date</span>}
      </header>
      {storageUnavailable && (
        <div className="banner-warning">
          <span>Browser storage is unavailable — your work is NOT being saved. Keep this tab open.</span>
          <button
            className="banner-action"
            onClick={() => {
              const s = useAppStore.getState();
              downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
            }}
          >
            Download your work (.dbml)
          </button>
        </div>
      )}
      <SplitPane left={<DbmlEditor />} right={<DiagramCanvas />} />
      <ProblemsPanel />
      <footer className="statusbar">
        <span className={errors.length ? 'status-errors' : 'status-ok'}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : '✓ parsed'}
        </span>
        <span className="status-dim">{tableCount} tables</span>
      </footer>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
