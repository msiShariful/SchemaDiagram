import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { applyFieldNote, revealTable } from '../editor/editorNav';
import { useOverlayEscape } from '../app/overlayStack';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT } from '../core/model/geometry';

/** Field-note editor (canvas→text bridge consumer). Single-line input —
 *  inline [note: '…'] settings are one-line DBML; the rewriter refuses
 *  newlines anyway. Refusals show honest copy + a Reveal jump, never a
 *  silent mangle (EdgeRefPopover precedent). */
export function FieldNotePopover({
  tableId,
  fieldName,
  onClose,
}: {
  tableId: string;
  fieldName: string;
  onClose: () => void;
}) {
  const viewport = useAppStore((s) => s.viewport);
  const pos = useAppStore((s) => s.positions[tableId]);
  const table = useAppStore((s) => s.schema.tables.find((t) => t.id === tableId));
  const field = table?.fields.find((f) => f.name === fieldName);
  const [text, setText] = useState(field?.note ?? '');
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useOverlayEscape(true, onClose);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  // Vanish if a parse removed the table/field mid-edit (EdgeRefPopover precedent).
  useEffect(() => {
    if (!table || !field) onClose();
  }, [table, field, onClose]);

  if (!table || !field || !pos) return null;

  const rowIndex = table.fields.findIndex((f) => f.name === fieldName);
  const save = () => {
    const next = text.trim();
    const ok = applyFieldNote(tableId, fieldName, next === '' ? null : next);
    if (ok) onClose();
    else setErr("Couldn't edit this field's DBML — its layout is unusual. Edit it in the editor.");
  };

  return (
    <div
      className="field-note-pop"
      style={{
        left: viewport.x + (pos.x + TABLE_WIDTH) * viewport.zoom + 10,
        top: viewport.y + (pos.y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT) * viewport.zoom,
      }}
    >
      <div className="fnp-title">
        Note — {fieldName}
      </div>
      <input
        ref={inputRef}
        className="fnp-input"
        placeholder="Field note (shown in the row tooltip)"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
      />
      <div className="fnp-actions">
        <button className="fnp-save" onClick={save}>Save</button>
        {field.note !== null && (
          <button
            onClick={() => {
              if (applyFieldNote(tableId, fieldName, null)) onClose();
              else setErr("Couldn't edit this field's DBML — its layout is unusual. Edit it in the editor.");
            }}
          >
            Remove note
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
      </div>
      {err && (
        <div className="fnp-error">
          {err}{' '}
          <button
            className="fnp-reveal"
            onClick={() => {
              revealTable(tableId);
              onClose();
            }}
          >
            Reveal
          </button>
        </div>
      )}
    </div>
  );
}
