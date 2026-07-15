import { memo, useRef } from 'react';
import type { Table, TablePosition } from '../core/model/types';
import { TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, tableHeight } from '../core/model/geometry';
import { type LodLevel } from './lod';
import { fieldBadges, fieldTooltip, fitFieldRow, fitTableTitle } from './fieldMeta';

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
  onFieldHover: (f: { tableId: string; fieldName: string } | null) => void; // stable store action (memo contract)
  onEditFieldNote: (tableId: string, fieldName: string) => void; // stable (memo contract) — opens the note popover
  hotFields: readonly string[] | null; // endpoint rows of the hovered edge; null (stable) for uninvolved tables
}

export const TableNode = memo(function TableNode({
  table, pos, zoomRef, lod, onLiveMove, onCommitMove, onHover, focused, selected, dimmed,
  onOpenInEditor, onOpenSettings, onRefDragStart, registerEl, onFieldHover, hotFields, onEditFieldNote,
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
        <rect
          width={TABLE_WIDTH}
          height={h}
          rx={6}
          className="table-box"
          // inline STYLE, not a fill attribute: the .table-box CSS rule wins
          // over presentation attributes (cascade) — canvas AND exports
          style={table.headerColor !== null ? { fill: table.headerColor } : undefined}
        />
      ) : (
        <>
          <rect width={TABLE_WIDTH} height={h} rx={6} className="table-body" />
          <g className="table-header-g">
            {(() => {
              const fitTitle = fitTableTitle(table.name);
              const tip =
                fitTitle !== table.name
                  ? table.note !== null
                    ? `${table.name}\n${table.note}`
                    : table.name
                  : table.note;
              return (
                <>
                  {tip !== null && <title>{tip}</title>}
                  <rect
                    width={TABLE_WIDTH}
                    height={HEADER_HEIGHT}
                    rx={6}
                    className="table-header"
                    // inline STYLE, not a fill attribute (cascade — see .table-box)
                    style={table.headerColor !== null ? { fill: table.headerColor } : undefined}
                  />
                  <text x={10} y={HEADER_HEIGHT / 2} dominantBaseline="central" className="table-title">
                    {fitTitle}
                  </text>
                </>
              );
            })()}
          </g>
          {lod === 'full' &&
            table.fields.map((f, i) => {
              const badges = fieldBadges(f);
              const fit = fitFieldRow(f.name, f.type, badges, f.pk, f.note !== null);
              const meta = fieldTooltip(f);
              // A truncated name is recovered through the tooltip.
              const tip = fit.nameTruncated ? (meta !== null ? `${f.name}\n${meta}` : f.name) : meta;
              return (
                <g
                  key={f.name}
                  className={`field-row${hotFields?.includes(f.name) ? ' hot' : ''}`}
                  transform={`translate(0, ${HEADER_HEIGHT + i * ROW_HEIGHT})`}
                  onPointerEnter={() => onFieldHover({ tableId: table.id, fieldName: f.name })}
                  onPointerLeave={() => onFieldHover(null)}
                >
                  {tip !== null && <title>{tip}</title>}
                  {/* Full-width transparent hit rect: hover target for the
                      tooltip and (Task 7) the ref handle. Events bubble to
                      the table <g> — drag/click behavior unchanged. */}
                  <rect width={TABLE_WIDTH} height={ROW_HEIGHT} fill="transparent" />
                  <line x1={0} y1={0} x2={TABLE_WIDTH} y2={0} className="row-line" />
                  <text x={10} y={ROW_HEIGHT / 2} dominantBaseline="central" className={`field-name${f.pk ? ' pk' : ''}`}>
                    {f.pk ? '🔑 ' : ''}{fit.name}
                    {f.note !== null && <tspan className="field-note-dot"> ●</tspan>}
                  </text>
                  <text x={TABLE_WIDTH - 10} y={ROW_HEIGHT / 2} dominantBaseline="central" textAnchor="end" className="field-type">
                    {badges !== '' && <tspan className="field-badges">{badges} </tspan>}
                    {fit.type}
                  </text>
                  {/* Field-note editor (hover-visible like the gear). Sits
                      over the tail of the type text while shown — transient,
                      dbdiagram-style row action. */}
                  <g
                    className="field-note-btn"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onEditFieldNote(table.id, f.name)}
                  >
                    <title>{f.note !== null ? 'Edit field note' : 'Add field note'}</title>
                    <rect x={TABLE_WIDTH - 34} y={ROW_HEIGHT / 2 - 8} width={16} height={16} rx={3} className="field-note-btn-bg" />
                    <path
                      d={`M${TABLE_WIDTH - 30} ${ROW_HEIGHT / 2 + 3.5} l7.5 -7.5 l2.5 2.5 l-7.5 7.5 l-3 .5 z`}
                      className="field-note-btn-glyph"
                    />
                  </g>
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
