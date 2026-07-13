import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { EdgeLayer, type EdgeLayerHandle } from './EdgeLayer';
import { GroupLayer } from './GroupLayer';
import { MiniMap, type MiniMapHandle } from './MiniMap';
import { TableNode } from './TableNode';
import { NoteNode } from './NoteNode';
import { zoomAt } from './viewport';
import { fitViewport } from './fitView';
import { snapPosition, SNAP_TOLERANCE, DRAG_THRESHOLD_PX, type GuideLine } from './snap';
import { rectFromPoints, idsInRect } from './marquee';
import { lodLevel } from './lod';
import { visibleWorldRect } from './culling';
import { getTableRect, getNoteRect, rectsOverlap, TABLE_WIDTH, tableHeight } from '../core/model/geometry';
import { revealTable } from '../editor/editorNav';
import { runElkLayout } from '../core/layout/elkLayout';
import type { PositionDelta } from '../core/layout/commands';
import type { Point, Rect, TablePosition, Viewport } from '../core/model/types';

// Gesture ledger rules — shared by every per-schema-object drag on the canvas
// (table, note, group; the minimap's viewport drag doesn't carry a
// per-schema-object ledger so it's a simpler case). A parse can land
// mid-gesture and delete the table/note/group being dragged, unmounting the
// element that holds pointer capture with no pointerup ever firing. Each
// implementation (TableNode, NoteNode, GroupLayer) independently has to
// defend against the resulting "ghost gesture" — written down once here
// instead of re-derived per component:
//   (a) drag-anchor culling exemption: the render pass that culls
//       off-screen/deleted elements reads the ledger ref (dragRef /
//       noteDragRef / GroupLayer's own ref) at render time, so the actively
//       dragged element always stays mounted even if it would otherwise be culled.
//   (b) onLostPointerCapture routes to the same guarded pointerup handler as
//       onPointerUp/onPointerCancel — losing capture (e.g. the element is
//       removed from the DOM) must end the gesture exactly like a real pointerup.
//   (c) move handlers bail when e.buttons === 0 — the backstop for when (b)
//       doesn't fire (a detached element's lostpointercapture may never reach
//       a listener), and the only defense when the ledger ref is shared
//       across sibling instances of the same component: GroupLayer maps one
//       onPointerMove closure over every group header, unlike TableNode/NoteNode,
//       which get one component instance — and one private ref — per schema object.
//   (d) pan ownership: Space+left / middle-button pan is armed in CAPTURE
//       phase (onPointerDownCapture below), before any child's onPointerDown
//       runs, and stops propagation — so the same press can never ALSO start
//       a table/note/group drag underneath it. panRef/marqueeState each carry
//       the owning pointerId; while one is set, a second pointer (a touch, or
//       a chorded button) is ignored rather than hijacking or double-starting
//       a gesture — this is also what keeps a mid-marquee middle-click from
//       cancelling the marquee and starting a pan at the same time.
// DRAG_THRESHOLD_PX lives in snap.ts (shared with NoteNode's own drag).

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
  const minimapRef = useRef<MiniMapHandle>(null);
  const guideXRef = useRef<SVGLineElement>(null);
  const guideYRef = useRef<SVGLineElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const dragRef = useRef<DragState | null>(null);
  const noteDragRef = useRef<string | null>(null); // in-flight note drag (NoteNode writes it)
  const vpRef = useRef<Viewport>(useAppStore.getState().viewport);
  const zoomRef = useRef<number>(vpRef.current.zoom);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const marqueeRef = useRef<SVGRectElement>(null);
  const marqueeState = useRef<{ pointerId: number; start: Point } | null>(null);
  const spaceDown = useRef(false);
  const [zoomPct, setZoomPct] = useState(Math.round(vpRef.current.zoom * 100));
  const [layoutBusy, setLayoutBusy] = useState(false);

  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const notePositions = useAppStore((s) => s.notePositions);
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

  // Group-header drag: shift member table <g>s and their edges imperatively.
  // Culled (unmounted) members simply have no element in the registry — the
  // DOM write is skipped and the commit below still carries their positions.
  const handleGroupLiveMove = useCallback(
    (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number) => {
      const overrides: Record<string, TablePosition> = {};
      for (const id of memberIds) {
        const b = base[id];
        if (!b) continue;
        const p = { x: b.x + dx, y: b.y + dy };
        overrides[id] = p;
        nodeEls.current.get(id)?.setAttribute('transform', `translate(${p.x}, ${p.y})`);
      }
      edgeLayerRef.current?.updateTablePositions(overrides);
    },
    [],
  );

  const handleGroupCommit = useCallback(
    (memberIds: string[], base: Record<string, TablePosition>, dx: number, dy: number, label: string) => {
      const tables: PositionDelta[] = memberIds
        .filter((id) => base[id])
        .map((id) => ({ id, before: base[id], after: { x: base[id].x + dx, y: base[id].y + dy } }));
      useAppStore.getState().commitCanvasCommand({ label, tables, notes: [] });
    },
    [],
  );

  const handleNoteCommit = useCallback((id: string, before: TablePosition, after: TablePosition) => {
    useAppStore.getState().commitCanvasCommand({
      label: 'move note',
      tables: [],
      notes: [{ id, before, after }],
    });
  }, []);

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
    // A window blur while Space is held (alt-tab, devtools focus, etc.) never
    // fires keyup — without this, spaceDown sticks true and the next
    // left-click pans instead of selecting/dragging.
    const onBlur = () => { spaceDown.current = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const applyTransform = () => {
    const { x, y, zoom } = vpRef.current;
    zoomRef.current = zoom;
    sceneRef.current?.setAttribute('transform', `translate(${x}, ${y}) scale(${zoom})`);
    minimapRef.current?.updateViewport(vpRef.current);
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

  // Pan-from-anywhere (review-debt ledger): Space+left / middle-button must
  // pan even when the pointer sits over a table, note, or group. Capture
  // phase runs before any child's onPointerDown, and stopPropagation() here
  // keeps the same gesture from ALSO starting a table/note/group drag.
  // Gesture ownership: at most one canvas-level gesture (pan or marquee) at
  // a time, keyed by pointerId — a second pointer (touch) or a chorded
  // button press can neither hijack nor double-start a gesture.
  const onPointerDownCapture = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current || marqueeState.current) return; // a gesture already owns the canvas
    const wantPan = e.button === 1 || (e.button === 0 && spaceDown.current);
    if (!wantPan) return;
    e.preventDefault(); // best effort against middle-click autoscroll
    e.stopPropagation(); // don't let TableNode/NoteNode/GroupLayer start a drag
    svgRef.current!.setPointerCapture(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: vpRef.current.x,
      origY: vpRef.current.y,
    };
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== svgRef.current) return; // marquee starts on empty canvas only
    if (e.button !== 0) return;
    if (panRef.current || marqueeState.current) return; // second pointer mid-gesture: ignore
    svgRef.current!.setPointerCapture(e.pointerId);
    marqueeState.current = { pointerId: e.pointerId, start: toWorld(e.clientX, e.clientY) };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan) {
      if (e.pointerId !== pan.pointerId) return; // not the owning pointer
      vpRef.current = {
        ...vpRef.current,
        x: pan.origX + (e.clientX - pan.startX),
        y: pan.origY + (e.clientY - pan.startY),
      };
      applyTransform();
      return;
    }
    const m = marqueeState.current;
    const el = marqueeRef.current;
    if (!m || !el || e.pointerId !== m.pointerId) return;
    const r = rectFromPoints(m.start, toWorld(e.clientX, e.clientY));
    el.setAttribute('x', String(r.x));
    el.setAttribute('y', String(r.y));
    el.setAttribute('width', String(r.w));
    el.setAttribute('height', String(r.h));
    el.setAttribute('visibility', 'visible');
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan) {
      if (e.pointerId !== pan.pointerId) return;
      panRef.current = null;
      useAppStore.getState().setViewport(vpRef.current);
      setZoomPct(Math.round(vpRef.current.zoom * 100));
      return;
    }
    const m = marqueeState.current;
    if (!m || e.pointerId !== m.pointerId) return;
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

  const handleMinimapNav = useCallback((center: Point, commit: boolean) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const zoom = vpRef.current.zoom;
    vpRef.current = { zoom, x: rect.width / 2 - center.x * zoom, y: rect.height / 2 - center.y * zoom };
    applyTransform();
    if (commit) useAppStore.getState().setViewport(vpRef.current);
  }, []);
  // (applyTransform touches refs only; the first-render closure stays correct.)

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

  const autoLayout = async () => {
    const { schema } = useAppStore.getState();
    if (schema.tables.length === 0 || layoutBusy) return;
    setLayoutBusy(true);
    try {
      const next = await runElkLayout(schema);
      const st = useAppStore.getState();
      if (st.schema !== schema) return; // schema changed mid-layout: stale result, discard
      const tables = Object.keys(next).map((id) => ({
        id,
        before: st.positions[id] ?? next[id], // unknown before → zero delta → pruned
        after: next[id],
      }));
      st.commitCanvasCommand({ label: 'auto-layout', tables, notes: [] });
      fit();
    } catch (err) {
      // layout unavailable (worker + fallback both failed) — positions untouched
      window.alert(`Auto-layout failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLayoutBusy(false);
    }
  };

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="diagram-canvas"
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g ref={sceneRef}>
          <GroupLayer zoomRef={zoomRef} onLiveMoveSet={handleGroupLiveMove} onCommitMoveSet={handleGroupCommit} />
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
          {schema.notes.map((n) => {
            // Object.hasOwn, not a bare bracket read: a note named e.g. "toString"
            // would otherwise shadow-read Object.prototype.toString (truthy, so
            // `if (!pos)` wouldn't catch it) instead of missing the position lookup.
            if (!Object.hasOwn(notePositions, n.id)) return null;
            const pos = notePositions[n.id];
            // Same drag-anchor exemption as tables: unmounting the note that
            // holds pointer capture would strand the drag with no pointerup.
            const isDragAnchor = noteDragRef.current === n.id;
            if (viewRect && !isDragAnchor && !rectsOverlap(getNoteRect(pos), viewRect)) return null;
            return <NoteNode key={n.id} note={n} pos={pos} zoomRef={zoomRef} dragLedger={noteDragRef} onCommitMove={handleNoteCommit} />;
          })}
          <line ref={guideXRef} className="guide" y1={-100000} y2={100000} visibility="hidden" vectorEffect="non-scaling-stroke" />
          <line ref={guideYRef} className="guide" x1={-100000} x2={100000} visibility="hidden" vectorEffect="non-scaling-stroke" />
          <rect ref={marqueeRef} className="marquee" visibility="hidden" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <MiniMap ref={minimapRef} viewSize={size} onNavigate={handleMinimapNav} />
      <div className="zoom-controls">
        <button onClick={() => void autoLayout()} disabled={layoutBusy} title="Auto-layout (ELK layered)">
          auto
        </button>
        <button onClick={() => zoomBy(1.2)}>+</button>
        <button onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button onClick={fit}>fit</button>
        <span>{zoomPct}%</span>
      </div>
    </div>
  );
}
