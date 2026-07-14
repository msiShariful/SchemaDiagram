import { useEffect, useRef, useState } from 'react';
import { useAppStore, getCanvasStack } from '../app/store';
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
  const panMode = useAppStore((s) => s.panMode);
  const setPanMode = useAppStore((s) => s.setPanMode);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Toolbar undo/redo (Feature F). The stack is module-level (not store
  // state) by design; canvasStackVersion is its change counter — bumped only
  // inside the existing commit/undo/redo/load set() calls, so this component
  // re-renders at gesture end, never per drag tick (perf contract).
  const stackVersion = useAppStore((s) => s.canvasStackVersion);
  void stackVersion; // the subscription IS the point — canUndo/canRedo below re-read on each bump
  const stack = getCanvasStack();

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
      <button aria-label="Find table" data-tip="Find table (Ctrl/Cmd + K)" onClick={onOpenSearch}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        aria-label="Keyboard shortcuts"
        data-tip="Keyboard shortcuts"
        onClick={() => setShortcutsOpen((v) => !v)}
      >
        ?
      </button>
      <button
        aria-pressed={snapEnabled}
        className={snapEnabled ? 'active' : ''}
        aria-label="Toggle snap"
        data-tip={snapEnabled ? 'Snap to grid/guides: on' : 'Snap to grid/guides: off'}
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
        data-tip={traceEnabled
          ? 'Highlight mode: on — click a table\nto trace its refs'
          : 'Click to enable highlight mode'}
        onClick={() => setTraceEnabled(!traceEnabled)}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      <button
        aria-pressed={panMode}
        className={panMode ? 'active' : ''}
        aria-label="Toggle pan mode"
        data-tip={panMode
          ? 'Pan mode: on — drag anywhere to pan'
          : 'Click to enable pan mode\nOr hold Space/Middle mouse + drag to pan'}
        onClick={() => setPanMode(!panMode)}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M5.2 8V3.6a.9.9 0 0 1 1.8 0V7M7 7V2.4a.9.9 0 0 1 1.8 0V7m0 .2V3.1a.9.9 0 0 1 1.8 0v4.6m0 .1V5.4a.9.9 0 0 1 1.8 0v4.1c0 2.9-1.9 5-4.6 5-2.2 0-3.3-1.1-4-2.7L2.7 9.3a.95.95 0 0 1 1.6-1l.9 1.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        aria-label="Undo canvas move"
        data-tip={'Undo canvas move\nCtrl/Cmd + Z'}
        disabled={!stack.canUndo()}
        onClick={() => useAppStore.getState().undoCanvas()}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M6 3L2 7l4 4M2 7h8a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        aria-label="Redo canvas move"
        data-tip={'Redo canvas move\nShift + Ctrl/Cmd + Z'}
        disabled={!stack.canRedo()}
        onClick={() => useAppStore.getState().redoCanvas()}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M10 3l4 4-4 4M14 7H6a4 4 0 0 0 0 8h3" fill="none" stroke="currentColor" strokeWidth="1.4" />
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
