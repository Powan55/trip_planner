'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { type ItineraryItem } from '@/lib/trip-data';
import { describeItemTime } from '@/lib/item-time-display';
import { deriveRowPhases, type TravelRowPhase } from '@/lib/travel-hero';
import type { NextUpContext } from '@/lib/whats-next';
import { formatRelativeTime } from '@/lib/relative-time';
import { formatDurationText } from '@/lib/time-picker-format';
import { unplannedGapMinutes } from '@/lib/unplanned-gap';

/**
 * The shared trip-agenda list, in two variants:
 * - `today` — the Home "Today" agenda.
 * - `travel` — the Travel-Mode agenda under the hero card, with per-row phase styling derived by
 *   `deriveRowPhases` (the SAME pure `lib/travel-hero.ts` machine the hero uses, never a fork)
 *   and the explicit unplanned-gap rules between adjacent timed rows.
 *
 * Done-tracking (both variants): the whole row is a native `<button aria-pressed>` whose click
 * calls `onToggle(item)`. The consumer routes that to the EXISTING `updateItem(date, id, {done})`
 * store method — so a TM toggle and a Today toggle are the SAME mutation, and each reflects on
 * the other + survives reload for free.
 */

/** The row's time track when the item carries no time at all. */
const NO_TIME = '—';

type CommonProps = {
  items: ItineraryItem[];
  date: string;
  dayNumber: number;
  city: string;
  onToggle: (item: ItineraryItem) => void;
};

type TripAgendaProps =
  | ({ variant: 'today' } & CommonProps)
  | ({ variant: 'travel'; ctx: NextUpContext } & CommonProps);

export default function TripAgenda(props: TripAgendaProps) {
  if (props.variant === 'today') return <TodayAgenda {...props} />;
  return <TravelAgenda {...props} />;
}

/** Completion attribution. Renders ONLY when the item is done; `doneBy` is the display-name
 *  string, rendered VERBATIM. With no name set both fields are absent (dormant build) and it
 *  reads as a nameless "Completed". */
function CompletedFooter({ item }: { item: ItineraryItem }) {
  if (item.done !== true) return null;
  const trail = [item.doneBy, formatRelativeTime(item.doneAt)].filter(Boolean).join(' · ');
  return (
    <span
      data-testid="completed-attribution"
      className="pr pr--lo mt-1 inline-flex items-center gap-1"
    >
      <Check className="h-3 w-3" aria-hidden="true" strokeWidth={3} />
      Completed
      {trail && <span>· {trail}</span>}
    </span>
  );
}

/**
 * The empty day: the SHAPE of a day at the size it will be — three ruled, hollow slots inside
 * one dashed frame — plus the condition in words at --t-body. Nothing is captioned as absent.
 */
function AgendaEmpty({
  testId,
  dayNumber,
  city,
  line,
  className = '',
}: {
  testId: string;
  dayNumber: number;
  city: string;
  line: string;
  className?: string;
}) {
  return (
    <div className={`py-6 ${className}`} data-testid={testId}>
      <div className="sec px-gut">
        <h2>
          Day {dayNumber} · {city}
        </h2>
        <span className="sub">0 planned</span>
      </div>
      <ul aria-hidden="true" className="list empty-frame mx-gut">
        {['Morning', 'Afternoon', 'Evening'].map((slot) => (
          <li key={slot} className="r" data-mark="hollow">
            <span className="tm">{slot.slice(0, 3).toLowerCase()}</span>
            <span className="min-w-0">
              <h3>{slot}</h3>
              <span className="mt">nothing struck in yet</span>
            </span>
            <span className="hollow-tag">open</span>
          </li>
        ))}
      </ul>
      <p className="empty mt-3 px-gut">{line}</p>
      <Link href="/plan/" className="btn mx-gut mt-4 no-underline">
        Open the planner
      </Link>
    </div>
  );
}

/** The third-column state token per phase. `done` and `now` are the only two that earn a chip. */
const PHASE_TAG: Record<TravelRowPhase, string> = {
  done: 'Struck',
  now: 'Now',
  upcoming: 'Not yet',
  past: 'Not yet',
  untimed: 'Anytime',
};

/**
 * One agenda row. The whole row is the `aria-pressed` done toggle (keyboard-operable, ≥48px);
 * `data-row-phase` exposes the derived phase for tests/styling and is stamped on the travel
 * variant only — the Today panel has no per-row clock to derive one from, and inventing one
 * would claim a "now" the data does not carry.
 */
