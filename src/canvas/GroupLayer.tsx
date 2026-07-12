import { memo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { computeGroupRect, GROUP_HEADER_HEIGHT } from '../core/layout/groups';
import type { TablePosition } from '../core/model/types';

interface Props {
  zoomRef: React.RefObject<number>;
  onLiveMoveSet: (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number) => void;
  onCommitMoveSet: (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number, label: string) => void;
}

interface GroupDrag {
  memberIds: string[];
  base: Record<string, TablePosition>;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  el: SVGGElement; // the whole group <g>, moved live so rect+header track the drag
}

export const GroupLayer = memo(function GroupLayer({ zoomRef, onLiveMoveSet, onCommitMoveSet }: Props) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const drag = useRef<GroupDrag | null>(null);

  const startDrag = (memberIds: string[]) => (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const pos = useAppStore.getState().positions;
    const base: Record<string, TablePosition> = {};
    for (const id of memberIds) if (pos[id]) base[id] = pos[id];
    drag.current = {
      memberIds: memberIds.filter((id) => base[id]),
      base,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      el: e.currentTarget.parentNode as SVGGElement,
    };
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    // drag is one ref shared by every group header in this component (unlike
    // TableNode/NoteNode, which own a private ref per instance): a parse that
    // deletes the dragged group unmounts its header without a pointerup, but
    // GroupLayer itself lives on, so a later buttonless hover over ANY
    // surviving header would otherwise resume this stale drag. onLostPointerCapture
    // below covers the capture-loss case; this covers capture events that never
    // reach the detached element's listener.
    if (e.buttons === 0) { drag.current = null; return; }
    const zoom = zoomRef.current ?? 1;
    d.dx = (e.clientX - d.startX) / zoom;
    d.dy = (e.clientY - d.startY) / zoom;
    d.el.setAttribute('transform', `translate(${d.dx}, ${d.dy})`);
    onLiveMoveSet(d.memberIds, d.base, d.dx, d.dy);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.el.removeAttribute('transform');
    onCommitMoveSet(d.memberIds, d.base, d.dx, d.dy, 'move group');
  };

  return (
    <g className="group-layer">
      {schema.groups.map((g) => {
        const rect = computeGroupRect(g, schema, positions);
        if (!rect) return null;
        const color = g.color ?? 'var(--table-header)';
        return (
          <g key={g.id} className="table-group">
            <rect className="group-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={8} stroke={color} fill={color} />
            <g
              className="group-header"
              onPointerDown={startDrag(g.tableIds)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onLostPointerCapture={onPointerUp}
            >
              <rect x={rect.x} y={rect.y} width={rect.w} height={GROUP_HEADER_HEIGHT} rx={8} fill={color} fillOpacity={0.18} />
              <circle cx={rect.x + 12} cy={rect.y + GROUP_HEADER_HEIGHT / 2} r={5} fill={color} />
              <text x={rect.x + 24} y={rect.y + GROUP_HEADER_HEIGHT / 2} dominantBaseline="central" className="group-title">
                {g.name}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
});
