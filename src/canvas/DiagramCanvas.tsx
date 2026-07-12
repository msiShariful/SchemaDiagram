import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { EdgeLayer, type EdgeLayerHandle } from './EdgeLayer';
import { TableNode } from './TableNode';
import { zoomAt } from './viewport';
import { fitViewport } from './fitView';
import { snapPosition, SNAP_TOLERANCE, type GuideLine } from './snap';
import { rectFromPoints, idsInRect } from './marquee';
import { lodLevel } from './lod';
import { visibleWorldRect } from './culling';
import { getTableRect, rectsOverlap, TABLE_WIDTH, tableHeight } from '../core/model/geometry';
import { revealTable } from '../editor/editorNav';
import type { PositionDelta } from '../core/layout/commands';
import type { Point, Rect, TablePosition, Viewport } from '../core/model/types';

const DRAG_THRESHOLD_PX = 3; // below this raw pointer travel, a gesture is a click

interface DragState {
  id: string; // the table under the pointer
  members: string[]; // whole moving set (selection if it contains `id`, else just `id`)
  base: Record<string, TablePosition>; // member positions at gesture start
  live: Record<string, TablePosition>; // latest snapped member positions
  otherRects: Rect[]; // snap candidates: every positioned table outside the moving set
  size: { w: number; h: number }; // dragged table's box for snap anchoring
  moved: boolean; // raw pointer travel exceeded DRAG_THRESHOLD_PX at some point
}

