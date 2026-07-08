import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../app/store';
import { EdgeLayer, type EdgeLayerHandle } from './EdgeLayer';
import { TableNode } from './TableNode';
import { zoomAt } from './viewport';
import type { TablePosition, Viewport } from '../core/model/types';

export function DiagramCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const edgeLayerRef = useRef<EdgeLayerHandle>(null);
  const vpRef = useRef<Viewport>(useAppStore.getState().viewport);
  const zoomRef = useRef<number>(vpRef.current.zoom);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Stable across renders (refs never change identity) so a fresh inline
  // closure per table doesn't defeat TableNode's memo.
  const handleLiveMove = useCallback((id: string, pos: TablePosition) => {
    edgeLayerRef.current?.updateTablePosition(id, pos);
  }, []);

  const schema = useAppStore((s) => s.schema);
  const positions = useAppStore((s) => s.positions);
  const moveTable = useAppStore((s) => s.moveTable);
  const setHoveredTable = useAppStore((s) => s.setHoveredTable);

  const applyTransform = () => {
    const { x, y, zoom } = vpRef.current;
    zoomRef.current = zoom;
    sceneRef.current?.setAttribute('transform', `translate(${x}, ${y}) scale(${zoom})`);
  };

  useEffect(() => {
    // sync when viewport changes externally (diagram load, zoom-to-fit)
    return useAppStore.subscribe(
      (s) => s.viewport,
      (vp) => { vpRef.current = vp; applyTransform(); },
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
  };

  return (
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
            />
          ) : null,
        )}
      </g>
    </svg>
  );
}
