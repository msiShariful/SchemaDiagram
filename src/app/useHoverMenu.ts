import { useCallback, useEffect, useRef, useState } from 'react';

export const HOVER_OPEN_DELAY_MS = 100; // hover-intent: don't open on a drive-by
export const HOVER_CLOSE_GRACE_MS = 250; // diagonal travel trigger→menu crosses a small gap

export interface HoverMenu {
  open: boolean;
  close: () => void;
  toggle: () => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  rootProps: {
    onPointerEnter: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
  };
}

/** Shared hover-menu behavior (Feature A): hover-open with a short delay,
 *  hover-close with a grace period, click toggle retained (touch/keyboard),
 *  Escape + outside-pointerdown close. Attach `rootProps` + `rootRef` to the
 *  wrapper that contains BOTH the trigger and the dropdown — pointerleave
 *  never fires for moves onto a descendant, so travel into the menu is safe.
 *  Hover handlers apply to mouse pointers only: on touch, pointerenter fires
 *  right before the tap, and hover-open + click-toggle would cancel out. */
export function useHoverMenu(): HoverMenu {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHoverAt = useRef(0); // when the hover timer opened the menu (0 = click-opened/stale)

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const close = useCallback(() => {
    clear();
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    clear();
    setOpen((v) => {
      // Hover/click race: a click landing right after a hover-open must not
      // slam the menu shut (the hover opened it while the pointer traveled
      // to the trigger — also a Playwright actionability-retry flake).
      if (v && Date.now() - openedByHoverAt.current < 500) return v;
      return !v;
    });
  }, []);

  useEffect(() => clear, []); // unmount: no timer leaks

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  return {
    open,
    close,
    toggle,
    rootRef,
    rootProps: {
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        clear(); // re-entering the root cancels a pending grace-close
        if (!open) {
          timer.current = setTimeout(() => {
            timer.current = null;
            openedByHoverAt.current = Date.now();
            setOpen(true);
          }, HOVER_OPEN_DELAY_MS);
        }
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        clear();
        if (open) {
          timer.current = setTimeout(() => {
            timer.current = null;
            setOpen(false);
          }, HOVER_CLOSE_GRACE_MS);
        }
      },
    },
  };
}
