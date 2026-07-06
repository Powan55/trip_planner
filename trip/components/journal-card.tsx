'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Pencil, Sparkles } from 'lucide-react';
import { useJournal } from '@/hooks/use-journal';
import { MOODS, type Mood, type JournalEntry } from '@/core/journal/model';

/**
 * The in-trip per-day TEXT journal card.
 *
 * Renders INSIDE the in-trip Today panel (`components/today-panel.tsx`), below the agenda — so it is
 * intrinsically in-trip-gated (the panel is `null` outside the trip window) and demoable via `?today=`.
 * Reads/writes TODAY'S entry through `useJournal()` → the framework-free journal core +
 * gateway key 12 (localStorage only). Photos are OUT (declared future boundary).
 *
 * Two states:
 *   - READ (an entry exists): mood glyph + highlight + body, with an Edit control.
 *   - EMPTY (no entry): a "Write about today" prompt that opens the editor.
 * Edit mode: a mood-chip selector (single-select, togglable to clear), a short highlight input, a
 * multiline text area, and Save + Cancel. Save calls `saveEntry(date, {text, mood, highlight})`;
 * clearing everything + Save removes the entry (the empty state returns).
 *
 * A11y (non-negotiable, AA): real `<label>`s, visible focus rings (`focus-visible:ring-gold-400`,
 * matching the panel), ≥44px targets, `aria-pressed` on mood chips, an `aria-live` region on the read
 * view. Static markup + CSS-only transitions → reduced-motion-safe by construction (the parent panel
 * owns the already-gated reveal). Design: the panel's glass-card / navy / gold-accent language.
 */

// The mood glyph + label used in the read view + the chip selector (kept in MOODS order).
const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

export default function JournalCard({ date }: { date: string }) {
  const { getEntry, saveEntry, hydrated } = useJournal();
  const entry = getEntry(date);

  // Editor open/closed + its draft fields. Closed by default; opens on Edit / the empty prompt.
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftMood, setDraftMood] = useState<Mood | null>(null);
  const [draftHighlight, setDraftHighlight] = useState('');

  // Seed the draft from the current entry whenever we OPEN the editor (or the day changes under it).
  const openEditor = () => {
    const cur = getEntry(date);
    setDraftText(cur?.text ?? '');
    setDraftMood(cur?.mood ?? null);
    setDraftHighlight(cur?.highlight ?? '');
    setEditing(true);
  };

  // If the trip day rolls over (midnight self-correct in the panel) while the editor is open, close
  // it so we never save a stale day's draft onto a new day.
  useEffect(() => {
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

  // Before hydration, render a stable read/empty shell (the parent panel already gates on `hydrated`,
  // so this is belt-and-braces — never renders a flash of the wrong state).
  return (
    <section
      aria-labelledby="journal-heading"
      data-testid="journal-card"
      className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3
          id="journal-heading"
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gold-400/90"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Today&apos;s journal
        </h3>
        {!editing && entry && (
          <button
            type="button"
            onClick={openEditor}
            data-testid="journal-edit"
            aria-label="Edit today's journal entry"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </button>
        )}
      </header>

      {editing ? (
        <JournalEditor
          text={draftText}
          mood={draftMood}
          highlight={draftHighlight}
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
          type="button"
          onClick={openEditor}
          data-testid="journal-write-prompt"
          className="flex w-full min-h-[44px] items-center gap-3 rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-3 text-left text-sm text-white/60 outline-none transition-colors duration-200 hover:border-gold-400/40 hover:bg-white/[0.05] hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        >
          <Pencil className="h-4 w-4 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
          <span>
            Write about today
            {hydrated ? '' : '…'}
          </span>
        </button>
      )}
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
              className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/25 bg-gold-400/[0.08] px-2.5 py-1 text-xs font-medium text-gold-400"
            >
              <span aria-hidden="true">{mood.glyph}</span>
              {mood.label}
            </span>
          )}
          {entry.highlight && (
            <span
              data-testid="journal-highlight-display"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90"
            >
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
              <span>{entry.highlight}</span>
            </span>
          )}
        </div>
      )}
      {entry.text && (
        <p data-testid="journal-body" className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">
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
  onTextChange,
  onMoodChange,
  onHighlightChange,
  onSave,
  onCancel,
}: {
  text: string;
  mood: Mood | null;
  highlight: string;
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
        <p id="journal-mood-label" className="mb-2 text-xs font-medium text-white/60">
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
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium outline-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 ${
                  active
                    ? 'border-gold-400 bg-gold-400/15 text-gold-400'
                    : 'border-white/15 bg-white/[0.03] text-white/70 hover:border-white/30 hover:text-white'
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
        <label htmlFor="journal-highlight-input" className="mb-1.5 block text-xs font-medium text-white/60">
          Highlight of the day <span className="text-white/40">(optional)</span>
        </label>
        <input
          id="journal-highlight-input"
          type="text"
          value={highlight}
          onChange={(e) => onHighlightChange(e.target.value)}
          maxLength={120}
          placeholder="The one thing worth remembering…"
          data-testid="journal-highlight-input"
          className="w-full min-h-[44px] rounded-lg border border-white/15 bg-navy-900/60 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none transition-colors duration-200 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        />
      </div>

      {/* The free-text body. */}
      <div>
        <label htmlFor="journal-text-input" className="mb-1.5 block text-xs font-medium text-white/60">
          Notes
        </label>
        <textarea
          id="journal-text-input"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={4}
          placeholder="What happened today? How did it feel?"
          data-testid="journal-text-input"
          className="w-full resize-y rounded-lg border border-white/15 bg-navy-900/60 px-3 py-2 text-sm leading-relaxed text-white placeholder:text-white/35 outline-none transition-colors duration-200 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          data-testid="journal-cancel"
          className="inline-flex min-h-[44px] items-center rounded-lg px-4 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          data-testid="journal-save"
          className="inline-flex min-h-[44px] items-center rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-navy-900 outline-none transition-colors duration-200 hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        >
          Save
        </button>
      </div>
    </div>
  );
}
