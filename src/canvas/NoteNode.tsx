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
  size: { w: number; h: number } | null; // stored size (noteSizes) — null = NOTE_WIDTH/HEIGHT
  onResize: (id: string, size: { w: number; h: number } | null) => void; // stable store action
}

export const NOTE_MIN_W = 140; // swatch strip needs ~132px
export const NOTE_MIN_H = 70;

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

export const NoteNode = memo(function NoteNode({ note, pos, zoomRef, dragLedger, onCommitMove, color, onSetColor, onEditNote, size, onResize }: Props) {
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
  const w = size?.w ?? NOTE_WIDTH;
  const h = size?.h ?? NOTE_HEIGHT;

  // SE resize grip (dbdiagram parity). Imperative during the gesture (rect +
  // foreignObject attrs, bottom-chrome/grip transforms), ONE store write at
  // release (view state like noteColors — not canvas undo). Clamped to keep
  // the swatch strip and title usable.
  const bodyRef = useRef<SVGRectElement>(null);
  const foRef = useRef<SVGForeignObjectElement>(null);
  const chromeRef = useRef<SVGGElement>(null);
  const gripRef = useRef<SVGGElement>(null);
  const resize = useRef<{ startX: number; startY: number; w: number; h: number; live: { w: number; h: number } } | null>(null);
  const onGripDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // never a note drag
    (e.target as Element).setPointerCapture(e.pointerId);
    resize.current = { startX: e.clientX, startY: e.clientY, w, h, live: { w, h } };
  };
  const onGripMove = (e: React.PointerEvent<SVGGElement>) => {
    const r = resize.current;
    if (!r) return;
    if (e.buttons === 0) { resize.current = null; return; } // ghost-gesture bail (ledger rule c)
    const zoom = zoomRef.current ?? 1;
    r.live = {
      w: Math.max(NOTE_MIN_W, Math.round(r.w + (e.clientX - r.startX) / zoom)),
      h: Math.max(NOTE_MIN_H, Math.round(r.h + (e.clientY - r.startY) / zoom)),
    };
    bodyRef.current?.setAttribute('width', String(r.live.w));
    bodyRef.current?.setAttribute('height', String(r.live.h));
    foRef.current?.setAttribute('width', String(r.live.w - 16));
    foRef.current?.setAttribute('height', String(r.live.h - 34));
    chromeRef.current?.setAttribute('transform', `translate(0, ${r.live.h})`);
    gripRef.current?.setAttribute('transform', `translate(${r.live.w}, ${r.live.h})`);
  };
  const onGripUp = () => {
    const r = resize.current;
    if (!r) return;
    resize.current = null;
    if (r.live.w !== w || r.live.h !== h) onResize(note.id, r.live);
  };

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
        ref={bodyRef}
        width={w}
        height={h}
        rx={4}
        className="note-body"
        // inline STYLE, not fill/stroke attributes: the .note-body CSS rule
        // would beat presentation attributes (cascade), on canvas and export
        style={color !== null ? { fill: color, stroke: swatch?.border ?? 'var(--note-border)' } : undefined}
      />
      <text x={10} y={16} className="note-title">{note.name}</text>
      <foreignObject ref={foRef} x={8} y={26} width={w - 16} height={h - 34}>
        <div className="note-content">{note.content}</div>
      </foreignObject>
      {/* Hover palette (dbdiagram parity). pointerdown stops propagation so a
          swatch click never starts a note drag; hidden in exports via
          EXPORT_CSS (display:none). Anchored to the live bottom edge. */}
      <g ref={chromeRef} className="note-swatches" transform={`translate(0, ${h})`} onPointerDown={(e) => e.stopPropagation()}>
        {NOTE_SWATCHES.map((s, i) => (
          <circle
            key={s.bg}
            cx={12 + i * 15}
            cy={-11}
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
          <circle cx={12 + NOTE_SWATCHES.length * 15} cy={-11} r={5.5} />
          <text x={12 + NOTE_SWATCHES.length * 15} y={-11} textAnchor="middle" dominantBaseline="central">✕</text>
          <title>Reset to default</title>
        </g>
      </g>
      <g
        ref={gripRef}
        className="note-resize"
        transform={`translate(${w}, ${h})`}
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        onLostPointerCapture={onGripUp}
      >
        <title>Drag to resize</title>
        <rect x={-14} y={-14} width={16} height={16} fill="transparent" />
        <path d="M-3 -9 L-9 -3 M-3 -5.5 L-5.5 -3" className="note-resize-grip" />
      </g>
    </g>
  );
});
