import { useState } from 'react';
import { useAppStore } from './store';
import { revealPosition } from '../editor/editorNav';

export function ProblemsPanel() {
  const errors = useAppStore((s) => s.errors);
  const [open, setOpen] = useState(true);
  if (errors.length === 0) return null;
  return (
    <div className="problems-panel">
      <button className="problems-header" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {errors.length} problem{errors.length > 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="problems-list">
          {errors.map((e, i) => (
            <li key={`${e.line}:${e.column}:${i}`}>
              <button onClick={() => revealPosition(e.line, e.column)}>
                <span className="problem-loc">{e.line}:{e.column}</span> {e.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
