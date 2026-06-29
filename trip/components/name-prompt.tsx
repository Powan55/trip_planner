'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCircle2, Check, X } from 'lucide-react';
import { getUserName, setUserName } from '@/lib/identity';
import { isRemoteConfigured } from '@/lib/firebase-config';

/**
 * Name-on-first-use prompt — DORMANT unless remote sync is active.
 *
 * Shows exactly once, the first time a synced user lands without a saved display name
 * (`isRemoteConfigured()` true AND `getUserName()` null). On confirm it persists a
 * self-chosen nickname via `lib/identity.ts` (key `tripPlannerUserName`); from then on
 * the store's mutators stamp it onto createdBy/updatedBy. There is a "Skip"
 * (and Esc / overlay / X) — skipping just dismisses for the session; edits then stay
 * unattributed until a name is set, which is valid.
 *
 * DORMANT-SAFE: with no Firebase config the gate is false and this
 * renders NOTHING — no prompt in the local-only portfolio build. It imports ONLY
 * lib/identity (pure localStorage) + lib/firebase-config (the gate) — NEVER firebase.
 *
 * A11y reuses the shared modal contract:
 *  - role="dialog" aria-modal aria-labelledby aria-describedby
 *  - document-level Esc via an onCloseRef (latest-closure, bound once)
 *  - a lightweight Tab-trap inside the panel
 *  - autofocus the name input on open
 *  - focus-return to whatever was focused before, on exit-complete (parent-owned here
 *    since the prompt mounts itself rather than from a trigger button).
 * Reduced-motion is honored via the global reduced-motion CSS; Tailwind
 * classes are static literals.
 */
export default function NamePrompt() {
  // `null` until we've decided on the client whether to show (SSR-safe: getUserName /
  // isRemoteConfigured both read window). Decide once on mount.
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false);
  const [name, setName] = useState('');

  // Element focused before the prompt opened, restored on exit (focus-return).
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Show once when sync is active and no name has been chosen yet.
    if (isRemoteConfigured() && !getUserName()) {
      triggerRef.current = (document.activeElement as HTMLElement) ?? null;
      setOpen(true);
    }
    setDecided(true);
  }, []);

  const close = () => setOpen(false);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    close();
  };

  // Nothing to render before we've decided, or when dormant / already named / skipped.
  if (!decided) return null;

  return (
    <AnimatePresence
      onExitComplete={() => {
        triggerRef.current?.focus?.();
        triggerRef.current = null;
      }}
    >
      {open && (
        <NamePromptDialog
          name={name}
          onNameChange={setName}
          onSave={handleSave}
          onClose={close}
        />
      )}
    </AnimatePresence>
  );
}

function NamePromptDialog({
  name,
  onNameChange,
  onSave,
  onClose,
}: {
  name: string;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  // Live ref to the latest onClose so the once-bound Esc listener calls the current
  // closure without re-binding each render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const fieldId = `${baseId}-name`;

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the name input on open; re-assert shortly after in case the open animation
  // steals focus (the backstop), but only if focus isn't already in the panel.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        inputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Esc closes at the document level so it fires wherever focus sits.
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

  // Lightweight Tab-trap inside the panel (no new deps), identical to ItemEditor.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full max-w-sm glass-card-dark rounded-2xl p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-gold-500/15 text-gold-400">
              <UserCircle2 className="w-5 h-5" />
            </span>
            <h3 id={titleId} className="font-display text-lg font-bold text-white leading-tight">
              What should we call you?
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip naming"
            className="shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p id={descId} className="text-sm text-white/60 mb-4 leading-relaxed">
          This trip is shared with your travel companions. Add a name so they can see who
          planned what — e.g. &ldquo;last edited by Mei&rdquo;. Just a nickname; you can skip this.
        </p>

        <form
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            onSave();
          }}
        >
          <label htmlFor={fieldId} className="text-xs text-white/50 mb-1 block">
            Your name
          </label>
          <input
            id={fieldId}
            ref={inputRef}
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value)}
            maxLength={24}
            autoComplete="off"
            placeholder="e.g., Mei"
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 mb-4"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white/60 bg-white/5 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
