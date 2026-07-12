import { useEffect, useState } from 'react';
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
import { HistoryPanel } from './HistoryPanel';
import { ImportDialog } from './ImportDialog';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';

const THEME_KEY = 'dbdraft.theme'; // keep in sync with the inline FOUC guard in index.html
type Theme = 'light' | 'dark';

// Best-effort persistence — the app must never break because localStorage
// is unavailable or full (same contract as SplitPane's readSplit/writeSplit).
function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function writeTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // ignore — theme just won't persist
  }
}

export function App() {
  useParsePipeline();
  usePersistence();
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeTheme(theme);
  }, [theme]);
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const storageUnavailable = useAppStore((s) => s.storageUnavailable);
  const parseCurrent = useAppStore((s) => s.parsedSource === s.source);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <span className="brand">DBDraft</span>
        <DiagramManager />
        <button onClick={() => setImportOpen(true)}>Import</button>
        <button
          className="format-button"
          disabled={stale || errors.length > 0 || !parseCurrent}
          title="Format document (Ctrl/Cmd-Shift-F)"
          onClick={() => applyFormat()}
        >
          Format
        </button>
        <ExportMenu />
        <HistoryPanel />
        <button
          className="theme-button"
          title="Toggle dark/light theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
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
      <SplitPane
        left={<DbmlEditor />}
        right={
          <CanvasErrorBoundary>
            <DiagramCanvas />
          </CanvasErrorBoundary>
        }
      />
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
