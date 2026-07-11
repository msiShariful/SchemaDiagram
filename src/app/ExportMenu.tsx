import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { exportSql, type SqlDialect } from '../core/convert/convert';
import { serializeProject } from '../core/convert/projectFile';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';

const SQL_DIALECTS: Array<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgres', label: 'PostgreSQL' },
  { dialect: 'mysql', label: 'MySQL' },
  { dialect: 'mssql', label: 'SQL Server' },
];

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const sqlDisabled = stale || errors.length > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const exportDbml = () => {
    const s = useAppStore.getState();
    downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
    setOpen(false);
  };

  const exportProject = () => {
    const s = useAppStore.getState();
    downloadText(
      serializeProject({ name: s.diagramName, dbml: s.source, positions: s.positions, viewport: s.viewport }),
      `${safeFilename(s.diagramName)}.json`,
      'application/json',
    );
    setOpen(false);
  };

  const exportAsSql = async (dialect: SqlDialect) => {
    const s = useAppStore.getState();
    const r = await exportSql(s.source, dialect);
    if (r.ok) downloadText(r.text, `${safeFilename(s.diagramName)}.${dialect}.sql`);
    else window.alert(`SQL export failed: ${r.errors[0]?.message ?? 'unknown error'}`);
    setOpen(false);
  };

  return (
    <div className="export-menu">
      <button onClick={() => setOpen((v) => !v)}>{open ? '▲' : '▼'} export</button>
      {open && (
        <ul className="export-list">
          <li><button onClick={exportDbml}>DBML (.dbml)</button></li>
          {SQL_DIALECTS.map(({ dialect, label }) => (
            <li key={dialect}>
              <button
                disabled={sqlDisabled}
                title={sqlDisabled ? 'Fix parse errors first' : undefined}
                onClick={() => void exportAsSql(dialect)}
              >
                SQL — {label}
              </button>
            </li>
          ))}
          <li><button onClick={exportProject}>Project file (.json)</button></li>
        </ul>
      )}
    </div>
  );
}
