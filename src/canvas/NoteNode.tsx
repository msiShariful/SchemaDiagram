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
  color: string | null; // stored tint (noteColors) — null = theme default
  onSetColor: (id: string, color: string | null) => void; // stable store action (memo contract)
  onEditNote: (id: string) => void; // stable (memo contract) — double-click opens the content editor
}

/** dbdiagram-ish sticky palette: pastel fill + matching darker border.
 *  The stored value is the FILL hex; border/text derive by lookup (an
 *  unknown hex from a hand-edited project file falls back to theme border). */
export const NOTE_SWATCHES: Array<{ bg: string; border: string }> = [
  { bg: '#fff8c5', border: '#d8c96f' }, // yellow (theme default look)
  { bg: '#ffe0b3', border: '#e0a85f' }, // orange
  { bg: '#d3f2d9', border: '#7fbf8c' }, // green
  { bg: '#cfe5ff', border: '#7fa8dd' }, // blue
  { bg: '#e6d9f7', border: '#a88bd4' }, // purple
  { bg: '#ffd6e4', border: '#dd8aa8' }, // pink
  { bg: '#e8eaee', border: '#a9b0bb' }, // gray
];

export const NoteNode = memo(function NoteNode({ note, pos, zoomRef, dragLedger, onCommitMove, color, onSetColor, onEditNote }: Props) {
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

  const swatch = color !== null ? NOTE_SWATCHES.find((s) => s.bg === color) : undefined;
  return (
    <g
      ref={gRef}
      transform={`translate(${pos.x}, ${pos.y})`}
      className={`sticky-note${color !== null ? ' colored' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={() => onEditNote(note.id)}
    >
      <rect
        width={NOTE_WIDTH}
        height={NOTE_HEIGHT}
        rx={4}
        className="note-body"
        // inline STYLE, not fill/stroke attributes: the .note-body CSS rule
        // would beat presentation attributes (cascade), on canvas and export
        style={color !== null ? { fill: color, stroke: swatch?.border ?? 'var(--note-border)' } : undefined}
      />
      <text x={10} y={16} className="note-title">{note.name}</text>
      <foreignObject x={8} y={26} width={NOTE_WIDTH - 16} height={NOTE_HEIGHT - 34}>
        <div className="note-content">{note.content}</div>
      </foreignObject>
      {/* Hover palette (dbdiagram parity). pointerdown stops propagation so a
          swatch click never starts a note drag; hidden in exports via
          EXPORT_CSS (display:none). */}
      <g className="note-swatches" onPointerDown={(e) => e.stopPropagation()}>
        {NOTE_SWATCHES.map((s, i) => (
          <circle
            key={s.bg}
            cx={12 + i * 15}
            cy={NOTE_HEIGHT - 11}
            r={5.5}
            fill={s.bg}
            stroke={color === s.bg ? 'var(--accent)' : s.border}
            strokeWidth={color === s.bg ? 2 : 1}
            onClick={() => onSetColor(note.id, s.bg)}
          >
            <title>Set note color</title>
          </circle>
        ))}
        <g className="note-swatch-reset" onClick={() => onSetColor(note.id, null)}>
          <circle cx={12 + NOTE_SWATCHES.length * 15} cy={NOTE_HEIGHT - 11} r={5.5} />
          <text x={12 + NOTE_SWATCHES.length * 15} y={NOTE_HEIGHT - 11} textAnchor="middle" dominantBaseline="central">✕</text>
          <title>Reset to default</title>
        </g>
      </g>
    </g>
  );
});
