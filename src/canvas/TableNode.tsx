import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';

interface Props {
  table: Table;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  onLiveMove: (id: string, pos: TablePosition) => void;
  onCommitMove: (id: string, pos: TablePosition) => void;
  onHover: (id: string | null) => void;
}

export const TableNode = memo(function TableNode({ table, pos, zoomRef, onLiveMove, onCommitMove, onHover }: Props) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number; live: TablePosition } | null>(null);
  const h = tableHeight(table.fields.length);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, live: pos };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    const zoom = zoomRef.current ?? 1;
    const live = {
      x: drag.current.origX + (e.clientX - drag.current.startX) / zoom,
      y: drag.current.origY + (e.clientY - drag.current.startY) / zoom,
    };
    drag.current.live = live;
    gRef.current?.setAttribute('transform', `translate(${live.x}, ${live.y})`);
    onLiveMove(table.id, live);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { live } = drag.current;
    drag.current = null;
    onCommitMove(table.id, live);
  };

  return (
    <g
      ref={gRef}
      transform={`translate(${pos.x}, ${pos.y})`}
      className="table-node"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => onHover(table.id)}
      onPointerLeave={() => onHover(null)}
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
