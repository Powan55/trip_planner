'use client';

import { useState } from 'react';
import { BookOpen, Camera, ImageOff, Pencil, Sparkles } from 'lucide-react';
import { useJournal } from '@/hooks/use-journal';
import type { Mood, JournalEntry } from '@/core/journal/model';
import { formatDateLong } from '@/lib/trip-data';
import JournalCard from '@/components/journal-card';
import { usePhotos } from '@/hooks/use-photos';
import { usePhotoObjectUrl } from '@/hooks/use-photo-object-url';
import type { PhotoMeta } from '@/core/photos/model';

/**
 * — the journal BROWSE view (`/journal`, `app/journal/page.tsx`). Lists every persisted
 * journal entry (`useJournal().entries`, localStorage-only per-day text journal),
 * NEWEST-FIRST, each as a read-only summary row (date / mood / highlight / text). Reached via a
 * direct URL or the "View all entries" link on `journal-card.tsx` (S113D fence: no nav/tab/
 * palette wiring here — that's an explicit follow-up rider).
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
 * KNOWN LIMITATION (flagged, not fixed — out of this slice's fence, which scoped journal-card.tsx
 * changes to "entry link only"): while editing a PAST day from this list, the mounted
 * `JournalCard`'s heading still reads "Today's journal" (a hardcoded literal in that component,
 * unconditioned on the actual date) — cosmetically wrong for a non-today day, though every
 * testid/behavior/persistence path is correct. A generic `heading` prop would fix it; deferred.
 *
 * READ-ONLY over nothing new: this component reads `useJournal()` (already the app's own
 * reactive journal store) and writes only through `JournalCard`'s existing `saveEntry`/
 * `removeEntry` paths — no new persistence, no new localStorage key ( journal privacy
 * unchanged: still localStorage-only, still never synced).
 *
 * A11y: a section `h2`, one `h3` per entry row, visible focus rings, ≥44px
 * targets, static markup (no motion-only affordance) → reduced-motion-safe by construction.
 *
 * each row also gets a READ-ONLY thumbnail strip of that day's journal
 * photos — the SAME pattern `trip-story-recap.tsx` got in (`usePhotos().photosFor({kind:
 * 'journal', date})`, a pure filter; `usePhotoObjectUrl` for the blob->objectURL->revoke
 * lifecycle; the placeholder tile on an evicted/missing blob). Present only when the day
 * has >=1 photo, mirroring the existing "only show what exists" gate already used for mood/
 * highlight. No add/delete control here — that stays on the in-trip Today panel's capture UI
 *; this view is read-only for photos exactly as it already is for text/mood.
 */

const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

export default function JournalBrowse() {
  const { entries, hydrated } = useJournal();
  const { photosFor, hydrated: photosHydrated } = usePhotos();
  const [editingDate, setEditingDate] = useState<string | null>(null);

  // Before hydration, render a stable "loading" shell — never a flash of the empty state.
  if (!hydrated || !photosHydrated) {
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
                  photos={photosFor({ kind: 'journal', date })}
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

/** One read-only entry row: date + mood + highlight + text + photos, with an Edit control. */
function JournalRow({
  date,
  entry,
  photos,
  onEdit,
}: {
  date: string;
  entry: JournalEntry | null;
  photos: PhotoMeta[];
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
          className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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

      <JournalPhotoStrip date={date} photos={photos} />
    </article>
  );
}

/**
 * — that day's journal photos, read-only. `photos` is the already-filtered
 * `photosFor({kind:'journal',date})` result — this component only renders it. Present ONLY when
 * `photos.length > 0` (mirrors `trip-story-recap.tsx`'s `StoryPhotos`); renders nothing on a
 * photo-less day.
 */
export function JournalPhotoStrip({ date, photos }: { date: string; photos: PhotoMeta[] }) {
  if (photos.length === 0) return null;

  return (
    <div data-testid={`journal-browse-photos-${date}`} className="mt-3 border-t border-white/10 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gold-400/80">
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        Photos
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1" aria-label={`Photos from ${formatDateLong(date)}`}>
        {photos.map((meta) => (
          <JournalPhotoThumb key={meta.id} meta={meta} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One read-only thumbnail: resolves the blob -> object URL (`usePhotoObjectUrl`, the
 * idiom, revoked on unmount/id-change), or degrades to the placeholder tile (alt/caption survive)
 * when the blob was evicted/absent. No delete/edit control — this surface is read-only.
 */
function JournalPhotoThumb({ meta }: { meta: PhotoMeta }) {
  const { url, missing } = usePhotoObjectUrl(meta.id);

  return (
    <li
      data-testid={`journal-browse-photo-${meta.id}`}
      data-missing={missing ? 'true' : 'false'}
      className="relative aspect-square w-20 flex-shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] sm:w-24"
    >
      {missing ? (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center"
          title={meta.caption ?? meta.altText}
        >
          <ImageOff className="h-4 w-4 text-white/40" aria-hidden="true" />
          <span className="sr-only">Photo no longer on this device</span>
        </div>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL of a device-only blob; next/image can't optimize a runtime Blob and disables optimization anyway.
        <img src={url} alt={meta.altText} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-white/[0.04]" aria-hidden="true" />
      )}

      {meta.caption && !missing && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2 text-[9px] text-white/80">
          {meta.caption}
        </span>
      )}
    </li>
  );
}
