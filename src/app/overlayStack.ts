import { useEffect, useRef } from 'react';

/** Escape overlay-stack (Plan 7, Feature F): ONE window keydown listener,
 *  Escape closes the TOPMOST open overlay only. Replaces six per-component
 *  Escape listeners whose firing order was DOM-registration luck (the P6
 *  "double-effect": one Escape closed a popover AND cleared the selection).
 *  Only Escape is centralized — outside-click dismissal stays local to each
 *  component. DiagramCanvas's clear-selection Escape is deliberately NOT an
 *  overlay: it checks overlayDepth() === 0 and acts as the last resort. */
type Close = () => void;

const stack: Close[] = [];

/** Close the topmost overlay. Returns false when the stack is empty (the
 *  caller — or the canvas's last-resort handler — may act instead). */
export function handleEscape(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top(); // the overlay closes itself; its effect cleanup pops the entry
  return true;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') handleEscape();
}

export function overlayDepth(): number {
  return stack.length;
}

export function pushOverlay(close: Close): () => void {
  if (stack.length === 0) window.addEventListener('keydown', onKeyDown);
  stack.push(close);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const i = stack.indexOf(close);
    if (i !== -1) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener('keydown', onKeyDown);
  };
}

/** While `active`, `onClose` sits on the Escape stack. Latest-ref so parents
 *  passing inline arrows don't re-push (and re-ORDER) the entry per render. */
export function useOverlayEscape(active: boolean, onClose: Close): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    return pushOverlay(() => ref.current());
  }, [active]);
}
