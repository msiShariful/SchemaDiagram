import { memo, useRef } from 'react';
import type { StickyNote, TablePosition } from '../core/model/types';
import { NOTE_WIDTH, NOTE_HEIGHT } from '../core/model/geometry';
import { DRAG_THRESHOLD_PX } from './snap';

interface Props {
  note: StickyNote;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  // Canvas-level ledger of the in-flight note drag (note id or null) so the
  // culling pass can keep the drag anchor mounted — mirrors the table path's
  // dragRef. A ref, never state: written on the imperative drag path.
  dragLedger: React.RefObject<string | null>;
  onCommitMove: (id: string, before: TablePosition, after: TablePosition) => void;
}

export const NoteNode = memo(function NoteNode({ note, pos, zoomRef, dragLedger, onCommitMove }: Props) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    orig: TablePosition;
    live: TablePosition;
    moved: boolean; // raw pointer travel exceeded DRAG_THRESHOLD_PX (parity with tables)
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, orig: pos, live: pos, moved: false };
    dragLedger.current = note.id;
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      // Click jitter guard, same 3 px screen threshold as table drags:
      // don't write a transform (or later a commit) for a plain click.
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
    }
    const zoom = zoomRef.current ?? 1;
    d.live = {
      x: d.orig.x + (e.clientX - d.startX) / zoom,
      y: d.orig.y + (e.clientY - d.startY) / zoom,
    };
    gRef.current?.setAttribute('transform', `translate(${d.live.x}, ${d.live.y})`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    dragLedger.current = null;
    if (!d.moved) return; // click, not a drag — nothing to commit
    onCommitMove(note.id, d.orig, d.live);
  };

  return (
    <g
      ref={gRef}
      transform={`translate(${pos.x}, ${pos.y})`}
      className="sticky-note"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <rect width={NOTE_WIDTH} height={NOTE_HEIGHT} rx={4} className="note-body" />
      <text x={10} y={16} className="note-title">{note.name}</text>
      <foreignObject x={8} y={26} width={NOTE_WIDTH - 16} height={NOTE_HEIGHT - 34}>
        <div className="note-content">{note.content}</div>
      </foreignObject>
    </g>
  );
});
