import { useEffect, useRef, type ReactNode } from 'react';

const KEY = 'schemadiagram.split';

// Storage persistence of the split ratio is best-effort: the app must never
// break (or leak listeners) because localStorage is unavailable or full.
function readSplit(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n >= 15 && n <= 80 ? n : 38;
  } catch {
    return 38;
  }
}

function writeSplit(pct: string): void {
  try {
    localStorage.setItem(KEY, pct);
  } catch {
    // ignore — ratio just won't persist
  }
}

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const initial = readSplit();

  // If the component unmounts mid-drag, remove any still-attached window listeners.
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const pct = Math.min(80, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
      leftRef.current!.style.width = `${pct}%`;
    };
    const removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragCleanupRef.current = null;
    };
    const onUp = () => {
      removeListeners(); // unconditional, before anything that could fail
      const w = leftRef.current?.style.width;
      if (w) writeSplit(String(parseFloat(w)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dragCleanupRef.current = removeListeners;
  };

  return (
    <main className="workspace" ref={containerRef}>
      <section className="editor-pane" ref={leftRef} style={{ width: `${initial}%` }}>{left}</section>
      <div className="divider" onPointerDown={onPointerDown} />
      <section className="canvas-pane">{right}</section>
    </main>
  );
}