function AgendaRow({
  item,
  date,
  phase,
  prefix,
  onToggle,
}: {
  item: ItineraryItem;
  date: string;
  phase?: TravelRowPhase;
  prefix: 'today' | 'travel';
  onToggle: () => void;
}) {
  const done = item.done === true;
  const timeInfo = describeItemTime(item, date);
  const isNow = phase === 'now';
  // Recedes a tier: nothing left to act on (already past) or nothing to schedule against.
  const recedes = !done && !isNow && (phase === 'past' || !timeInfo);
  const meta = [timeInfo?.badge, item.duration, item.location, item.category]
    .filter(Boolean)
    .join(' · ');
  const tag = done ? 'Struck' : phase ? PHASE_TAG[phase] : timeInfo ? 'Not yet' : 'Anytime';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${item.title}`}
        data-testid={`${prefix}-done-toggle-${item.id}`}
        data-row-phase={phase}
        data-mark={recedes ? 'hollow' : undefined}
        aria-current={isNow ? 'true' : undefined}
        // KNOWN CEILING: `.list .r` is (0,2,0) and sets min-height: var(--tap), so no utility
        // can raise it to the 48px this row needs without `!`. max() keeps the outdoor 52px.
        className="r w-full text-left !min-h-[max(var(--tap),48px)]"
      >
        <span className="tm whitespace-nowrap">{timeInfo ? timeInfo.label : NO_TIME}</span>
        <span className="min-w-0">
          <span
            data-testid={`${prefix}-agenda-item`}
            className={`block truncate text-t-body leading-[1.28] ${
              done
                ? 'font-medium text-ink-lo line-through'
                : recedes
                  ? 'font-medium text-ink-lo'
                  : 'font-semibold text-ink-hi'
            }`}
          >
            {item.title}
          </span>
          {meta && <span className="mt truncate">{meta}</span>}
          <CompletedFooter item={item} />
        </span>
        <span
          className={
            done
              ? 'chip chip--struck'
              : isNow
                ? 'chip border-[color:var(--accent)] text-[color:var(--accent)]'
                : 'hollow-tag'
          }
        >
          {tag}
        </span>
      </button>
    </li>
  );
}

// ── TODAY variant ───────────────────────────────────────────────────────────────────────

function TodayAgenda({ items, date, dayNumber, city, onToggle }: CommonProps) {
  if (items.length === 0) {
    return (
      <AgendaEmpty
        testId="today-empty-state"
        dayNumber={dayNumber}
        city={city}
        line="Nothing is on today yet — a free day."
      />
    );
  }
  return (
    <ul className="list" aria-label={`Today's agenda — Day ${dayNumber}, ${city}`}>
      {items.map((item) => (
        <AgendaRow
          key={item.id}
          item={item}
          date={date}
          prefix="today"
          onToggle={() => onToggle(item)}
        />
      ))}
    </ul>
  );
}

// ── TRAVEL variant ──────────────────────────────────────────────────────────────────────

function TravelAgenda({ items, date, dayNumber, city, onToggle, ctx }: CommonProps & { ctx: NextUpContext }) {
  if (items.length === 0) {
    return (
      <AgendaEmpty
        testId="travel-agenda-empty"
        dayNumber={dayNumber}
        city={city}
        line="No agenda for today — a free day."
        className="mx-auto mt-4 max-w-2xl"
      />
    );
  }

  const phases = deriveRowPhases(items, ctx);
  const doneCount = items.filter((it) => it.done === true).length;

  return (
    <section aria-labelledby="travel-agenda-title" data-testid="travel-agenda" className="mx-auto mt-4 max-w-2xl">
      <div className="sec px-gut">
        <h2 id="travel-agenda-title">Today&rsquo;s agenda</h2>
        <span className="sub" aria-live="polite">
          <span className="num">{doneCount}</span>
          <span aria-hidden="true"> / </span>
          <span className="sr-only"> of </span>
          <span className="num">{items.length}</span> done
        </span>
      </div>
      <ul className="list" aria-label={`Agenda — Day ${dayNumber}, ${city}`}>
        {items.map((item, i) => {
          // The unplanned rule between this row and the one above it: a FACT about the pair,
          // not a spacer.
          const gapMin = unplannedGapMinutes(items[i - 1], item);
          return (
            <Fragment key={item.id}>
              {gapMin !== null && (
                <li className="gap" data-testid={`travel-agenda-gap-${item.id}`}>
                  <span>{formatDurationText(gapMin)} unplanned</span>
                </li>
              )}
              <AgendaRow
                item={item}
                date={date}
                phase={phases[i]}
                prefix="travel"
                onToggle={() => onToggle(item)}
              />
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}
