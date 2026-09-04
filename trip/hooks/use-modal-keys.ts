'use client';

import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';

/** The focusable set the Tab trap walks. One copy: a selector that gains an element type on one
 *  dialog and not the other is a trap with a hole in it, invisible until someone tabs out. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The document-level keyboard duties a modal owes — Escape closes it, Tab cannot leave it —
 * plus the layer registration that makes them correct when modals stack. Returns the `onKeyDown`
 * the panel element must carry.
 *
 * Extracted from `expense-dialog.tsx` and `add-to-itinerary-dialog.tsx`, which carried all three
 * character-identically. The cost being paid down is a fix landing on one copy and silently not
 * the other.
 *
 * FOCUS IS DELIBERATELY NOT HERE. Which element opened the dialog and where focus goes on close
 * is the parent's (D-021), and the field to autofocus differs per dialog. A hook that grabbed
 * focus on mount and restored it in its cleanup is the exact shape D-021 exists to forbid.
 *
 * `useDialogOpenFlag` is called here rather than by each caller so it cannot be forgotten:
 * holding `body[data-dialog-open]` is also how a layer announces itself to the ones underneath,
 * and a sheet stands down from Escape while anything is registered above it (D-527). A modal
 * that took Escape without registering would close itself AND the sheet behind it on one press.
 *
 * `components/ui/sheet-dark.tsx` owes the same two duties and carries the same selector, so it
 * could be rewired onto this hook. It is left alone here because it also owns presence and its
 * Escape is conditional; that is a separate pass.
 */
export function useModalKeys(
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): (e: ReactKeyboardEvent) => void {
  // Live ref to the latest onClose, so the once-registered listener always calls the current
  // closure without re-binding every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useDialogOpenFlag();

  // Esc at the document level so it fires wherever focus sits. `onClose` only flips the parent's
  // state; the parent returns focus once the exit animation completes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };
}
