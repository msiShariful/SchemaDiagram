import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import type { LodOverride } from './lod';
import { useOverlayEscape } from '../app/overlayStack';

// The app's REAL shortcuts (see DiagramCanvas keyboard effect + the editor
// keymap) — a static list, updated by hand when a shortcut changes.
const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/Cmd + Z', 'Undo canvas move'],
  ['Shift + Ctrl/Cmd + Z (or Ctrl/Cmd + Y)', 'Redo canvas move'],
  ['Ctrl/Cmd + Shift + F', 'Format DBML'],
  ['Ctrl/Cmd + K', 'Find table'],
  ['Space + drag / middle-drag', 'Pan the canvas'],
  ['Double-click a table', 'Reveal it in the editor'],
  ['Escape', 'Clear selection'],
];

/** Bottom-left control cluster (Feature E). snapEnabled/lodOverride are
 *  SESSION state: not persisted, untouched by diagram switches (documented
 *  plan choice — workbench preferences, not document state). */
export function CanvasControls({ onOpenSearch }: { onOpenSearch: () => void }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const snapEnabled = useAppStore((s) => s.snapEnabled);
  const setSnapEnabled = useAppStore((s) => s.setSnapEnabled);
  const lodOverride = useAppStore((s) => s.lodOverride);
  const setLodOverride = useAppStore((s) => s.setLodOverride);
  const traceEnabled = useAppStore((s) => s.traceEnabled);
  const setTraceEnabled = useAppStore((s) => s.setTraceEnabled);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useOverlayEscape(shortcutsOpen, () => setShortcutsOpen(false));

  useEffect(() => {
    if (!shortcutsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setShortcutsOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointerdown', onDown);
    };
  }, [shortcutsOpen]);

  return (
    <div className="canvas-controls" ref={rootRef}>
      <button aria-label="Find table" title="Find table (Ctrl/Cmd+K)" onClick={onOpenSearch}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        onClick={() => setShortcutsOpen((v) => !v)}
      >
        ?
      </button>
      <button
        aria-pressed={snapEnabled}
        className={snapEnabled ? 'active' : ''}
        aria-label="Toggle snap"
        title={snapEnabled ? 'Snap to grid/guides: on' : 'Snap to grid/guides: off'}
        onClick={() => setSnapEnabled(!snapEnabled)}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M1 5.5h14M1 10.5h14M5.5 1v14M10.5 1v14" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
      <button
        aria-pressed={traceEnabled}
        className={traceEnabled ? 'active' : ''}
        aria-label="Toggle highlight mode"
        title={traceEnabled ? 'Highlight mode: on — click a table to trace its refs' : 'Highlight mode: off'}
        onClick={() => setTraceEnabled(!traceEnabled)}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      <label className="lod-select">
        Detail
        <select value={lodOverride} onChange={(e) => setLodOverride(e.target.value as LodOverride)}>
          <option value="auto">Auto</option>
          <option value="full">Full</option>
          <option value="headers">Headers</option>
          <option value="boxes">Boxes</option>
        </select>
      </label>
      {shortcutsOpen && (
        <div className="shortcuts-pop">
          <div className="shortcuts-title">Keyboard shortcuts</div>
          <dl>
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="shortcuts-row">
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
