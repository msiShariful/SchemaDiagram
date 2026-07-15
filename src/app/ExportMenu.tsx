import { useAppStore } from './store';
import { useHoverMenu } from './useHoverMenu';
import { exportSql, type SqlDialect } from '../core/convert/convert';
import { serializeProject } from '../core/convert/projectFile';
import { downloadBlob, downloadText } from './export/download';
import { safeFilename } from './export/exportCss';
import { buildDiagramSvg, buildPngBlob } from './export/svgExport';
import { effectiveHiddenIds } from '../core/model/visibility';

const SQL_DIALECTS: Array<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgres', label: 'PostgreSQL' },
  { dialect: 'mysql', label: 'MySQL' },
  { dialect: 'mssql', label: 'SQL Server' },
  { dialect: 'oracle', label: 'Oracle' },
];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function ExportMenu() {
  const menu = useHoverMenu();
  const stale = useAppStore((s) => s.stale);
  const errors = useAppStore((s) => s.errors);
  const schema = useAppStore((s) => s.schema);
  const tableCount = useAppStore((s) => s.schema.tables.length);
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const hiddenCount = effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds).length;
  const sqlDisabled = stale || errors.length > 0;
  // Gate on VISIBLE tables, not total: with every table hidden, SVG would
  // silently no-op and PNG would alert a misleading "canvas too small" error.
  const imageDisabled = tableCount - hiddenCount <= 0;

  const exportDbml = () => {
    const s = useAppStore.getState();
    downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
    menu.close();
  };

  const exportProject = () => {
    const s = useAppStore.getState();
    downloadText(
      serializeProject({
        name: s.diagramName, dbml: s.source, positions: s.positions,
        notePositions: s.notePositions, noteColors: s.noteColors, noteSizes: s.noteSizes, hiddenTableIds: s.hiddenTableIds,
        collapsedGroupIds: s.collapsedGroupIds, viewport: s.viewport,
      }),
      `${safeFilename(s.diagramName)}.json`,
      'application/json',
    );
    menu.close();
  };

  const exportAsSql = async (dialect: SqlDialect) => {
    const s = useAppStore.getState();
    const r = await exportSql(s.source, dialect);
    if (r.ok) downloadText(r.text, `${safeFilename(s.diagramName)}.${dialect}.sql`);
    else window.alert(`SQL export failed: ${r.errors[0]?.message ?? 'unknown error'}`);
    menu.close();
  };

  const exportSvgFile = () => {
    const built = buildDiagramSvg();
    if (built) {
      const name = useAppStore.getState().diagramName;
      downloadBlob(new Blob([built.markup], { type: 'image/svg+xml' }), `${safeFilename(name)}.svg`);
    }
    menu.close();
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
    menu.close();
  };

  const exportPdf = () => {
    // Print-to-PDF (Feature G): no library — a popup window with the export
    // SVG and print CSS; the user picks "Save as PDF" in the dialog. The SVG
    // markup is our own serialization (svgExport); only the user-controlled
    // diagram name needs escaping.
    const built = buildDiagramSvg();
    if (built) {
      const win = window.open('', '_blank');
      if (!win) {
        window.alert('Pop-up blocked — allow pop-ups for this site to print to PDF.');
        menu.close();
        return;
      }
      win.document.write(
        `<!doctype html><html><head><title>${escapeHtml(useAppStore.getState().diagramName)}</title>` +
        `<style>body{margin:0}svg{max-width:100%;height:auto}@page{margin:10mm}</style>` +
        `</head><body>${built.markup}</body></html>`,
      );
      win.document.close();
      win.focus();
      win.print(); // document.write parses synchronously — content is ready
    }
    menu.close();
  };

  return (
    <div className="export-menu" ref={menu.rootRef} {...menu.rootProps}>
      <button onClick={menu.toggle}>{menu.open ? '▲' : '▼'} export</button>
      {menu.open && (
        <ul className="menu-list">
          <li className="menu-group">Document</li>
          <li><button onClick={exportDbml}>DBML (.dbml)</button></li>
          <li><button onClick={exportProject}>Project file (.json)</button></li>
          <li><button disabled={imageDisabled} onClick={() => void exportPngFile()}>PNG (2x)</button></li>
          <li><button disabled={imageDisabled} onClick={exportSvgFile}>SVG (.svg)</button></li>
          <li><button disabled={imageDisabled} onClick={exportPdf}>To PDF (print)</button></li>
          <li className="menu-sep" role="separator" />
          <li className="menu-group">SQL</li>
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
        </ul>
      )}
    </div>
  );
}
