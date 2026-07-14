import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { buildEdgeSpecs, type EdgeSpec } from '../core/layout/edges';
import { routeEdge, pointsToPath } from '../core/layout/routing';
import { getTableRect, fieldRowY, rectsOverlap } from '../core/model/geometry';
import type { Rect, Table, TablePosition } from '../core/model/types';

export interface EdgeLayerHandle {
  updateTablePositions(overrides: Record<string, TablePosition>): void;
}

function edgePath(
  spec: EdgeSpec,
  positions: Record<string, TablePosition>,
  tablesById: Map<string, Table>,
): { d: string; label1: { x: number; y: number; text: string }; label2: { x: number; y: number; text: string } } | null {
  const fromTable = tablesById.get(spec.fromTableId);
  const toTable = tablesById.get(spec.toTableId);
  const fromPos = positions[spec.fromTableId];
  const toPos = positions[spec.toTableId];
  if (!fromTable || !toTable || !fromPos || !toPos) return null;
  const fromRect = getTableRect(fromTable, fromPos);
  const toRect = getTableRect(toTable, toPos);
  const pts = routeEdge(fromRect, fromPos.y + fieldRowY(spec.fromFieldIndex), toRect, toPos.y + fieldRowY(spec.toFieldIndex));
  const lblOffset = (p0: { x: number; y: number }, p1: { x: number; y: number }) => ({
    x: p0.x + Math.sign(p1.x - p0.x) * 10,
    y: p0.y - 5,
  });
  return {
    d: pointsToPath(pts),
    label1: { ...lblOffset(pts[0], pts[1]), text: spec.fromRelation },
    label2: { ...lblOffset(pts[pts.length - 1], pts[pts.length - 2]), text: spec.toRelation },
  };
}

interface EdgeLayerProps {
  viewRect: Rect | null;
  onEdgeClick: (refId: string, clientX: number, clientY: number) => void; // stable (DiagramCanvas useCallback)
}

export const EdgeLayer = forwardRef<EdgeLayerHandle, EdgeLayerProps>(function EdgeLayer({ viewRect, onEdgeClick }, ref) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const hoveredTableId = useAppStore((s) => s.hoveredTableId);
  const selectedTableIds = useAppStore((s) => s.selectedTableIds);
  const selectedSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
  const hiddenTableIds = useAppStore((s) => s.hiddenTableIds);
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const hitRefs = useRef(new Map<string, SVGPathElement>());

  // Feature D: filtering HERE means render, specsByTable, and the imperative
  // updateTablePositions path all inherit it — an edge with a hidden endpoint
  // simply doesn't exist, and no per-tick code changes.
  const specs = useMemo(() => {
    const hidden = new Set(hiddenTableIds);
    return buildEdgeSpecs(schema).filter(
      (sp) => !hidden.has(sp.fromTableId) && !hidden.has(sp.toTableId),
    );
  }, [schema, hiddenTableIds]);
  const tablesById = useMemo(() => new Map(schema.tables.map((t) => [t.id, t])), [schema]);
  const specsByTable = useMemo(() => {
    const m = new Map<string, EdgeSpec[]>();
    for (const s of specs) {
      m.set(s.fromTableId, [...(m.get(s.fromTableId) ?? []), s]);
      m.set(s.toTableId, [...(m.get(s.toTableId) ?? []), s]);
    }
    return m;
  }, [specs]);

  useImperativeHandle(ref, () => ({
    updateTablePositions(overrides) {
      const live = { ...positions, ...overrides };
      const touched = new Set<EdgeSpec>();
      for (const id of Object.keys(overrides)) {
        for (const s of specsByTable.get(id) ?? []) touched.add(s);
      }
      for (const spec of touched) {
        const p = edgePath(spec, live, tablesById);
        if (p) {
          pathRefs.current.get(spec.id)?.setAttribute('d', p.d);
          hitRefs.current.get(spec.id)?.setAttribute('d', p.d); // popover hit area tracks the drag
        }
      }
    },
  }), [positions, specsByTable, tablesById]);

  return (
    <g className="edge-layer">
      {specs.map((spec) => {
        if (viewRect) {
          const ft = tablesById.get(spec.fromTableId);
          const tt = tablesById.get(spec.toTableId);
          const fp = positions[spec.fromTableId];
          const tp = positions[spec.toTableId];
          if (
            ft && tt && fp && tp &&
            !rectsOverlap(getTableRect(ft, fp), viewRect) &&
            !rectsOverlap(getTableRect(tt, tp), viewRect)
          ) {
            return null; // both endpoints offscreen (with margin) — skip
          }
        }
        const p = edgePath(spec, positions, tablesById);
        if (!p) return null;
        const hot =
          hoveredTableId === spec.fromTableId ||
          hoveredTableId === spec.toTableId ||
          selectedSet.has(spec.fromTableId) ||
          selectedSet.has(spec.toTableId);
        return (
          <g key={spec.id} className={`edge${hot ? ' hot' : ''}`}>
            <path
              d={p.d}
              ref={(el) => { if (el) pathRefs.current.set(spec.id, el); else pathRefs.current.delete(spec.id); }}
            />
            <path
              className="edge-hit"
              d={p.d}
              ref={(el) => { if (el) hitRefs.current.set(spec.id, el); else hitRefs.current.delete(spec.id); }}
              onClick={(e) => onEdgeClick(spec.id, e.clientX, e.clientY)}
            />
            <text x={p.label1.x} y={p.label1.y} className="edge-label">{p.label1.text}</text>
            <text x={p.label2.x} y={p.label2.y} className="edge-label">{p.label2.text}</text>
          </g>
        );
      })}
    </g>
  );
});
