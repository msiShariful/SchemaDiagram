import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { applyTableSettings } from '../editor/editorNav';
import { HEX_COLOR_RE } from '../editor/tableSettings';
import { TABLE_WIDTH } from '../core/model/geometry';

export const HEADER_SWATCHES: readonly string[] = [
  '#2196f3', '#f44336', '#4caf50', '#ff9800', '#9c27b0', '#009688',
  '#34495e', '#e74c3c', '#d35400', '#16a085', '#2980b9', '#8e44ad',
  '#2c3e50', '#f1c40f', '#e67e22', '#7f8c8d', '#c0392b', '#e91e63',
]; // 18 swatches, dbdiagram-like (Feature B)

interface Props {
  tableId: string;
  onClose: () => void;
}

/** Single popover host in DiagramCanvas's HTML layer (Feature B). CRITICAL
 *  architecture rule: every mutation routes through applyTableSettings — a
 *  TEXT edit via editorNav (one CodeMirror transaction; editor history owns
 *  undo; the parse pipeline repaints ~300 ms later). This component never
 *  writes schema state. Positioned from the COMMITTED viewport: during an
 *  imperative pan it holds still until the gesture-end commit (accepted). */
export function TableSettingsPopover({ tableId, onClose }: Props) {
  const table = useAppStore((s) => s.schema.tables.find((t) => t.id === tableId));
  const pos = useAppStore((s) => s.positions[tableId]);
  const viewport = useAppStore((s) => s.viewport);
  const [name, setName] = useState(() => table?.name ?? '');
  const [hex, setHex] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The table can vanish under us: parse deleted it, the diagram switched,
  // or our own rename changed its id. Close instead of orphaning.
  useEffect(() => {
    if (!table || !pos) onClose();
  }, [table, pos, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  if (!table || !pos) return null;

  const setColor = (color: string | null) => {
    setErr(applyTableSettings(tableId, { headerColor: color }) ? null : 'Could not edit this table header.');
  };
  const rename = () => {
    const next = name.trim();
    if (next === '' || next === table.name) return;
    if (applyTableSettings(tableId, { name: next })) onClose(); // id changed — this popover is stale
    else setErr('Could not rename — try editing the DBML directly.');
  };
  const applyHex = () => {
    const value = (hex.startsWith('#') ? hex : `#${hex}`).toLowerCase();
    if (!HEX_COLOR_RE.test(value)) {
      setErr('Hex color must be #RRGGBB.');
      return;
    }
    setColor(value);
  };

  return (
    <div
      ref={rootRef}
      className="table-settings"
      style={{
        left: viewport.x + (pos.x + TABLE_WIDTH) * viewport.zoom + 10,
        top: viewport.y + pos.y * viewport.zoom,
      }}
    >
      <label className="ts-label">
        Table Name
        <input
          className="ts-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename();
          }}
        />
      </label>
      <button className="ts-rename" onClick={rename}>Rename</button>
      <div className="ts-label">Header Color</div>
      <div className="ts-swatches">
        {HEADER_SWATCHES.map((c) => (
          <button
            key={c}
            className={`swatch${table.headerColor?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
            data-color={c}
            style={{ background: c }}
            title={c}
            aria-label={`Set header color ${c}`}
            onClick={() => setColor(c)}
          />
        ))}
        <button className="swatch none" title="Clear color" aria-label="Clear header color" onClick={() => setColor(null)}>
          ✕
        </button>
      </div>
      <div className="ts-hex-row">
        <input
          className="ts-hex"
          placeholder="#a1b2c3"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyHex();
          }}
        />
        <button onClick={applyHex}>Set</button>
      </div>
      {err && <div className="ts-error">{err}</div>}
    </div>
  );
}
