import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { getTableRect } from '../core/model/geometry';
import {
  MINIMAP_H, MINIMAP_W, boundsOfRects, miniToWorld, minimapTransform, worldToMini,
  type MiniTransform,
} from './minimapMath';
import type { Point, Viewport } from '../core/model/types';

export interface MiniMapHandle {
  updateViewport(vp: Viewport): void;
}

interface Props {
  viewSize: { w: number; h: number };
  onNavigate: (worldCenter: Point, commit: boolean) => void;
}

export const MiniMap = memo(forwardRef<MiniMapHandle, Props>(function MiniMap({ viewSize, onNavigate }, ref) {
  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const viewRectEl = useRef<SVGRectElement>(null);
  const dragging = useRef(false);

  const items = useMemo(
    () =>
      schema.tables
        .filter((t) => positions[t.id])
        .map((t) => ({ id: t.id, rect: getTableRect(t, positions[t.id]), color: t.headerColor })),
    [schema, positions],
  );
  const bounds = useMemo(() => boundsOfRects(items.map((i) => i.rect)), [items]);
  const t: MiniTransform | null = bounds ? minimapTransform(bounds) : null;

  // Latest-value refs so the imperative handle never goes stale without
  // needing to re-register anything on the hot path.
  const tRef = useRef(t);
  tRef.current = t;
  const viewSizeRef = useRef(viewSize);
  viewSizeRef.current = viewSize;

  const applyViewport = useCallback((vp: Viewport) => {
    const tr = tRef.current;
    const el = viewRectEl.current;
    if (!tr || !el) return;
    const topLeft = worldToMini(tr, { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom });
    el.setAttribute('x', String(topLeft.x));
    el.setAttribute('y', String(topLeft.y));
    el.setAttribute('width', String((viewSizeRef.current.w / vp.zoom) * tr.scale));
    el.setAttribute('height', String((viewSizeRef.current.h / vp.zoom) * tr.scale));
  }, []);

  useImperativeHandle(ref, () => ({ updateViewport: applyViewport }), [applyViewport]);

  // Re-sync the viewport rect after every render (bounds/scale may have changed).
  useLayoutEffect(() => {
    applyViewport(useAppStore.getState().viewport);
  });

  if (!t || !bounds) return null;

  const navTo = (e: React.PointerEvent<SVGSVGElement>, commit: boolean) => {
    const tr = tRef.current;
    if (!tr) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onNavigate(miniToWorld(tr, { x: e.clientX - rect.left, y: e.clientY - rect.top }), commit);
  };

  return (
    <svg
      className="minimap"
      width={MINIMAP_W}
      height={MINIMAP_H}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        navTo(e, false);
      }}
      onPointerMove={(e) => {
        if (dragging.current) navTo(e, false);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        navTo(e, true);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {items.map((i) => {
        const p = worldToMini(t, i.rect);
        return (
          <rect
            key={i.id}
            x={p.x}
            y={p.y}
            width={i.rect.w * t.scale}
            height={i.rect.h * t.scale}
            className="minimap-table"
            fill={i.color ?? undefined}
          />
        );
      })}
      <rect ref={viewRectEl} className="minimap-view" />
    </svg>
  );
}));
