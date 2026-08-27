'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Pencil, Sparkles } from 'lucide-react';
import { useJournal } from '@/hooks/use-journal';
import { formatDateLong } from '@/lib/trip-data';
import PhotoAttach from '@/components/photo-attach';
import { MOODS, type Mood, type JournalEntry } from '@/core/journal/model';

/**
 * —: the in-trip per-day TEXT journal card.
 *
 * Renders INSIDE the in-trip Today panel (`components/today-panel.tsx`), below the agenda — so it is
 * intrinsically in-trip-gated (the panel is `null` outside the trip window) and demoable via `?today=`
 * Reads/writes TODAY'S entry through `useJournal()` → the framework-free journal core +
 * gateway key 12. Photos are OUT (declared future boundary).
 *
 * Two states:
 * - READ (an entry exists): mood glyph + highlight + body, with an Edit control.
 * - EMPTY (no entry): a "Write about today" prompt that opens the editor.
 * Edit mode: a mood-chip selector (single-select, togglable to clear), a short highlight input, a
 * multiline text area, and Save + Cancel. Save calls `saveEntry(date, {text, mood, highlight})`;
 * clearing everything + Save removes the entry.
 *
 * A11y: real `<label>`s, visible focus rings (`focus-visible:ring-ring`,
 * matching the panel), ≥44px targets, `aria-pressed` on mood chips, an `aria-live` region on the read
 * view. Static markup + CSS-only transitions → reduced-motion-safe by construction (the parent panel
 * owns the already-gated reveal). Design: the ruled machine-type language of the instrument.
 */

// The mood glyph + label used in the read view + the chip selector (kept in MOODS order).
const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

