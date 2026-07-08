import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { EdgeLayer, type EdgeLayerHandle } from './EdgeLayer';
import { TableNode } from './TableNode';
import { zoomAt } from './viewport';
import { fitViewport } from './fitView';
import { getTableRect } from '../core/model/geometry';
import { revealTable } from '../editor/editorNav';
import type { TablePosition, Viewport } from '../core/model/types';

export function DiagramCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const edgeLayerRef = useRef<EdgeLayerHandle>(null);
  const vpRef = useRef<Viewport>(useAppStore.getState().viewport);
  const zoomRef = useRef<number>(vpRef.current.zoom);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(Math.round(vpRef.current.zoom * 100));

  // Stable across renders (refs never change identity) so a fresh inline
  // closure per table doesn't defeat TableNode's memo.
  const handleLiveMove = useCallback((id: string, pos: TablePosition) => {
    edgeLayerRef.current?.updateTablePosition(id, pos);
  }, []);

  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const moveTable = useAppStore((s) => s.moveTable);
  const setHoveredTable = useAppStore((s) => s.setHoveredTable);
  const editorFocusTableId = useAppStore((s) => s.editorFocusTableId);

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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      vpRef.current = zoomAt(vpRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY);
      applyTransform();
      useAppStore.getState().setViewport(vpRef.current);
      setZoomPct(Math.round(vpRef.current.zoom * 100));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || e.target !== svgRef.current) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: vpRef.current.x, origY: vpRef.current.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panRef.current) return;
    vpRef.current = {
      ...vpRef.current,
      x: panRef.current.origX + (e.clientX - panRef.current.startX),
      y: panRef.current.origY + (e.clientY - panRef.current.startY),
    };
    applyTransform();
  };
  const onPointerUp = () => {
    if (!panRef.current) return;
    panRef.current = null;
    useAppStore.getState().setViewport(vpRef.current);
    setZoomPct(Math.round(vpRef.current.zoom * 100));
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
          <EdgeLayer ref={edgeLayerRef} />
          {schema.tables.map((t) =>
            positions[t.id] ? (
              <TableNode
                key={t.id}
                table={t}
                pos={positions[t.id]}
                zoomRef={zoomRef}
                onLiveMove={handleLiveMove}
                onCommitMove={moveTable}
                onHover={setHoveredTable}
                focused={t.id === editorFocusTableId}
                onOpenInEditor={revealTable}
              />
            ) : null,
          )}
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
