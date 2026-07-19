'use client';

import { useEffect, useState } from 'react';
import { m, useReducedMotion, type Variants } from 'framer-motion';
import { BookOpen, Check, Clock, History, Sparkles, Wallet } from 'lucide-react';
import { formatDateLong, CATEGORY_COLORS, type ItineraryItem } from '@/lib/trip-data';
import { getCityForDate, getCountryForDate } from '@/core/dates';
import { getNow } from '@/lib/trip-now';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useJournal } from '@/hooks/use-journal';
import { type Mood, type JournalEntry } from '@/core/journal/model';
import { summarizePlan, elapsedTripDates, sumExpensesForDate } from '@/core/recap/model';
import { useExpenses } from '@/hooks/use-expenses';
import { legCurrency, formatMoney } from '@/core/budget/model';

/**
 * —: the read-only plan-vs-actual DAY RECAP island.
 *
 * A Home island that, for each trip day that has already HAPPENED (as of the app clock, incl. the
 * `?today=` override), pairs three things — READ-ONLY:
 * - the PLAN: that day's itinerary items (`useItineraryContext().getDayPlan(date).items`,),
 * - the ACTUAL: which items are marked done + a "{done} of {planned} done" line,
 * - the REFLECTION: that day's journal entry (`useJournal().getEntry(date)`,) rendered read-only.
 *
 * It appears DURING and AFTER the trip (so you can look back over the days you've lived) and renders
 * `null` PRE-trip (Home is byte-unchanged before Dec 9) or before all stores hydrate. It MUTATES
 * NOTHING — editing the plan stays in the calendar, editing the journal stays in the Today panel,
 * expenses are logged from the budget panel; this is a pure surface over the persisted domains
 *.
 *
 * adds a fourth, purely additive read: a per-day SPEND line (`core/recap/model.ts`'s
 * `sumExpensesForDate`, summing the expense store's entries for that date), shown only on days
 * that have logged spend — READ-ONLY, same as the plan/journal reads above.
 *
 * Clock cadence: unlike the Today panel, the recap does NOT need a per-second render (that would be 32
 * cards re-rendering every tick). `nowDateStr` is resolved once on mount from `getNow()` (local Y-M-D
 * parts, matching `dayInTripFor`'s local-date approach) and re-resolved on a LIGHT 60s interval so a
 * midnight day-rollover self-corrects without a reload — the elapsed-day set only changes at a day
 * boundary, so minute cadence is plenty (a reload also suffices).
 *
 * A11y AA: a section `h2`, per-day `h3`s, list semantics for items, `aria-hidden` decorative
 * glyphs, visible focus rings on the one navigation link. Static markup + CSS-only transitions →
 * reduced-motion-safe by construction (the reveal is framer, already reduced-motion gated).
 */

// The mood glyph + label — re-expressed here to render the journal read-view WITHOUT importing
// journal-card.tsx's private internals (: consume the journal via `getEntry`, don't reach into
// its component). Kept in MOODS order, matching journal-card's MOOD_META.
const MOOD_META: Record<Mood, { glyph: string; label: string }> = {
  great: { glyph: '🤩', label: 'Great' },
  good: { glyph: '🙂', label: 'Good' },
  okay: { glyph: '😐', label: 'Okay' },
  rough: { glyph: '😮‍💨', label: 'Rough' },
};

