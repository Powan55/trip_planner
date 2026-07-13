'use client';

import { useState } from 'react';
import { BookOpen, Pencil, Sparkles } from 'lucide-react';
import { useJournal } from '@/hooks/use-journal';
import type { Mood, JournalEntry } from '@/core/journal/model';
import { formatDateLong } from '@/lib/trip-data';
import JournalCard from '@/components/journal-card';

/**
 * The journal BROWSE view (`/journal`, `app/journal/page.tsx`). Lists every persisted
 * journal entry (`useJournal().entries`, the localStorage-only per-day text journal),
 * NEWEST-FIRST, each as a read-only summary row (date / mood / highlight / text). Reached via a
 * direct URL or the "View all entries" link on `journal-card.tsx`.
 *
 * Editing reuses the REAL `journal-card.tsx` primitive, not a re-implementation: tapping a row's
 * Edit swaps that ONE row for a mounted `<JournalCard date={date} />` (the exact same component
 * the in-trip Today panel uses, incl. its mood chips / highlight input / body textarea / Save /
 * Cancel / the "clear everything removes the entry" behavior). Only ONE `JournalCard` is
 * ever mounted at a time — `journal-card.tsx`'s header/editor ids (`journal-heading`,
 * `journal-mood-label`, `journal-highlight-input`, `journal-text-input`, …) are NOT keyed by
 * date, so mounting more than one at once would duplicate ids (an axe violation); this is why
 * every OTHER row stays a plain summary, never another `JournalCard` instance.
 *
 * KNOWN LIMITATION (flagged, not fixed): while editing a PAST day from this list, the mounted
 * `JournalCard`'s heading still reads "Today's journal" (a hardcoded literal in that component,
 * unconditioned on the actual date) — cosmetically wrong for a non-today day, though every
 * testid/behavior/persistence path is correct. A generic `heading` prop would fix it; deferred.
 *
 * READ-ONLY over nothing new: this component reads `useJournal()` (already the app's own
 * reactive journal store) and writes only through `JournalCard`'s existing `saveEntry`/
 * `removeEntry` paths — no new persistence, no new localStorage key (journal privacy
 * unchanged: still localStorage-only, still never synced).
 *
 * A11y: a section `h2`, one `h3` per entry row, visible focus rings, ≥44px
 * targets, static markup (no motion-only affordance) → reduced-motion-safe by construction.
 */

const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

export default function JournalBrowse() {
  const { entries, hydrated } = useJournal();
  const [editingDate, setEditingDate] = useState<string | null>(null);

  // Before hydration, render a stable "loading" shell — never a flash of the empty state.
  if (!hydrated) {
    return (
      <section aria-labelledby="journal-browse-heading" data-testid="journal-browse" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="journal-browse-heading" className="sr-only">
          All journal entries
        </h2>
        <p className="text-sm text-white/55">Loading your journal…</p>
      </section>
    );
  }

  // Newest-first by date ('YYYY-MM-DD' — lexicographic compare IS chronological, the same
  // invariant `elapsedTripDates`/`getCityForDate` rely on). The active editor's date is always
  // included even if a clear-to-empty save just removed it from `entries` mid-edit, so the open
  // editor never unmounts out from under the traveler.
  const dates = new Set(entries.map((e) => e.date));
  if (editingDate) dates.add(editingDate);
  const datesDesc = [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  return (
    <section
      aria-labelledby="journal-browse-heading"
      data-testid="journal-browse"
      className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6"
    >
      <header className="mb-6">
        <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-gold-400/80">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Every day, in your words
        </p>
        <h2 id="journal-browse-heading" className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
          All journal <span className="text-gradient-gold">entries</span>
        </h2>
      </header>

      {datesDesc.length === 0 ? (
        <div data-testid="journal-browse-empty" className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
          <p className="text-sm text-white/65">No journal entries yet.</p>
          <p className="mt-1 text-xs text-white/50">
            Write about a trip day from the Today panel — it will show up here.
          </p>
        </div>
      ) : (
        <ul data-testid="journal-browse-list" className="space-y-4">
          {datesDesc.map((date) => (
            <li key={date}>
              {editingDate === date ? (
                <JournalCard date={date} />
              ) : (
                <JournalRow
                  date={date}
                  entry={entries.find((e) => e.date === date) ?? null}
                  onEdit={() => setEditingDate(date)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One read-only entry row: date + mood + highlight + text, with an Edit control. */
function JournalRow({
  date,
  entry,
  onEdit,
}: {
  date: string;
  entry: JournalEntry | null;
  onEdit: () => void;
}) {
  const mood = entry?.mood ? MOOD_META[entry.mood] : null;
  const headingId = `journal-browse-row-${date}-heading`;

  return (
    <article
      aria-labelledby={headingId}
      data-testid={`journal-browse-row-${date}`}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-white">
          {formatDateLong(date)}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          data-testid={`journal-browse-edit-${date}`}
          aria-label={`Edit journal entry for ${formatDateLong(date)}`}
          className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </button>
      </header>

      {(mood || entry?.highlight) && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {mood && (
            <span
              data-testid={`journal-browse-mood-${date}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/25 bg-gold-400/[0.08] px-2.5 py-1 text-xs font-medium text-gold-400"
            >
              <span aria-hidden="true">{mood.glyph}</span>
              {mood.label}
            </span>
          )}
          {entry?.highlight && (
            <span
              data-testid={`journal-browse-highlight-${date}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-medium text-white/90"
            >
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
              <span className="min-w-0 break-words">{entry.highlight}</span>
            </span>
          )}
        </div>
      )}

      {entry?.text && (
        <p
          data-testid={`journal-browse-body-${date}`}
          className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/70"
        >
          {entry.text}
        </p>
      )}
    </article>
  );
}
