import { useRef, type ReactNode } from 'react';

const KEY = 'dbdraft.split';

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const initial = Number(localStorage.getItem(KEY)) || 38;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const pct = Math.min(80, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
      leftRef.current!.style.width = `${pct}%`;
    };
    const onUp = () => {
      const w = leftRef.current!.style.width;
      if (w) localStorage.setItem(KEY, String(parseFloat(w)));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <main className="workspace" ref={containerRef}>
      <section className="editor-pane" ref={leftRef} style={{ width: `${initial}%` }}>{left}</section>
      <div className="divider" onPointerDown={onPointerDown} />
      <section className="canvas-pane">{right}</section>
    </main>
  );
}
