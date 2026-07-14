import { useEffect, useRef } from 'react';
import { useOverlayEscape } from '../app/overlayStack';
import type { ArrangeAlgorithm } from '../core/layout/elkGraph';

interface Choice {
  algo: ArrangeAlgorithm;
  name: string;
  desc: string;
  icon: React.ReactNode;
}

const CHOICES: Choice[] = [
  {
    algo: 'left-right',
    name: 'Left-right',
    desc: 'Arrange tables left to right by relationship direction. Ideal for long lineages like ETL pipelines.',
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect x="1" y="6" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="11" y="2" width="4" height="4" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="11" y="10" width="4" height="4" rx="1" fill="currentColor" opacity="0.55" />
        <path d="M5 8h3m0 0V4.5L11 4m-3 4v3.5l3 .5" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
    ),
  },
  {
    algo: 'snowflake',
    name: 'Snowflake',
    desc: 'Most connected tables sit in the center. Ideal for densely connected schemas like data warehouses.',
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="1" y="1" width="3" height="3" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="12" y="1" width="3" height="3" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="1" y="12" width="3" height="3" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="12" y="12" width="3" height="3" rx="1" fill="currentColor" opacity="0.55" />
      </svg>
    ),
  },
  {
    algo: 'compact',
    name: 'Compact',
    desc: 'Pack tables into a compact rectangle, ignoring relationships. Ideal for diagrams with few refs.',
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        {[1, 6.5, 12].flatMap((x) =>
          [1, 6.5, 12].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx="0.8" fill="currentColor" opacity={x === 1 && y === 1 ? 1 : 0.55} />),
        )}
      </svg>
    ),
  },
];

/** dbdiagram-style arrange chooser: opens from the arrange button, keys
 *  1/2/3 pick, Escape via the overlay stack, outside-click closes. */
export function ArrangeMenu({ onPick, onClose }: { onPick: (a: ArrangeAlgorithm) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useOverlayEscape(true, onClose);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('.cm-editor') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i === -1) return;
      e.preventDefault();
      onPick(CHOICES[i].algo);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onPick, onClose]);

  return (
    <div className="arrange-pop" ref={rootRef}>
      <div className="arrange-title">Choose auto arrange algorithm</div>
      {CHOICES.map((c, i) => (
        <button key={c.algo} className="arrange-row" onClick={() => onPick(c.algo)}>
          <span className="arrange-icon">{c.icon}</span>
          <span className="arrange-text">
            <span className="arrange-name">
              {c.name}
              <kbd>{i + 1}</kbd>
            </span>
            <span className="arrange-desc">{c.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
