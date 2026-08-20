'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'framer-motion';

import { overlayPanelMotion } from '@/lib/motion';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';

/**
 * Shared dark Sheet primitive.
 *
 * ONE hand-rolled extraction of the identical modal contract the three
 * hand-rolled sheets (place-detail, import-place, guide-filter) each duplicated:
 * portal to <body> (mount-guarded, SSR-safe under output:'export'), a document-
 * level Escape, a Tab focus-trap inside the panel, first-focusable autofocus, the
 * `body[data-dialog-open]` seam flag (Lane-M FAB hides on it), and PARENT-OWNED
 * focus-return fired on the framer exit (`onExitComplete`). The panel carries the
 * app's SOLE surviving glass recipe (`.sheet-surface`, globals.css) — the nav/
 * overlay layer, HIG-legal — over a `bg-black/60 backdrop-blur-sm` scrim.
 *
 * Radix was deliberately NOT adopted: the existing `components/ui/sheet.tsx` radix
 * Sheet is LIGHT-MODE and, contrary to the A5's "dead code" note, is a
 * LIVE dependency of concierge-chat — so it is left intact. This
 * dark primitive is a pure de-duplication of the three hand-rolled sheets — zero
 * behaviour change, intact.
 *
 * reduced-motion: entrance/exit are opacity + a small transform; the global
 * reduced-motion CSS guard + framer's `MotionConfig reducedMotion="user"` collapse
 * them to the settled end-state, so nothing is ever stuck at opacity-0.
 *
 * MOTION (issue #24): the panel entrance is `overlayPanelMotion()` from `lib/motion.ts`, not a
 * literal here. D-292 pins every dialog and sheet to Tier 3 whatever route opened it, and what
 * that revokes is precisely the `scale: 0.9` spring the centre variant used to open with — the
 * design system names it in so many words ("no spring, no scale-from-0.9"). The SCRIM's cross-fade is
 * untouched: it is opacity-only, inside the budget, and it is what holds the panel mounted long
 * enough to play its exit.
 */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** parent-owned focus-return: fired once the exit animation completes. */
  onExitComplete?: () => void;
  /** aria-labelledby target id (the caller's title element). */
  labelledBy?: string;
  /** 'right' = drawer (bottom-sheet on mobile) · 'center' = modal. */
  side?: 'right' | 'center';
  /**
   * When true the sheet's Escape handler no-ops — used when a nested dialog is
   * open over the sheet and owns Escape, so one press closes the topmost layer.
   */
  disableEscape?: boolean;
  /** Focus target on open; defaults to the panel's first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Panel sizing/rounding classes (the caller owns its exact dimensions). */
  className?: string;
  /** data-testid stamped on the panel. */
  testId?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sheet({
  open,
  onClose,
  onExitComplete,
  labelledBy,
  side = 'right',
  disableEscape = false,
  initialFocusRef,
  className = '',
  testId,
  children,
}: SheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // First-element autofocus on open: the caller's first focusable (a close
  // button in the drawers, or an explicit initialFocusRef for the import form).
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const target =
        initialFocusRef?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, initialFocusRef]);

  // Document-level Esc — suppressed when a nested layer owns it.
  useEffect(() => {
    if (!open || disableEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, disableEscape]);

  // body[data-dialog-open] seam flag while open (Lane-M FAB hides on it). Ref-counted, so a
  // dialog opened on top of this sheet cannot clear it on its way out.
  useDialogOpenFlag(open);

  // Tab focus-trap inside the panel.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
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

  if (!mounted) return null;

  // The scrim carries NO `overscroll-contain`: `overscroll-behavior` only applies to a scroll
  // container, and this element is `overflow: visible`. B-6's two halves are
  // body[data-dialog-open]{overflow:hidden} in globals.css (page cannot scroll behind) and
  // `overscroll-contain` on each consumer's own `overflow-y-auto` body (a flick that bottoms
  // out inside the sheet does not chain). This primitive owns neither — the panel is
  // `overflow-hidden` and the scrolling element belongs to the consumer.
  const scrimClass =
    side === 'center'
      ? 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm'
      : 'fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end bg-black/60 backdrop-blur-sm';

  const panelMotion = overlayPanelMotion(side);

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <m.div
          key="sheet-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={scrimClass}
          onClick={onClose}
        >
          <m.div
            ref={panelRef}
            data-testid={testId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            onKeyDown={handleKeyDown}
            {...panelMotion}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={`sheet-surface flex flex-col overflow-hidden ${className}`}
          >
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
