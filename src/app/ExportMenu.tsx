import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { exportSql, type SqlDialect } from '../core/convert/convert';
import { serializeProject } from '../core/convert/projectFile';
import { downloadBlob, downloadText } from './export/download';
import { safeFilename } from './export/exportCss';
import { buildDiagramSvg, buildPngBlob } from './export/svgExport';

const SQL_DIALECTS: Array<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgres', label: 'PostgreSQL' },
  { dialect: 'mysql', label: 'MySQL' },
  { dialect: 'mssql', label: 'SQL Server' },
];

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const sqlDisabled = stale || errors.length > 0;
  const imageDisabled = tableCount === 0;

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
      serializeProject({
        name: s.diagramName, dbml: s.source, positions: s.positions,
        notePositions: s.notePositions, hiddenTableIds: s.hiddenTableIds, viewport: s.viewport,
      }),
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

  const exportSvgFile = () => {
    const built = buildDiagramSvg();
    if (built) {
      const name = useAppStore.getState().diagramName;
      downloadBlob(new Blob([built.markup], { type: 'image/svg+xml' }), `${safeFilename(name)}.svg`);
    }
    setOpen(false);
  };

  const exportPngFile = async () => {
    // Same alert pattern as SQL export: rasterization can reject
    // (img.onerror) and toBlob can yield null when the 2x canvas exceeds
    // the browser's size limit (~120+ tables) — neither may surface as an
    // unhandled rejection or a silent no-op.
    try {
      const blob = await buildPngBlob(2);
      if (!blob) throw new Error('canvas too large or rasterization failed');
      const name = useAppStore.getState().diagramName;
      downloadBlob(blob, `${safeFilename(name)}.png`);
    } catch (e) {
      window.alert(`PNG export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
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
          <li><button disabled={imageDisabled} onClick={exportSvgFile}>SVG (.svg)</button></li>
          <li><button disabled={imageDisabled} onClick={() => void exportPngFile()}>PNG (2x)</button></li>
          <li><button onClick={exportProject}>Project file (.json)</button></li>
        </ul>
      )}
    </div>
  );
}
