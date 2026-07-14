import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';
import { type LodLevel } from './lod';
import { fieldBadges, fieldTooltip } from './fieldMeta';

interface Props {
  table: Table;
  pos: TablePosition;
  zoomRef: React.RefObject<number>;
  lod: LodLevel;
  onLiveMove: (id: string, raw: TablePosition) => TablePosition;
  onCommitMove: (id: string) => void;
  onHover: (id: string | null) => void;
  focused: boolean;
  selected: boolean;
  dimmed: boolean; // Feature C: outside the traced 1-hop keep-set (CSS opacity only)
  onOpenInEditor: (id: string) => void;
  onOpenSettings: (id: string) => void; // stable callback (memo contract) — gear passes the id out
  onRefDragStart: (tableId: string, fieldName: string, e: React.PointerEvent) => void; // stable (memo contract) — REF-DRAG hand-off to DiagramCanvas
  registerEl: (id: string, el: SVGGElement | null) => void;
}

export const TableNode = memo(function TableNode({
  table, pos, zoomRef, lod, onLiveMove, onCommitMove, onHover, focused, selected, dimmed,
  onOpenInEditor, onOpenSettings, onRefDragStart, registerEl,
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
      className={`table-node${focused ? ' focused' : ''}${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onPointerEnter={() => onHover(table.id)}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={() => onOpenInEditor(table.id)}
    >
      {lod === 'box' ? (
        <rect width={TABLE_WIDTH} height={h} rx={6} className="table-box" fill={table.headerColor ?? undefined} />
      ) : (
        <>
          <rect width={TABLE_WIDTH} height={h} rx={6} className="table-body" />
          <g className="table-header-g">
            {table.note !== null && <title>{table.note}</title>}
            <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} className="table-header" fill={table.headerColor ?? undefined} />
            <text x={10} y={HEADER_HEIGHT / 2} dominantBaseline="central" className="table-title">
              {table.name}
            </text>
          </g>
          {lod === 'full' &&
            table.fields.map((f, i) => {
              const badges = fieldBadges(f);
              const tip = fieldTooltip(f);
              return (
                <g key={f.name} className="field-row" transform={`translate(0, ${HEADER_HEIGHT + i * ROW_HEIGHT})`}>
                  {tip !== null && <title>{tip}</title>}
                  {/* Full-width transparent hit rect: hover target for the
                      tooltip and (Task 7) the ref handle. Events bubble to
                      the table <g> — drag/click behavior unchanged. */}
                  <rect width={TABLE_WIDTH} height={ROW_HEIGHT} fill="transparent" />
                  <line x1={0} y1={0} x2={TABLE_WIDTH} y2={0} className="row-line" />
                  <text x={10} y={ROW_HEIGHT / 2} dominantBaseline="central" className={`field-name${f.pk ? ' pk' : ''}`}>
                    {f.pk ? '🔑 ' : ''}{f.name}
                    {f.note !== null && <tspan className="field-note-dot"> ●</tspan>}
                  </text>
                  <text x={TABLE_WIDTH - 10} y={ROW_HEIGHT / 2} dominantBaseline="central" textAnchor="end" className="field-type">
                    {badges !== '' && <tspan className="field-badges">{badges} </tspan>}
                    {f.type}
                  </text>
                  <circle
                    className="ref-handle"
                    cx={TABLE_WIDTH - 6}
                    cy={ROW_HEIGHT / 2}
                    r={5}
                    onPointerDown={(e) => {
                      // REF-DRAG start: never a table drag. stopPropagation
                      // before the table <g>'s onPointerDown; DiagramCanvas
                      // owns the gesture (capture on the stable <svg>).
                      e.stopPropagation();
                      onRefDragStart(table.id, f.name, e);
                    }}
                  />
                </g>
              );
            })}
          {/* Gear (Feature B): visible on table hover via CSS. Inline
              closures here are fine — they live INSIDE the memoized
              component; the PROP (onOpenSettings) is what must be stable.
              stopPropagation on pointerdown keeps a gear press from
              starting a drag. */}
          <g
            className="table-gear"
            transform={`translate(${TABLE_WIDTH - 24}, ${HEADER_HEIGHT / 2 - 8})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings(table.id);
            }}
          >
            <rect width={16} height={16} rx={3} className="table-gear-bg" />
            <text x={8} y={8} textAnchor="middle" dominantBaseline="central" className="table-gear-glyph">
              {'⚙︎'}
            </text>
          </g>
        </>
      )}
    </g>
  );
});