/** The resolved clock's LOCAL calendar day as 'YYYY-MM-DD' (matches `dayInTripFor`'s local-date parts). */
function nowDateString(): string {
  const d = getNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function TripRecap() {
  const { getDayPlan, hydrated: itineraryHydrated } = useItineraryContext();
  const { getEntry, hydrated: journalHydrated } = useJournal();
  // the per-day spend line reads the expense store, READ-ONLY (no mutator consumed).
  const { expenses, hydrated: expensesHydrated } = useExpenses();
  const prefersReducedMotion = useReducedMotion();

  // '' until mount (SSR-safe default). Resolved on mount + on a LIGHT 60s interval so a midnight
  // day-rollover extends the elapsed-day set without a reload (the set only changes at a day edge,
  // so a per-minute check is ample — no per-second render of 32 cards).
  const [nowDateStr, setNowDateStr] = useState<string>('');
  useEffect(() => {
    setNowDateStr(nowDateString());
    const timer = setInterval(() => setNowDateStr(nowDateString()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The trip days that have already happened, oldest-first. Empty pre-trip / pre-mount.
  const elapsed = elapsedTripDates(nowDateStr);

  // Pre-trip / pre-mount (nothing elapsed) → render NOTHING (Home byte-unchanged before the trip).
  // Dormant/portfolio (clock outside the trip window) always takes this branch → byte-identical.
  if (elapsed.length === 0) return null;

  // During/after the trip but a store hasn't hydrated yet: reserve a min-height instead of null so
  // the island mount doesn't collapse→expand. Presentation only; all three
  // hydration gates matter because the recap pairs the plan + journal + expense domains.
  if (!itineraryHydrated || !journalHydrated || !expensesHydrated) {
    return (
      <section id="recap" aria-hidden="true" className="relative bg-surface py-12 sm:py-16 px-4 sm:px-6">
        <div
          data-testid="trip-recap-skeleton"
          className="mx-auto min-h-[320px] max-w-3xl rounded-2xl glass-card"
        />
      </section>
    );
  }

  // Most-recent-first for display (Day N at the top). The pure core returns chronological order; the
  // ordering policy lives here in the view.
  const daysDesc = [...elapsed].reverse();

  // Optional top summary — a pure roll-up across every elapsed day (activities done vs planned).
  let doneTotal = 0;
  let plannedTotal = 0;
  for (const date of elapsed) {
    const s = summarizePlan(getDayPlan(date).items);
    doneTotal += s.done;
    plannedTotal += s.planned;
  }

  // axe-deterministic reveal: full-opacity slide (opacity pinned to 1) so the axe scan
  // (no reduced motion) never catches muted card text mid-fade below AA. Reduced-motion branch
  // left intact (it only runs under reduced motion, which the scan does not exercise).
  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 1, y: 16 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
      };

  return (
    <section
      id="recap"
      aria-labelledby="recap-title"
      data-testid="trip-recap"
      className="relative bg-surface py-12 sm:py-16 px-4 sm:px-6"
    >
      <div className="max-w-3xl mx-auto">
        {}/* Section header — the days you've lived, and the run-rate across them. */
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-gold-400/80 mb-2 flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            Days so far
          </p>
          <h2 id="recap-title" className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
            The trip, <span className="text-gradient-gold">day by day</span>
          </h2>
          {plannedTotal > 0 && (
            <p data-testid="recap-summary" className="text-sm text-white/50 mt-2" aria-live="polite">
              <span className="font-semibold text-gold-400">{doneTotal}</span>
              <span className="sr-only"> of </span>
              <span aria-hidden="true"> of </span>
              {plannedTotal} activities done across {elapsed.length}{' '}
              {elapsed.length === 1 ? 'day' : 'days'}
            </p>
          )}
        </header>

        <div className="space-y-4">
          {daysDesc.map((date) => {
            // Day N: index within the chronological TRIP_DATES set. `elapsed` is chronological and
            // 1-based-from-the-first-trip-day, so the day number is its position + 1 in `elapsed`.
            const dayNumber = elapsed.indexOf(date) + 1;
            return (
              <RecapCard
                key={date}
                date={date}
                dayNumber={dayNumber}
                items={getDayPlan(date).items}
                entry={getEntry(date)}
                spend={sumExpensesForDate(expenses, date)}
                variants={reveal}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * One day's recap card: header (Day N — city + long date), the plan+actual (items with a done tick +
 * a "{done} of {planned} done" line), and the reflection (the day's journal entry, read-only). All
 * read-only; the only interactive element in the whole island is the "Open the planner" navigation
 * link on a zero-item day (below), which navigates, it does not mutate.
 */
function RecapCard({
  date,
  dayNumber,
  items,
  entry,
  spend,
  variants,
}: {
  date: string;
  dayNumber: number;
  items: ItineraryItem[];
  entry: JournalEntry | null;
  /** — that day's logged-expense total, in the day's leg-local currency. 0 = nothing logged. */
  spend: number;
  // The framer reveal variants built by the parent (the same shape the Today panel builds); the
  // reveal is reduced-motion gated by the parent's `prefersReducedMotion`.
  variants: Variants;
}) {
  const summary = summarizePlan(items);
  const headingId = `recap-day-${date}-heading`;

  return (
    <m.article
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
      variants={variants}
      aria-labelledby={headingId}
      data-testid={`recap-card-${date}`}
      className="glass-card rounded-2xl p-5 sm:p-6"
    >
      {}/* Header — "Day N — {city}" + the long date, mirroring the Today panel's header language. */
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
        <div>
          <h3 id={headingId} className="font-display text-lg sm:text-xl font-bold text-white leading-tight">
            Day <span className="text-gold-400">{dayNumber}</span>
            <span className="text-white/40 mx-2" aria-hidden="true">
              —
            </span>
            {getCityForDate(date)}
          </h3>
          <p className="text-xs text-white/55 mt-0.5">{formatDateLong(date)}</p>
        </div>
        {summary.planned > 0 && (
          <p data-testid={`recap-done-count-${date}`} className="text-sm text-white/50 flex-shrink-0">
            <span className="font-semibold text-gold-400">{summary.done}</span>
            <span className="sr-only"> of </span>
            <span aria-hidden="true"> of </span>
            {summary.planned} done
          </p>
        )}
      </header>

      {}/* Plan + actual: the day's items, each with a done/not-done tick (read-only — no toggle). */
      {items.length === 0 ? (
        <p data-testid={`recap-no-plan-${date}`} className="text-sm text-white/55 italic">
          No plans this day — a free day.
        </p>
      ) : (
        <ul
          data-testid={`recap-plan-${date}`}
          className="space-y-1.5"
          aria-label={`Plan for Day ${dayNumber}, ${getCityForDate(date)}`}
        >
          {items.map((item) => (
            <RecapItem key={item.id} item={item} />
          ))}
        </ul>
      )}

      {}/* the day's logged-expense total — only when >0. */
      {spend > 0 && (
        <p data-testid={`recap-spend-${date}`} className="mt-3 flex items-center gap-1.5 text-sm text-white/60">
          <Wallet className="h-3.5 w-3.5 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
          Spent{' '}
          <span className="font-semibold text-white/85">{formatMoney(spend, legCurrency(getCountryForDate(date)))}</span>
        </p>
      )}

      {}/* Reflection: the day's journal entry (read-only), mirroring journal-card's read view. */
      <RecapReflection date={date} entry={entry} />
    </m.article>
  );
}

/** One read-only plan row: a done/not-done tick + title + time/category. No toggle — display only. */
function RecapItem({ item }: { item: ItineraryItem }) {
  const done = item.done === true;
  const cat = CATEGORY_COLORS[item.category];

  return (
    <li
      data-testid="recap-plan-item"
      data-done={done ? 'true' : 'false'}
      className={`flex items-center gap-3 rounded-lg border p-2.5 ${
        done ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      {}/* The done indicator — read-only status, not a control. */
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
          done ? 'border-emerald-400 bg-emerald-400 text-surface' : 'border-white/20 text-transparent'
        }`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${done ? 'text-white/45 line-through' : 'text-white/90'}`}>
          {item.title}
        </span>
        {(item.time || cat) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-white/55">
            {item.time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {item.time}
              </span>
            )}
            {cat && (
              <span className={`inline-flex rounded-full px-2 py-0.5 ${cat.bg} ${cat.text}`}>{item.category}</span>
            )}
          </span>
        )}
      </span>
      {}/* SR-only status so the done state reads without relying on the color-only tick. */
      <span className="sr-only">{done ? '— done' : '— not done'}</span>
    </li>
  );
}

/** The day's journal reflection, READ-ONLY (mirrors journal-card's read view; no editor here). */
function RecapReflection({ date, entry }: { date: string; entry: JournalEntry | null }) {
  const mood = entry?.mood ? MOOD_META[entry.mood] : null;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gold-400/80">
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
        Reflection
      </p>

      {entry ? (
        <div data-testid={`recap-journal-${date}`} className="space-y-2">
          {(mood || entry.highlight) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {mood && (
                <span
                  data-testid={`recap-journal-mood-${date}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/25 bg-gold-400/[0.08] px-2.5 py-1 text-xs font-medium text-gold-400"
                >
                  <span aria-hidden="true">{mood.glyph}</span>
                  {mood.label}
                </span>
              )}
              {entry.highlight && (
                // DEF-2 (mirror of journal-card.tsx): the parent flex item needs min-w-0 +
                // max-w-full so it can shrink and the child's break-words engages.
                <span
                  data-testid={`recap-journal-highlight-${date}`}
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-medium text-white/90"
                >
                  <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-gold-400/80" aria-hidden="true" />
                  <span className="break-words min-w-0">{entry.highlight}</span>
                </span>
              )}
            </div>
          )}
          {entry.text && (
            <p
              data-testid={`recap-journal-body-${date}`}
              className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/65"
            >
              {entry.text}
            </p>
          )}
        </div>
      ) : (
        <p data-testid={`recap-no-journal-${date}`} className="text-sm text-white/55 italic">
          No journal entry for this day.
        </p>
      )}
    </div>
  );
}
