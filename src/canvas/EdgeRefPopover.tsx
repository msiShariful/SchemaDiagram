import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { useOverlayEscape } from '../app/overlayStack';
import { applyRefOperator, deleteRefLine, revealPosition, revealTable } from '../editor/editorNav';
import { formatRefText, refOperator, type RefOperator } from '../editor/refEdit';

const OPERATORS: Array<{ op: RefOperator; label: string }> = [
  { op: '<', label: 'one-to-many' },
  { op: '>', label: 'many-to-one' },
  { op: '-', label: 'one-to-one' },
  { op: '<>', label: 'many-to-many' },
];

interface Props {
  refId: string;
  x: number; // px inside .canvas-wrap (from the committed click point;
  y: number; // holds still during an imperative pan — same accepted ceiling
  onClose: () => void; // as TableSettingsPopover)
}

/** Edge popover (Feature A). CRITICAL architecture rule: every mutation is a
 *  TEXT edit through editorNav (applyRefOperator/deleteRefLine — one
 *  CodeMirror transaction; editor history owns undo; the parse pipeline
 *  repaints ~300 ms later). This component never writes schema state.
 *  Inline-defined refs are REFUSED with a Reveal jump — there is no
 *  standalone line to rewrite, and rewriting field settings is out of scope. */
export function EdgeRefPopover({ refId, x, y, onClose }: Props) {
  const ref = useAppStore((s) => s.schema.refs.find((r) => r.id === refId));
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The ref can vanish under us: a parse removed it, our own Delete landed,
  // or the diagram switched. Close instead of orphaning.
  useEffect(() => {
    if (!ref) onClose();
  }, [ref, onClose]);

  useOverlayEscape(true, onClose);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);

  if (!ref) return null;

  const current = refOperator(ref);
  const setOp = (op: RefOperator) => {
    setErr(applyRefOperator(ref, op) ? null : "Couldn't locate this ref's line — edit it in the DBML.");
  };
  const del = () => {
    if (deleteRefLine(ref)) onClose();
    else setErr("Couldn't locate this ref's line — edit it in the DBML.");
  };
  const reveal = () => {
    if (ref.pos) revealPosition(ref.pos.line, ref.pos.column);
    else revealTable(ref.from.tableId); // no token info — land near one endpoint
    onClose();
  };

  return (
    <div ref={rootRef} className="edge-popover" style={{ left: x, top: y }}>
      <div className="ep-title">{formatRefText(ref)}</div>
      {ref.inline ? (
        <>
          <div className="ep-inline-note">Defined inline — edit it in the DBML.</div>
          <button className="ep-reveal" onClick={reveal}>Reveal</button>
        </>
      ) : (
        <>
          <div className="ep-ops" role="radiogroup" aria-label="Cardinality">
            {OPERATORS.map(({ op, label }) => (
              <label key={op} title={label} className="ep-op">
                <input
                  type="radio"
                  name="ref-cardinality"
                  checked={current === op}
                  onChange={() => setOp(op)}
                />
                <span className="ep-op-glyph">{op}</span>
              </label>
            ))}
          </div>
          <button className="ep-delete" onClick={del}>Delete ref</button>
        </>
      )}
      {err !== null && <div className="ep-error">{err}</div>}
    </div>
  );
}
