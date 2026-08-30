'use client';

import { useRef, useState } from 'react';
import { BookOpen, Camera, ImageOff, Pencil, Search, Sparkles, X } from 'lucide-react';
import { useJournal } from '@/hooks/use-journal';
import type { Mood, JournalEntry } from '@/core/journal/model';
import { formatDateLong } from '@/lib/trip-data';
import JournalCard from '@/components/journal-card';
import { usePhotos } from '@/hooks/use-photos';
import { usePhotoObjectUrl } from '@/hooks/use-photo-object-url';
import PhotoLightbox from '@/components/photo-lightbox';
import type { PhotoMeta } from '@/core/photos/model';

/**
 * — the journal BROWSE view (`/journal`, `app/journal/page.tsx`). Lists every persisted
 * journal entry (`useJournal().entries`, localStorage-only per-day text journal),
 * NEWEST-FIRST, each as a read-only summary row (date / mood / highlight / text). Reached via a
 * direct URL or the "View all entries" link on `journal-card.tsx` ( fence: no nav/tab/
 * palette wiring here — that's an explicit follow-up rider).
 *
 * Editing reuses the REAL `journal-card.tsx` primitive, not a re-implementation: tapping a row's
 * Edit swaps that ONE row for a mounted `<JournalCard date={date} isToday={false} />` (the exact same component
 * the in-trip Today panel uses, incl. its mood chips / highlight input / body textarea / Save /
 * Cancel / the "clear everything removes the entry" behavior). Only ONE `JournalCard` is
 * ever mounted at a time — `journal-card.tsx`'s header/editor ids (`journal-heading`,
 * `journal-mood-label`, `journal-highlight-input`, `journal-text-input`, …) are NOT keyed by
 * date, so mounting more than one at once would duplicate ids (an axe violation); this is why
 * every OTHER row stays a plain summary, never another `JournalCard` instance.
 *
 * The mounted `JournalCard` takes `isToday={false}` so its heading and both aria-labels name the
 * day being edited. It used to hardcode "Today's journal" for a past day (#128).
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
 *
 * SEARCH (#221): a month of entries is not browsable by scrolling, and the question is nearly
 * always "which day was that". The filter is a plain substring match over `entries` — data this
 * component already holds in memory — so there is no index, no dependency and no second read
 * path. It lives HERE rather than in the command palette because the palette has no mobile
 * trigger at all (the hamburger was removed; the bottom tab bar and `/more/` carry no Search
 * row), and the journal is written and re-read on a phone mid-trip. Photos are reachable through
 * their day's text/date only — blobs are never searched.
 */

const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

/**
 * Does one entry match an already-trimmed, already-lowercased query? Matches the body, the
 * highlight, and BOTH date forms — the raw `YYYY-MM-DD` and the rendered `formatDateLong` string,
 * so "december 10" finds the same day the row heading shows. An empty query matches everything.
 * Mood is deliberately not searched: "good" is far too common a word in a body to be a useful
 * facet, and a mood filter is a chip, not a substring match.
 */
export function matchesJournalQuery(entry: JournalEntry, q: string): boolean {
  if (!q) return true;
  return (
    entry.date.includes(q) ||
    formatDateLong(entry.date).toLowerCase().includes(q) ||
    (entry.highlight ?? '').toLowerCase().includes(q) ||
    entry.text.toLowerCase().includes(q)
  );
}