export default function JournalCard({ date, isToday = true }: { date: string; isToday?: boolean }) {
  const { getEntry, saveEntry, hydrated } = useJournal();
  const entry = getEntry(date);
  // `journal-browse.tsx` mounts this same card to edit a PAST day, where every "today" literal was
  // wrong — including the heading and both aria-labels, so it reached the accessible name and not
  // just the pixels (#128). Default keeps the Today-panel caller's copy byte-identical.
  const dayLabel = isToday ? "Today's journal" : `${formatDateLong(date)} — journal`;
  const editLabel = isToday ? "Edit today's journal entry" : `Edit the journal entry for ${formatDateLong(date)}`;

  // Editor open/closed + its draft fields. Closed by default; opens on Edit / the empty prompt.
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftMood, setDraftMood] = useState<Mood | null>(null);
  const [draftHighlight, setDraftHighlight] = useState('');

  // ── focus management ────────────────────────
  // Opening the editor unmounts the trigger (Edit / "Write about today"), which would otherwise
  // drop focus to <body>; Save/Cancel unmount the editor the same way. We hold refs to both
  // triggers, focus the first editor field on open, and on close return focus to whichever trigger
  // re-mounts — mirroring the calendar/expense-dialog parent-owned pattern. Esc is document-level.
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const writePromptRef = useRef<HTMLButtonElement>(null);
  const highlightInputRef = useRef<HTMLInputElement>(null);
  // Which trigger to restore focus to after the editor closes ('edit' when an entry existed,
  // 'write' from the empty prompt). Null unless a genuine open→close cycle should return focus.
  const returnFocusTo = useRef<'edit' | 'write' | null>(null);
  const wasEditing = useRef(false);
  // Live ref to the latest handleCancel so the once-registered Esc listener calls the current one.
  const onCancelRef = useRef<() => void>(() => {});

  // Seed the draft from the current entry whenever we OPEN the editor (or the day changes under it).
  const openEditor = () => {
    const cur = getEntry(date);
    setDraftText(cur?.text ?? '');
    setDraftMood(cur?.mood ?? null);
    setDraftHighlight(cur?.highlight ?? '');
    // Record the return target BEFORE the trigger unmounts: an existing entry opens from the Edit
    // button, the empty state opens from the "Write about today" prompt.
    returnFocusTo.current = cur ? 'edit' : 'write';
    setEditing(true);
  };

  // If the trip day rolls over (midnight self-correct in the panel) while the editor is open, close
  // it so we never save a stale day's draft onto a new day. This is NOT a user close, so it must not
  // steal/return focus — clear the return target.
  useEffect(() => {
    returnFocusTo.current = null;
    setEditing(false);
  }, [date]);

  const handleSave = () => {
    // `null` for mood/highlight explicitly clears; the core removes the entry if all content is empty.
    saveEntry(date, {
      text: draftText,
      mood: draftMood,
      highlight: draftHighlight,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditing(false);
  };
  onCancelRef.current = handleCancel;

  // Focus the first editor field on open, and return focus to the originating trigger on close.
  // Runs after commit (so the trigger has actually re-mounted before we focus it).
  useEffect(() => {
    if (editing) {
      // Opening: focus the first field (the highlight input — a single unambiguous text target,
      // mirroring the expense dialog focusing its amount field; the mood group sits just above it
      // and remains a Shift+Tab away).
      highlightInputRef.current?.focus();
    } else if (wasEditing.current) {
      // Just closed via Save/Cancel: return focus to whichever trigger re-mounted.
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target === 'edit') editButtonRef.current?.focus();
      else if (target === 'write') writePromptRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  // Esc cancels editing, at the document level so it fires wherever focus sits inside the editor
  // (matches the house `onCloseRef` idiom in expense-dialog.tsx). Registered once; only acts while
  // the editor is open (the handler no-ops otherwise via the current handleCancel closing a closed
  // editor being idempotent — but we also guard on `editing` through the ref-free closure below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editing) {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  // Before hydration, render a stable read/empty shell (the parent panel already gates on `hydrated`,
  // so this is belt-and-braces — never renders a flash of the wrong state).
  return (
    <section
      aria-labelledby="journal-heading"
      data-testid="journal-card"
      className="mt-6 border-hair border-border bg-surface-low p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3
          id="journal-heading"
          className="pr flex items-center gap-2"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          {dayLabel}
        </h3>
        <div className="flex items-center gap-1.5">
          {/* the only way to reach the /journal browse view besides a direct URL — nav/tab/
              palette wiring is an explicit follow-up rider, not this change's. */}
          <Link
            href="/journal/"
            data-testid="journal-view-all"
            className="pr min-h-tap inline-flex items-center px-2.5 underline-offset-4 outline-none transition-colors duration-200 hover:text-ink-hi hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all entries
          </Link>
          {!editing && entry && (
            <button
              ref={editButtonRef}
              type="button"
              onClick={openEditor}
              data-testid="journal-edit"
              aria-label={editLabel}
              className="chip min-h-tap gap-1.5 px-3 outline-none transition-colors duration-200 hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
          )}
        </div>
      </header>

      {editing ? (
        <JournalEditor
          text={draftText}
          mood={draftMood}
          highlight={draftHighlight}
          highlightInputRef={highlightInputRef}
          onTextChange={setDraftText}
          onMoodChange={setDraftMood}
          onHighlightChange={setDraftHighlight}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : entry ? (
        <JournalReadView entry={entry} />
      ) : (
        <button
          ref={writePromptRef}
          type="button"
          onClick={openEditor}
          data-testid="journal-write-prompt"
          className="empty-frame flex min-h-[5.5rem] w-full items-center gap-3 p-gut text-left text-t-body text-ink-mid outline-none transition-colors duration-200 hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="h-4 w-4 flex-shrink-0 text-ink-lo" aria-hidden="true" />
          <span>
            {isToday ? 'Write about today' : `Write about ${formatDateLong(date)}`}
            {hydrated ? '' : '…'}
          </span>
        </button>
      )}

      {/* — day photos (owner keyed by DATE, so they persist independent of the text entry and
          recap is a pure owner.date filter). Local-only IndexedDB blobs, zero egress. */}
      <PhotoAttach owner={{ kind: 'journal', date }} heading="Day photos" altPlaceholder="e.g. Sunset over Boudhanath" />
    </section>
  );
}

/** Read view: mood glyph + highlight + body for the day's saved entry. */
function JournalReadView({ entry }: { entry: JournalEntry }) {
  const mood = entry.mood ? MOOD_META[entry.mood] : null;

  return (
    <div data-testid="journal-read" aria-live="polite" className="space-y-3">
      {(mood || entry.highlight) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {mood && (
            <span
              data-testid="journal-mood-display"
              className="chip"
            >
              <span aria-hidden="true">{mood.glyph}</span>
              {mood.label}
            </span>
          )}
          {entry.highlight && (
            // DEF-2: the PARENT also needs min-w-0 + max-w-full — as a flex item of the
            // flex-wrap row it otherwise refuses to shrink below the unbroken highlight's
            // intrinsic width (break-words does not affect intrinsic min-content sizing), which
            // left the child's break-words inert and overflowed the page at 360px.
            <span
              data-testid="journal-highlight-display"
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-t-body font-semibold text-ink-hi"
            >
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-ink-lo" aria-hidden="true" />
              <span className="break-words min-w-0">{entry.highlight}</span>
            </span>
          )}
        </div>
      )}
      {entry.text && (
        <p data-testid="journal-body" className="whitespace-pre-wrap break-words text-t-body leading-relaxed text-ink-hi">
          {entry.text}
        </p>
      )}
    </div>
  );
}

/** Edit view: mood chips + highlight input + multiline body + Save/Cancel. */
function JournalEditor({
  text,
  mood,
  highlight,
  highlightInputRef,
  onTextChange,
  onMoodChange,
  onHighlightChange,
  onSave,
  onCancel,
}: {
  text: string;
  mood: Mood | null;
  highlight: string;
  /** Parent-owned ref for the first-field-on-open focus. */
  highlightInputRef: React.RefObject<HTMLInputElement | null>;
  onTextChange: (v: string) => void;
  onMoodChange: (v: Mood | null) => void;
  onHighlightChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div data-testid="journal-editor" className="space-y-4">
      {/* Mood chips — single-select radiogroup-style, but each is a togglable button (tap again to
          clear), so `aria-pressed` (not radio semantics) is the right affordance. */}
      <div>
        <p id="journal-mood-label" className="pr mb-2">
          How was today?
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="journal-mood-label">
          {MOODS.map((m) => {
            const meta = MOOD_META[m];
            const active = mood === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onMoodChange(active ? null : m)}
                aria-pressed={active}
                aria-label={`Mood: ${meta.label}`}
                data-testid={`journal-mood-${m}`}
                className={`chip min-h-tap gap-1.5 px-3 outline-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? 'chip--struck' : 'hover:bg-white/5 hover:text-ink-hi'
                }`}
              >
                <span aria-hidden="true">{meta.glyph}</span>
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Highlight of the day — a short single-line input. */}
      <div>
        <label htmlFor="journal-highlight-input" className="pr mb-1.5 block">
          Highlight of the day <span className="text-ink-lo">(optional)</span>
        </label>
        <input
          ref={highlightInputRef}
          id="journal-highlight-input"
          type="text"
          value={highlight}
          onChange={(e) => onHighlightChange(e.target.value)}
          maxLength={120}
          placeholder="The one thing worth remembering…"
          data-testid="journal-highlight-input"
          className="w-full min-h-tap rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface px-3 py-2 text-t-body text-ink-hi placeholder:text-ink-lo outline-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* The free-text body. */}
      <div>
        <label htmlFor="journal-text-input" className="pr mb-1.5 block">
          Notes
        </label>
        <textarea
          id="journal-text-input"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={4}
          placeholder="What happened today? How did it feel?"
          data-testid="journal-text-input"
          className="w-full resize-y rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface px-3 py-2 text-t-body leading-relaxed text-ink-hi placeholder:text-ink-lo outline-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          data-testid="journal-cancel"
          className="btn btn--2 px-4"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          data-testid="journal-save"
          className="btn px-4"
        >
          Save
        </button>
      </div>
    </div>
  );
}
