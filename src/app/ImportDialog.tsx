import { useEffect, useState } from 'react';
import { importSql, type SqlDialect } from '../core/convert/convert';
import { parseProject } from '../core/convert/projectFile';
import { importDiagram } from './usePersistence';
import type { ParseError } from '../core/parse/parseDbml';

type ImportKind = SqlDialect | 'dbml' | 'project';

const KIND_OPTIONS: Array<{ kind: ImportKind; label: string }> = [
  { kind: 'postgres', label: 'PostgreSQL DDL' },
  { kind: 'mysql', label: 'MySQL DDL' },
  { kind: 'mssql', label: 'SQL Server DDL' },
  { kind: 'dbml', label: 'DBML' },
  { kind: 'project', label: 'Project file (.json)' },
];

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ImportKind>('postgres');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErrors([]);
    setFileName(f.name);
    try {
      setText(await f.text());
    } catch (e) {
      // File.text() can reject (file moved/deleted after picking, permission
      // revoked, decode failure) — surface it in the dialog instead of the
      // void'd promise swallowing it. No store/repo writes on this path.
      setErrors([{ message: `Could not read file: ${e instanceof Error ? e.message : String(e)}`, line: 1, column: 1 }]);
      return;
    }
    if (/\.dbml$/i.test(f.name)) setKind('dbml');
    else if (/\.json$/i.test(f.name)) setKind('project');
  };

  const baseName = (fallback: string) =>
    fileName ? fileName.replace(/\.[^.]+$/, '') : fallback;

  const runImport = async () => {
    setErrors([]);
    if (text.trim() === '') {
      setErrors([{ message: 'Nothing to import — paste text or choose a file.', line: 1, column: 1 }]);
      return;
    }
    setBusy(true);
    try {
      if (kind === 'dbml') {
        // No pre-validation: the user's file is imported verbatim; any syntax
        // errors surface in the editor + problems panel of the NEW diagram.
        await importDiagram({ name: baseName('Imported'), dbml: text });
      } else if (kind === 'project') {
        const r = parseProject(text);
        if (!r.ok) {
          setErrors([{ message: r.error, line: 1, column: 1 }]);
          return; // current diagram untouched
        }
        await importDiagram({
          name: r.project.name,
          dbml: r.project.dbml,
          positions: r.project.layout,
          viewport: r.project.viewport,
        });
      } else {
        const r = await importSql(text, kind);
        if (!r.ok) {
          setErrors(r.errors); // importer message with line context; current diagram untouched
          return;
        }
        await importDiagram({ name: baseName('Imported'), dbml: r.text });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Import — creates a new diagram</h3>
        <div className="dialog-row">
          <select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind}>{o.label}</option>
            ))}
          </select>
          <input
            type="file"
            accept=".sql,.dbml,.json,.txt"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        <textarea
          className="dialog-text"
          placeholder="Paste SQL DDL, DBML, or a project file here…"
          value={text}
          onChange={(e) => { setText(e.target.value); setErrors([]); }}
        />
        {errors.length > 0 && (
          <ul className="dialog-errors">
            {errors.map((er, i) => (
              <li key={`${er.line}:${er.column}:${i}`}>
                <span className="problem-loc">{er.line}:{er.column}</span> {er.message}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => void runImport()}>
            {busy ? 'Importing…' : 'Import as new diagram'}
          </button>
        </div>
      </div>
    </div>
  );
}