export default function JournalBrowse() {
  const { entries, hydrated } = useJournal();
  const { photosFor, hydrated: photosHydrated } = usePhotos();
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Before hydration, render a stable "loading" shell — never a flash of the empty state.
  if (!hydrated || !photosHydrated) {
    return (
      <section aria-labelledby="journal-browse-heading" data-testid="journal-browse" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="journal-browse-heading" className="sr-only">
          All journal entries
        </h2>
        <p className="empty">Loading your journal…</p>
      </section>
    );
  }

  // Newest-first by date ('YYYY-MM-DD' — lexicographic compare IS chronological, the same
  // invariant `elapsedTripDates`/`getCityForDate` rely on). The active editor's date is always
  // included even if a clear-to-empty save just removed it from `entries` mid-edit, so the open
  // editor never unmounts out from under the traveler — and, for the same reason, an open editor
  // survives a filter that its own day does not match.
  const q = query.trim().toLowerCase();
  const matched = entries.filter((e) => matchesJournalQuery(e, q));
  const dates = new Set(matched.map((e) => e.date));
  if (editingDate) dates.add(editingDate);
  const datesDesc = [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  return (
    <section
      aria-labelledby="journal-browse-heading"
      data-testid="journal-browse"
      className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6"
    >
      <header className="mb-6">
        <p className="pr mb-2 flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Every day, in your words
        </p>
        <h2 id="journal-browse-heading" className="text-display-lg text-ink-hi">
          All journal entries
        </h2>
      </header>

      {/* The filter is pointless — and a confusing empty control — when nothing is written yet. */}
      {entries.length > 0 && (
        <div className="mb-6">
          <label htmlFor="journal-search-input" className="sr-only">
            Search journal entries
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-lo" aria-hidden="true" />
            <input
              id="journal-search-input"
              // `text`, not `search`: the UA clear button `type="search"` adds does not follow the
              // dark palette, and the 44px button below already does the job (map-section.tsx).
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entries by word, place or date…"
              data-testid="journal-browse-search"
              className="min-h-tap w-full rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface-low py-3 pl-9 pr-12 text-t-body text-ink-hi placeholder:text-ink-lo focus:outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                data-testid="journal-browse-search-clear"
                className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-r1 text-ink-mid outline-none transition-colors duration-200 hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          {/* Kept MOUNTED with empty content when there is no query: a live region that appears
              at the same moment as its first text is routinely not announced at all. */}
          <p
            role="status"
            aria-live="polite"
            data-testid="journal-browse-search-status"
            className="pr pr--lo mt-2 min-h-[1.25rem]"
          >
            {q ? `${matched.length} of ${entries.length} entries match` : ''}
          </p>
        </div>
      )}

      {datesDesc.length > 0 ? (
        <ul data-testid="journal-browse-list" className="space-y-4">
          {datesDesc.map((date) => (
            <li key={date}>
              {editingDate === date ? (
                <JournalCard date={date} isToday={false} />
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
      ) : entries.length === 0 ? (
        <div data-testid="journal-browse-empty" className="empty-frame p-6 text-center">
          <p className="empty">Unwritten &mdash; every trip day is still blank.</p>
          <p className="empty mt-1">
            Write about a trip day from the Today panel — it will show up here.
          </p>
        </div>
      ) : (
        <div data-testid="journal-browse-no-match" className="empty-frame p-6 text-center">
          <p className="empty">No entries match that search.</p>
          <p className="empty mt-1">Try a shorter word, a place name, or a date like December 10.</p>
        </div>
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
      className="border-hair border-border bg-surface-low p-4 sm:p-5"
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <h3 id={headingId} className="pr pr--l">
          {formatDateLong(date)}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          data-testid={`journal-browse-edit-${date}`}
          aria-label={`Edit journal entry for ${formatDateLong(date)}`}
          className="chip min-h-tap flex-shrink-0 gap-1.5 px-3 outline-none transition-colors duration-200 hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="chip"
            >
              <span aria-hidden="true">{mood.glyph}</span>
              {mood.label}
            </span>
          )}
          {entry?.highlight && (
            <span
              data-testid={`journal-browse-highlight-${date}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-t-body font-semibold text-ink-hi"
            >
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-ink-lo" aria-hidden="true" />
              <span className="min-w-0 break-words">{entry.highlight}</span>
            </span>
          )}
        </div>
      )}

      {entry?.text && (
        <p
          data-testid={`journal-browse-body-${date}`}
          className="whitespace-pre-wrap break-words text-t-body leading-relaxed text-ink-hi"
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
  // Lightbox (#225): still read-only for add/edit/delete — the one interactive control this strip
  // gains is "view full-size", via the shared PhotoLightbox/Sheet.
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoMeta | null>(null);
  const lightboxTriggerRef = useRef<HTMLElement | null>(null);

  if (photos.length === 0) return null;

  return (
    <div data-testid={`journal-browse-photos-${date}`} className="mt-3 border-t-2 border-border pt-3">
      <p className="pr mb-2 flex items-center gap-1.5">
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        Photos
      </p>
      {/* tabIndex=0 keeps the horizontal strip scrollable without a mouse. No role="region"
          here — it would clobber the list role, and the aria-label already names it. */}
      <ul
        tabIndex={0}
        className="flex gap-2 overflow-x-auto pb-1 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Photos from ${formatDateLong(date)}`}
      >
        {photos.map((meta) => (
          <JournalPhotoThumb
            key={meta.id}
            meta={meta}
            onOpen={() => {
              lightboxTriggerRef.current = (document.activeElement as HTMLElement) ?? null;
              setLightboxPhoto(meta);
            }}
          />
        ))}
      </ul>

      <PhotoLightbox
        open={lightboxPhoto !== null}
        photo={lightboxPhoto}
        onClose={() => setLightboxPhoto(null)}
        onExitComplete={() => lightboxTriggerRef.current?.focus?.()}
      />
    </div>
  );
}

/**
 * One thumbnail: resolves the blob -> object URL (`usePhotoObjectUrl`, the idiom, revoked on
 * unmount/id-change), or degrades to the placeholder tile (alt/caption survive) when the blob was
 * evicted/absent. Still no add/delete/edit control (read-only surface) — `onOpen` only opens the
 * full-size lightbox (#225).
 */
function JournalPhotoThumb({ meta, onOpen }: { meta: PhotoMeta; onOpen: () => void }) {
  const { url, missing } = usePhotoObjectUrl(meta.id);

  return (
    <li
      data-testid={`journal-browse-photo-${meta.id}`}
      data-missing={missing ? 'true' : 'false'}
      className="relative aspect-square w-20 flex-shrink-0 overflow-hidden border-hair border-border bg-surface-low sm:w-24"
    >
      {missing ? (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center"
          title={meta.caption ?? meta.altText}
        >
          <ImageOff className="h-4 w-4 text-ink-lo" aria-hidden="true" />
          <span className="sr-only">Photo no longer on this device</span>
        </div>
      ) : url ? (
        <button
          type="button"
          onClick={onOpen}
          data-testid={`journal-browse-photo-open-${meta.id}`}
          aria-label={`View photo: ${meta.altText}`}
          className="block h-full w-full outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL of a device-only blob; next/image can't optimize a runtime Blob and disables optimization anyway. */}
          <img src={url} alt={meta.altText} className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="load h-full w-full"><span className="pr pr--lo">Loading</span></div>
      )}

      {meta.caption && !missing && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2 text-t-micro text-ink-hi">
          {meta.caption}
        </span>
      )}
    </li>
  );
}
