import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { applyStickyNote } from '../editor/editorNav';
import { useOverlayEscape } from '../app/overlayStack';
import { NOTE_WIDTH } from '../core/model/geometry';

/** Sticky-note content editor (canvas→text bridge consumer): double-click a
 *  note to edit its text. Multi-line is fine — the rewriter emits '''…'''.
 *  Refusals (text containing ''' plus a newline, backslashes, vanished
 *  block) show honest copy; the note text is never mangled. */
export function NoteEditPopover({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const viewport = useAppStore((s) => s.viewport);
  const pos = useAppStore((s) => s.notePositions[noteId]);
  const note = useAppStore((s) => s.schema.notes.find((n) => n.id === noteId));
  const [text, setText] = useState(note?.content ?? '');
  const [err, setErr] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useOverlayEscape(true, onClose);
  useEffect(() => {
    areaRef.current?.focus();
    areaRef.current?.select();
  }, []);
  useEffect(() => {
    if (!note || !pos) onClose(); // parse removed it mid-edit
  }, [note, pos, onClose]);

  if (!note || !pos) return null;

  const save = () => {
    if (applyStickyNote(note.name, text)) onClose();
    else setErr("Couldn't rewrite this note — avoid ''' together with multiple lines, and backslashes.");
  };

  return (
    <div
      className="note-edit-pop"
      style={{
        left: viewport.x + (pos.x + NOTE_WIDTH) * viewport.zoom + 10,
        top: viewport.y + pos.y * viewport.zoom,
      }}
    >
      <div className="fnp-title">Edit note — {note.name}</div>
      <textarea
        ref={areaRef}
        className="nep-area"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      <div className="fnp-actions">
        <button className="fnp-save" onClick={save}>Save</button>
        <button onClick={onClose}>Cancel</button>
        <span className="nep-hint">Ctrl/Cmd + Enter saves</span>
      </div>
      {err && <div className="fnp-error">{err}</div>}
    </div>
  );
}
