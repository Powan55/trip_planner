'use client';

import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { BookOpen, Camera, Check, ImageOff, Sparkles, Wallet } from 'lucide-react';
import { formatDateLong } from '@/lib/trip-data';
import { getCityForDate, getCountryForDate, TRIP_DATES } from '@/core/dates';
import { getNow } from '@/lib/trip-now';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useJournal } from '@/hooks/use-journal';
import { type Mood, type JournalEntry } from '@/core/journal/model';
import { summarizePlan, elapsedTripDates, sumExpensesForDate, isPostTrip, type PlanSummary } from '@/core/recap/model';
import { useExpenses } from '@/hooks/use-expenses';
import { legCurrency, formatMoney } from '@/core/budget/model';
import { usePhotos } from '@/hooks/use-photos';
import { usePhotoObjectUrl } from '@/hooks/use-photo-object-url';
import type { PhotoMeta } from '@/core/photos/model';
import SectionSkeleton from '@/components/section-skeleton';
import type { ItineraryItem } from '@/lib/trip-data';

/**
 * — the POST-TRIP STORY: a read-only, scroll-storytelling TEXT recap on its own `/recap`
 * route (separate from the compact home `TripRecap` card island, `components/trip-recap.tsx`,
 * which stays untouched — a prose narrative is a different presentation over the SAME pure data
 * layer, read-only). Reuses `core/recap/model.ts`'s pure functions and mirrors the read
 * hooks `trip-recap.tsx` already established; adds nothing new to the persisted domains.
 *
 * Two states, gated on `isPostTrip(nowDateStr)` (: the pure fn takes the already-
 * resolved clock string; the clock read itself stays here, the I/O boundary):
 * - POST-TRIP: the full chronological (Dec 9 -> Jan 9, oldest-first — a narrative reads
 * forward, the OPPOSITE order of the home card's most-recent-first) day-by-day story, opening
 * with a trip-level summary and closing with a sign-off.
 * - PRE/IN-TRIP: a tasteful "your story unlocks after the trip" state — never a half-built
 * story for a direct-URL visitor mid-trip.
 *
 * Reduced motion: the global `<MotionConfig reducedMotion="user">` (`theme-provider.tsx`)
 * auto-neutralizes every `m.*` transition here — no manual `useReducedMotion` guard needed
 *, matching `presence-bar.tsx` / `offline-banner.tsx`'s established pattern.
 *
 * each day also gets a READ-ONLY thumbnail strip of that day's journal photos
 * (`usePhotos().photosFor({kind:'journal',date})` — a pure filter, no mutator reachable from here).
 * Present only when the day has >=1 photo; an evicted blob (`BlobStorePort.get`->null) renders the
 * placeholder tile, never a broken `<img>`.
 */

const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

