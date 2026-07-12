import { memo, useRef } from 'react';
import type { StickyNote, TablePosition } from '../core/model/types';
import { NOTE_WIDTH, NOTE_HEIGHT } from '../core/model/geometry';

interface Props {
  note: StickyNote;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  onCommitMove: (id: string, before: TablePosition, after: TablePosition) => void;
}

export const NoteNode = memo(function NoteNode({ note, pos, zoomRef, onCommitMove }: Props) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{ startX: number; startY: number; orig: TablePosition; live: TablePosition } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, orig: pos, live: pos };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
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
    >
      <rect width={NOTE_WIDTH} height={NOTE_HEIGHT} rx={4} className="note-body" />
      <text x={10} y={16} className="note-title">{note.name}</text>
      <foreignObject x={8} y={26} width={NOTE_WIDTH - 16} height={NOTE_HEIGHT - 34}>
        <div className="note-content">{note.content}</div>
      </foreignObject>
    </g>
  );
});
