import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';

interface Props {
  table: Table;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  onLiveMove: (id: string, raw: TablePosition) => TablePosition;
  onCommitMove: (id: string) => void;
  onHover: (id: string | null) => void;
  focused: boolean;
  onOpenInEditor: (id: string) => void;
  registerEl: (id: string, el: SVGGElement | null) => void;
}

export const TableNode = memo(function TableNode({
  table, pos, zoomRef, onLiveMove, onCommitMove, onHover, focused, onOpenInEditor, registerEl,
}: Props) {
  const gRef = useRef<SVGGElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const h = tableHeight(table.fields.length);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    const zoom = zoomRef.current ?? 1;
    const raw = {
      x: drag.current.origX + (e.clientX - drag.current.startX) / zoom,
      y: drag.current.origY + (e.clientY - drag.current.startY) / zoom,
    };
    const snapped = onLiveMove(table.id, raw);
    gRef.current?.setAttribute('transform', `translate(${snapped.x}, ${snapped.y})`);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommitMove(table.id);
  };

  return (
    <g
      ref={(el) => {
        gRef.current = el;
        registerEl(table.id, el);
      }}
      transform={`translate(${pos.x}, ${pos.y})`}
      className={`table-node${focused ? ' focused' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => onHover(table.id)}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={() => onOpenInEditor(table.id)}
    >
      <rect width={TABLE_WIDTH} height={h} rx={6} className="table-body" />
      <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} className="table-header" fill={table.headerColor ?? undefined} />
      <text x={10} y={HEADER_HEIGHT / 2} dominantBaseline="central" className="table-title">
        {table.name}
      </text>
      {table.fields.map((f, i) => (
        <g key={f.name} transform={`translate(0, ${HEADER_HEIGHT + i * ROW_HEIGHT})`}>
          <line x1={0} y1={0} x2={TABLE_WIDTH} y2={0} className="row-line" />
          <text x={10} y={ROW_HEIGHT / 2} dominantBaseline="central" className={`field-name${f.pk ? ' pk' : ''}`}>
            {f.pk ? '🔑 ' : ''}{f.name}
          </text>
          <text x={TABLE_WIDTH - 10} y={ROW_HEIGHT / 2} dominantBaseline="central" textAnchor="end" className="field-type">
            {f.type}
          </text>
        </g>
      ))}
    </g>
  );
});
