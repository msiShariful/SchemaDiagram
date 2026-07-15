import { memo, useMemo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { computeGroupRect, GROUP_HEADER_HEIGHT, GROUP_PILL_W, GROUP_PILL_H } from '../core/layout/groups';
import { effectiveHiddenIds, omitHidden } from '../core/model/visibility';
import type { TablePosition } from '../core/model/types';
import { DRAG_THRESHOLD_PX } from './snap';

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
  moved: boolean; // raw pointer travel exceeded DRAG_THRESHOLD_PX (parity with tables/notes)
  onTap: (() => void) | null; // fired on release when the gesture stayed a click (pill -> expand)
}

export const GroupLayer = memo(function GroupLayer({ zoomRef, onLiveMoveSet, onCommitMoveSet }: Props) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  // Group rects hug VISIBLE members only; all-hidden → computeGroupRect null
  // → the group disappears. Group-header drags still move ALL members'
  // stored positions (startDrag reads unfiltered store positions) —
  // deliberate: group integrity survives hide/unhide. This is the intentional
  // exception to hiding-deselects: membership, not selection, drives it.
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const collapsedSet = useMemo(() => new Set(collapsedGroupIds), [collapsedGroupIds]);
  // Expanded rects hug members visible on the CANVAS (explicit hides ∪ other
  // groups' collapses); pill rects use EXPLICIT hides only — a collapsed
  // group's own members must not null its rect (positions persist).
  const effectiveHidden = useMemo(
    () => effectiveHiddenIds(schema, hiddenTableIds, collapsedGroupIds),
    [schema, hiddenTableIds, collapsedGroupIds],
  );
  const visPositions = useMemo(() => omitHidden(positions, effectiveHidden), [positions, effectiveHidden]);
  const pillPositions = useMemo(() => omitHidden(positions, hiddenTableIds), [positions, hiddenTableIds]);
  const drag = useRef<GroupDrag | null>(null);

  const toggleCollapse = (groupId: string) => {
    const cur = useAppStore.getState().collapsedGroupIds;
    useAppStore.getState().setCollapsedGroups(
      cur.includes(groupId) ? cur.filter((id) => id !== groupId) : [...cur, groupId],
    );
  };

  const startDrag = (memberIds: string[], onTap: (() => void) | null = null) => (e: React.PointerEvent<SVGGElement>) => {
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
      moved: false,
      onTap,
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
    if (!d.moved) {
      // Same 3 px click-jitter guard as table/note drags — and what makes
      // tap-to-expand on the pill reliable.
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
    }
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
    if (!d.moved) {
      d.onTap?.(); // click, not a drag — pill tap expands
      return;
    }
    onCommitMoveSet(d.memberIds, d.base, d.dx, d.dy, 'move group');
  };

  return (
    <g className="group-layer">
      {schema.groups.map((g) => {
        const collapsed = collapsedSet.has(g.id);
        const rect = computeGroupRect(g, schema, collapsed ? pillPositions : visPositions);
        if (!rect) return null;
        const color = g.color ?? 'var(--table-header)';
        if (collapsed) {
          return (
            <g key={g.id} className="table-group collapsed">
              <g
                className="group-header"
                onPointerDown={startDrag(g.tableIds, () => toggleCollapse(g.id))}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onLostPointerCapture={onPointerUp}
              >
                <title>Click to expand — drag to move the group</title>
                <rect className="group-pill" x={rect.x} y={rect.y} width={GROUP_PILL_W} height={GROUP_PILL_H} rx={8} stroke={color} fill={color} />
                <text x={rect.x + 30} y={rect.y + GROUP_PILL_H / 2} dominantBaseline="central" className="group-title">
                  {g.name} ({g.tableIds.length})
                </text>
              </g>
              <g
                className="group-collapse"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleCollapse(g.id)}
              >
                <title>Expand group</title>
                <rect x={rect.x + 5} y={rect.y + GROUP_PILL_H / 2 - 9} width={18} height={18} rx={4} className="group-collapse-bg" />
                <text x={rect.x + 14} y={rect.y + GROUP_PILL_H / 2} textAnchor="middle" dominantBaseline="central" className="group-collapse-glyph">▸</text>
              </g>
            </g>
          );
        }
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
            <g
              className="group-collapse"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => toggleCollapse(g.id)}
            >
              <title>Collapse group</title>
              <rect x={rect.x + rect.w - 24} y={rect.y + GROUP_HEADER_HEIGHT / 2 - 9} width={18} height={18} rx={4} className="group-collapse-bg" />
              <text x={rect.x + rect.w - 15} y={rect.y + GROUP_HEADER_HEIGHT / 2} textAnchor="middle" dominantBaseline="central" className="group-collapse-glyph">▾</text>
            </g>
          </g>
        );
      })}
    </g>
  );
});