export function DiagramCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const edgeLayerRef = useRef<EdgeLayerHandle>(null);
  const guideXRef = useRef<SVGLineElement>(null);
  const guideYRef = useRef<SVGLineElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const dragRef = useRef<DragState | null>(null);
  const vpRef = useRef<Viewport>(useAppStore.getState().viewport);
  const zoomRef = useRef<number>(vpRef.current.zoom);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const marqueeRef = useRef<SVGRectElement>(null);
  const marqueeState = useRef<{ start: Point } | null>(null);
  const spaceDown = useRef(false);
  const [zoomPct, setZoomPct] = useState(Math.round(vpRef.current.zoom * 100));

  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const setHoveredTable = useAppStore((s) => s.setHoveredTable);
  const editorFocusTableId = useAppStore((s) => s.editorFocusTableId);
  const selectedTableIds = useAppStore((s) => s.selectedTableIds);
  const selectedSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);

  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const svg = svgRef.current!;
    const update = () => {
      const r = svg.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Safe to subscribe: pan commits on release and wheel commits 150 ms after
  // the last tick (Task 5's debounced commit), so this re-render fires at
  // gesture end / wheel idle — never per tick.
  const viewport = useAppStore((s) => s.viewport);
  const lod = lodLevel(viewport.zoom);
  const viewRect = size.w > 0 ? visibleWorldRect(viewport, size.w, size.h) : null;

  // Registry of table <g> elements so multi-drag can move selection members
  // imperatively without querySelector or per-render closures.
  const registerNodeEl = useCallback((id: string, el: SVGGElement | null) => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  }, []);

  // Guide lines are two persistent <line> elements toggled/positioned via
  // direct setAttribute — never React state (perf contract).
  const showGuides = (guides: GuideLine[]) => {
    const gx = guides.find((g) => g.axis === 'x');
    const gy = guides.find((g) => g.axis === 'y');
    const vx = guideXRef.current;
    const vy = guideYRef.current;
    if (vx) {
      if (gx) {
        vx.setAttribute('x1', String(gx.at));
        vx.setAttribute('x2', String(gx.at));
        vx.setAttribute('visibility', 'visible');
      } else vx.setAttribute('visibility', 'hidden');
    }
    if (vy) {
      if (gy) {
        vy.setAttribute('y1', String(gy.at));
        vy.setAttribute('y2', String(gy.at));
        vy.setAttribute('visibility', 'visible');
      } else vy.setAttribute('visibility', 'hidden');
    }
  };
  const hideGuides = () => showGuides([]);

  // Live drag: snap the pointer table, shift every other member by the same
  // delta via direct DOM writes, re-route affected edges imperatively, and
  // return the snapped position for TableNode's own transform.
  const handleLiveMove = useCallback((id: string, raw: TablePosition): TablePosition => {
    let drag = dragRef.current;
    if (!drag || drag.id !== id) {
      const s = useAppStore.getState();
      const wanted = s.selectedTableIds.includes(id) ? s.selectedTableIds : [id];
      const members = wanted.filter((m) => s.positions[m]);
      const memberSet = new Set(members);
      const table = s.schema.tables.find((t) => t.id === id);
      const base: Record<string, TablePosition> = {};
      for (const m of members) base[m] = s.positions[m];
      drag = dragRef.current = {
        id,
        members,
        base,
        live: { ...base },
        otherRects: s.schema.tables
          .filter((t) => s.positions[t.id] && !memberSet.has(t.id))
          .map((t) => getTableRect(t, s.positions[t.id])),
        size: { w: TABLE_WIDTH, h: tableHeight(table?.fields.length ?? 0) },
        moved: false,
      };
    }
    if (!drag.moved) {
      const zoom = zoomRef.current ?? 1;
      const px = (raw.x - drag.base[id].x) * zoom;
      const py = (raw.y - drag.base[id].y) * zoom;
      if (Math.hypot(px, py) < DRAG_THRESHOLD_PX) return drag.base[id]; // click jitter: don't snap, don't move
      drag.moved = true;
    }
    const tolerance = SNAP_TOLERANCE / (zoomRef.current ?? 1);
    const { pos, guides } = snapPosition(raw, drag.size, drag.otherRects, tolerance);
    const dx = pos.x - drag.base[id].x;
    const dy = pos.y - drag.base[id].y;
    for (const m of drag.members) {
      const p = { x: drag.base[m].x + dx, y: drag.base[m].y + dy };
      drag.live[m] = p;
      if (m !== id) nodeEls.current.get(m)?.setAttribute('transform', `translate(${p.x}, ${p.y})`);
    }
    edgeLayerRef.current?.updateTablePositions(drag.live);
    showGuides(guides);
    return pos;
  }, []);

  // Gesture end: one undoable command for the whole moved set. A gesture that
  // never exceeded the 3 px click threshold (plain click / each half of a
  // double-click / hand jitter) selects the table instead — and
  // commitCanvasCommand's zero-delta prune backstops no-op entries regardless.
  const handleCommitMove = useCallback((id: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    hideGuides();
    const store = useAppStore.getState();
    if (!drag || !drag.moved) {
      store.setSelectedTables([id]);
      return;
    }
    const tables: PositionDelta[] = drag.members.map((m) => ({
      id: m,
      before: drag.base[m],
      after: drag.live[m],
    }));
    store.commitCanvasCommand({
      label: drag.members.length > 1 ? 'move tables' : 'move table',
      tables,
      notes: [],
    });
  }, []);
  // (showGuides/hideGuides touch refs only, so the first-render closures
  // captured by the [] callbacks above stay correct.)

  // A parse landing mid-gesture can prune/rename the dragged table; its DOM
  // node is removed, so pointerup/pointercancel may never fire and the ledger
  // + guide lines would go stale. `positions` changes exactly when a parse
  // commits, so this effect is the single cleanup point — it runs on real
  // re-renders only, never during the imperative drag path.
  useEffect(() => {
    if (dragRef.current && !positions[dragRef.current.id]) {
      dragRef.current = null;
      hideGuides();
    }
    // hideGuides touches refs only — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  // Canvas undo/redo shortcuts, Escape-to-clear-selection, and Space-hold
  // pan-arming. The editor pane keeps CodeMirror history: anything typed
  // while focus is inside .cm-editor never reaches the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('.cm-editor') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        useAppStore.getState().setSelectedTables([]);
        return;
      }
      if (e.key === ' ') {
        // Don't hijack Space when a button has focus — it would both arm the
        // pan AND re-activate the focused button (e.g. a zoom control).
        if (!target?.closest('button')) spaceDown.current = true;
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useAppStore.getState().redoCanvas();
        else useAppStore.getState().undoCanvas();
      } else if (key === 'y') {
        e.preventDefault();
        useAppStore.getState().redoCanvas();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const applyTransform = () => {
    const { x, y, zoom } = vpRef.current;
    zoomRef.current = zoom;
    sceneRef.current?.setAttribute('transform', `translate(${x}, ${y}) scale(${zoom})`);
  };

  useLayoutEffect(() => {
    // sync when viewport changes externally (diagram load, zoom-to-fit).
    // Layout-timed so a freshly loaded diagram's viewport is applied before
    // paint — a passive effect here would let one frame render at the
    // previous (usually wrong) viewport first.
    return useAppStore.subscribe(
      (s) => s.viewport,
      (vp) => { vpRef.current = vp; applyTransform(); setZoomPct(Math.round(vp.zoom * 100)); },
      { fireImmediately: true },
    );
  }, []);

  useEffect(() => {
    const svg = svgRef.current!;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      vpRef.current = zoomAt(vpRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY);
      applyTransform(); // immediate: the zoom itself never touches React
      // Commit-at-gesture-end semantics, like pan: the store write (and the
      // React render it triggers — zoom %, and later LOD/culling) lands at
      // wheel-idle, never per tick.
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        commitTimer = null;
        useAppStore.getState().setViewport(vpRef.current);
        setZoomPct(Math.round(vpRef.current.zoom * 100));
      }, 150);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { x, y, zoom } = vpRef.current;
    return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== svgRef.current) return;
    const wantPan = e.button === 1 || (e.button === 0 && spaceDown.current);
    if (wantPan) {
      e.preventDefault(); // best effort against middle-click autoscroll
      svgRef.current!.setPointerCapture(e.pointerId);
      panRef.current = { startX: e.clientX, startY: e.clientY, origX: vpRef.current.x, origY: vpRef.current.y };
      return;
    }
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    marqueeState.current = { start: toWorld(e.clientX, e.clientY) };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      vpRef.current = {
        ...vpRef.current,
        x: panRef.current.origX + (e.clientX - panRef.current.startX),
        y: panRef.current.origY + (e.clientY - panRef.current.startY),
      };
      applyTransform();
      return;
    }
    const m = marqueeState.current;
    const el = marqueeRef.current;
    if (!m || !el) return;
    const r = rectFromPoints(m.start, toWorld(e.clientX, e.clientY));
    el.setAttribute('x', String(r.x));
    el.setAttribute('y', String(r.y));
    el.setAttribute('width', String(r.w));
    el.setAttribute('height', String(r.h));
    el.setAttribute('visibility', 'visible');
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      panRef.current = null;
      useAppStore.getState().setViewport(vpRef.current);
      setZoomPct(Math.round(vpRef.current.zoom * 100));
      return;
    }
    const m = marqueeState.current;
    if (!m) return;
    marqueeState.current = null;
    marqueeRef.current?.setAttribute('visibility', 'hidden');
    const sel = rectFromPoints(m.start, toWorld(e.clientX, e.clientY));
    const store = useAppStore.getState();
    const minSize = 4 / (zoomRef.current ?? 1); // tinier than this = a click on empty canvas
    if (sel.w < minSize && sel.h < minSize) {
      store.setSelectedTables([]);
      return;
    }
    const items = store.schema.tables
      .filter((t) => store.positions[t.id])
      .map((t) => ({ id: t.id, rect: getTableRect(t, store.positions[t.id]) }));
    store.setSelectedTables(idsInRect(items, sel));
  };

  const zoomBy = (factor: number) => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    vpRef.current = zoomAt(vpRef.current, { x: rect.width / 2, y: rect.height / 2 }, -Math.log(factor) / 0.0015);
    applyTransform();
    useAppStore.getState().setViewport(vpRef.current);
  };
  const fit = () => {
    const { schema, positions } = useAppStore.getState();
    const rects = schema.tables.filter((t) => positions[t.id]).map((t) => getTableRect(t, positions[t.id]));
    const rect = svgRef.current!.getBoundingClientRect();
    useAppStore.getState().setViewport(fitViewport(rects, rect.width, rect.height));
  };

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="diagram-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g ref={sceneRef}>
          <EdgeLayer ref={edgeLayerRef} viewRect={viewRect} />
          {schema.tables.map((t) => {
            const pos = positions[t.id];
            if (!pos) return null;
            // The actively-dragged table's <g> holds pointer capture for the
            // gesture; unmounting it mid-drag (e.g. a wheel-zoom tick while a
            // mouse button drag is in progress) would drop capture and strand
            // the drag with no pointerup. Its own DOM element always stays.
            const isDragAnchor = dragRef.current?.id === t.id;
            if (viewRect && !isDragAnchor && !rectsOverlap(getTableRect(t, pos), viewRect)) return null;
            return (
              <TableNode
                key={t.id}
                table={t}
                pos={pos}
                zoomRef={zoomRef}
                lod={lod}
                onLiveMove={handleLiveMove}
                onCommitMove={handleCommitMove}
                onHover={setHoveredTable}
                focused={t.id === editorFocusTableId}
                selected={selectedSet.has(t.id)}
                onOpenInEditor={revealTable}
                registerEl={registerNodeEl}
              />
            );
          })}
          <line ref={guideXRef} className="guide" y1={-100000} y2={100000} visibility="hidden" vectorEffect="non-scaling-stroke" />
          <line ref={guideYRef} className="guide" x1={-100000} x2={100000} visibility="hidden" vectorEffect="non-scaling-stroke" />
          <rect ref={marqueeRef} className="marquee" visibility="hidden" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <div className="zoom-controls">
        <button onClick={() => zoomBy(1.2)}>+</button>
        <button onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button onClick={fit}>fit</button>
        <span>{zoomPct}%</span>
      </div>
    </div>
  );
}