/** The resolved clock's LOCAL calendar day as 'YYYY-MM-DD' (matches trip-recap.tsx's helper). */
function nowDateString(): string {
  const d = getNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const LAST_TRIP_DATE = TRIP_DATES[TRIP_DATES.length - 1];

export default function TripStoryRecap() {
  const { getDayPlan, hydrated: itineraryHydrated } = useItineraryContext();
  const { getEntry, hydrated: journalHydrated } = useJournal();
  const { expenses, hydrated: expensesHydrated } = useExpenses();
  const { photosFor, hydrated: photosHydrated } = usePhotos();

  // '' until mount (SSR-safe default) — a single mount read is enough (post-trip status doesn't
  // change second-to-second; no interval needed, per the brief).
  const [nowDateStr, setNowDateStr] = useState<string>('');
  useEffect(() => {
    setNowDateStr(nowDateString());
  }, []);

  const hydrated =
    itineraryHydrated && journalHydrated && expensesHydrated && photosHydrated && nowDateStr !== '';

  // Gate on hydration (all three stores + the clock) — a loading shell until then, so a
  // corrupt/pre-hydrate frame never renders instead of the real story or the locked state.
  if (!hydrated) {
    return (
      <div data-testid="trip-story-recap">
        <SectionSkeleton height="60vh" count={4} />
      </div>
    );
  }

  if (!isPostTrip(nowDateStr)) {
    return <StoryLocked nowDateStr={nowDateStr} />;
  }

  // Post-trip: every trip day has elapsed, in chronological (oldest-first) order already —
  // exactly the narrative's reading order, no reversal needed (unlike the home card).
  const days = elapsedTripDates(nowDateStr);

  let totalDone = 0;
  let totalPlanned = 0;
  let journaledDays = 0;
  let spendNepal = 0;
  let spendJapan = 0;

  const dayData = days.map((date) => {
    const items = getDayPlan(date).items;
    const summary = summarizePlan(items);
    const entry = getEntry(date);
    const spend = sumExpensesForDate(expenses, date);
    totalDone += summary.done;
    totalPlanned += summary.planned;
    if (entry) journaledDays += 1;
    if (spend > 0) {
      if (getCountryForDate(date) === 'nepal') spendNepal += spend;
      else spendJapan += spend;
    }
    const photos = photosFor({ kind: 'journal', date });
    return { date, items, summary, entry, spend, photos };
  });

  return (
    <section
      id="trip-story"
      aria-labelledby="story-title"
      data-testid="trip-story-recap"
      className="px-gutter py-section"
    >
      <div className="mx-auto max-w-3xl">
        {/* The trip-level summary — opens the story. */}
        <header className="mb-10 text-center">
          <p className="text-eyebrow mb-3 uppercase text-gold-400/80">The story, cover to cover</p>
          <h2 id="story-title" className="font-display text-2xl sm:text-3xl font-bold text-white mb-4">
            <span className="text-gradient-gold">{days.length} days</span>, one journey
          </h2>
          <p data-testid="story-trip-summary" className="mx-auto max-w-2xl text-base leading-relaxed text-white/65">
            {totalPlanned > 0 ? (
              <>
                <span className="font-semibold text-gold-400">{totalDone}</span> of {totalPlanned} planned
                activities done
              </>
            ) : (
              'A trip with room to wander'
            )}
            {(spendNepal > 0 || spendJapan > 0) && (
              <>
                {' — '}
                {spendNepal > 0 && <>spent {formatMoney(spendNepal, 'NPR')} in Nepal</>}
                {spendNepal > 0 && spendJapan > 0 && ' and '}
                {spendJapan > 0 && <>spent {formatMoney(spendJapan, 'JPY')} in Japan</>}
              </>
            )}
            {journaledDays > 0 && (
              <>
                , with {journaledDays} {journaledDays === 1 ? 'day' : 'days'} journaled along the way
              </>
            )}
            .
          </p>
        </header>

        <div className="space-y-6">
          {dayData.map(({ date, items, summary, entry, spend, photos }, idx) => (
            <DayStory
              key={date}
              date={date}
              dayNumber={idx + 1}
              items={items}
              summary={summary}
              entry={entry}
              spend={spend}
              photos={photos}
            />
          ))}
        </div>

        <footer className="mt-12 text-center">
          <p className="text-sm italic text-white/45">
            And that was the trip — Nepal, then Japan, {days.length} days in all.
          </p>
        </footer>
      </div>
    </section>
  );
}

/**
 * The "your story unlocks after the trip" state — rendered for any pre/in-trip visit
 * (including a direct-URL visit mid-trip). NOT a half-built story: no per-day content at all.
 */
function StoryLocked({ nowDateStr }: { nowDateStr: string }) {
  const elapsed = elapsedTripDates(nowDateStr);

  return (
    <section
      id="trip-story"
      aria-labelledby="story-locked-title"
      data-testid="trip-story-recap"
      className="px-gutter py-section"
    >
      <div data-testid="trip-story-locked" className="glass-card mx-auto max-w-2xl rounded-3xl p-8 text-center sm:p-12">
        <p className="text-eyebrow mb-3 uppercase text-gold-400/80">Coming soon</p>
        <h2 id="story-locked-title" className="font-display text-2xl font-bold text-white sm:text-3xl">
          Your story unlocks after the trip
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/60">
          Once the last day in Japan wraps on {formatDateLong(LAST_TRIP_DATE)}, this page becomes a
          full day-by-day narrative of the trip — weaving what was planned, what actually happened,
          your journal reflections, and what was spent.
        </p>
        {elapsed.length > 0 && (
          <p className="mt-4 text-sm text-white/45">
            So far you&apos;ve lived <span className="font-semibold text-gold-400">{elapsed.length}</span> of{' '}
            {TRIP_DATES.length} trip days — come back once the trip wraps to read the whole story.
          </p>
        )}
      </div>
    </section>
  );
}

/** One day's scroll-revealed story section — prose plan-vs-actual + journal reflection + spend. */
function DayStory({
  date,
  dayNumber,
  items,
  summary,
  entry,
  spend,
  photos,
}: {
  date: string;
  dayNumber: number;
  items: ItineraryItem[];
  summary: PlanSummary;
  entry: JournalEntry | null;
  spend: number;
  photos: PhotoMeta[];
}) {
  const city = getCityForDate(date);
  const country = getCountryForDate(date);
  const mood = entry?.mood ? MOOD_META[entry.mood] : null;
  const headingId = `story-day-${date}-heading`;

  return (
    <m.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      aria-labelledby={headingId}
      data-testid={`story-day-${date}`}
      className="glass-card rounded-2xl p-6 sm:p-8"
    >
      <header className="mb-4">
        <h3 id={headingId} className="font-display text-lg font-bold leading-tight text-white sm:text-xl">
          Day <span className="text-gold-400">{dayNumber}</span>
          <span className="mx-2 text-white/40" aria-hidden="true">
            —
          </span>
          {city}
        </h3>
        <p className="mt-0.5 text-xs text-white/55">{formatDateLong(date)}</p>
      </header>

      {/* Plan-vs-actual, in prose: the run-rate line + the read-only item list. */}
      {summary.planned === 0 ? (
        <p data-testid={`story-no-plan-${date}`} className="mb-3 text-sm italic text-white/55">
          A free day — nothing was planned.
        </p>
      ) : (
        <>
          <p data-testid={`story-plan-summary-${date}`} className="mb-2 text-sm text-white/70">
            <span className="font-semibold text-gold-400">{summary.done}</span> of {summary.planned} planned{' '}
            {summary.planned === 1 ? 'activity' : 'activities'} done.
          </p>
          <ul data-testid={`story-plan-${date}`} className="mb-3 space-y-1" aria-label={`Plan for Day ${dayNumber}, ${city}`}>
            {items.map((item) => {
              const done = item.done === true;
              return (
                <li
                  key={item.id}
                  data-testid="story-plan-item"
                  data-done={done ? 'true' : 'false'}
                  className="flex items-start gap-2 text-sm"
                >
                  <span aria-hidden="true" className={`mt-0.5 flex-shrink-0 ${done ? 'text-emerald-400' : 'text-white/25'}`}>
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span className={done ? 'text-white/45 line-through' : 'text-white/80'}>{item.title}</span>
                  <span className="sr-only">{done ? '— done' : '— not done'}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* The day's journal reflection, read-only. */}
      {entry && (
        <div data-testid={`story-journal-${date}`} className="mt-3 border-t border-white/10 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gold-400/80">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Reflection
          </p>
          {(mood || entry.highlight) && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              {mood && (
                <span
                  data-testid={`story-journal-mood-${date}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/25 bg-gold-400/[0.08] px-2.5 py-1 text-xs font-medium text-gold-400"
                >
                  <span aria-hidden="true">{mood.glyph}</span>
                  {mood.label}
                </span>
              )}
              {entry.highlight && (
                <span
                  data-testid={`story-journal-highlight-${date}`}
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-medium text-white/90"
                >
                  <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
                  <span className="min-w-0 break-words">{entry.highlight}</span>
                </span>
              )}
            </div>
          )}
          {entry.text && (
            <p
              data-testid={`story-journal-body-${date}`}
              className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/65"
            >
              {entry.text}
            </p>
          )}
        </div>
      )}

      {/* that day's journal photos, read-only. */}
      <StoryPhotos date={date} dayNumber={dayNumber} city={city} photos={photos} />

      {/* The day's logged spend, in the day's leg-local currency — only when >0. */}
      {spend > 0 && (
        <p data-testid={`story-spend-${date}`} className="mt-3 flex items-center gap-1.5 text-sm text-white/60">
          <Wallet className="h-3.5 w-3.5 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
          Spent <span className="font-semibold text-white/85">{formatMoney(spend, legCurrency(country))}</span>
        </p>
      )}
    </m.article>
  );
}

/**
 * — the day's journal photos, read-only. `photos` is the already-filtered
 * `photosFor({kind:'journal',date})` result (a pure filter over the local key-16 index, computed
 * once in `TripStoryRecap`) — this component only renders it. Present ONLY when `photos.length >
 * 0`, mirroring `story-journal-<date>` / `story-spend-<date>`'s presence gating; renders nothing
 * (no empty box) on a photo-less day.
 */
export function StoryPhotos({
  date,
  dayNumber,
  city,
  photos,
}: {
  date: string;
  dayNumber: number;
  city: string;
  photos: PhotoMeta[];
}) {
  if (photos.length === 0) return null;

  return (
    <div data-testid={`story-photos-${date}`} className="mt-3 border-t border-white/10 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gold-400/80">
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        Photos
      </p>
      <ul
        className="flex gap-2 overflow-x-auto pb-1"
        aria-label={`Photos from Day ${dayNumber}, ${city}`}
      >
        {photos.map((meta) => (
          <StoryPhotoThumb key={meta.id} meta={meta} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One read-only thumbnail: resolves the blob -> object URL (`usePhotoObjectUrl`, the idiom,
 * revoked on unmount/id-change — no leaks), or degrades to the placeholder tile (alt/caption
 * survive) when the blob was evicted/absent. No delete/edit control — this surface is read-only.
 */
function StoryPhotoThumb({ meta }: { meta: PhotoMeta }) {
  const { url, missing } = usePhotoObjectUrl(meta.id);

  return (
    <li
      data-testid={`story-photo-${meta.id}`}
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
