'use client';

import Link from 'next/link';
import { m } from 'framer-motion';
import { Check, Calendar, Clock, MapPin } from 'lucide-react';
import { CATEGORY_COLORS, type ItineraryItem } from '@/lib/trip-data';
import { describeItemTime } from '@/lib/item-time-display';
import { deriveRowPhases, type TravelRowPhase } from '@/lib/travel-hero';
import type { NextUpContext } from '@/lib/whats-next';

/**
 * — the shared trip-agenda list, extracted out of `today-panel.tsx`.
 *
 * ONE list implementation, two variants:
 * - `today` — the original Home "Today" agenda. Its markup is BYTE-EQUIVALENT to the pre-
 * `today-panel.tsx` (empty-state `div` + `<ul>` of `TodayAgendaItem` rows, same testids,
 * classes, aria). The visual baseline + every `today-*` spec hold with ZERO edits.
 * - `travel` — the Travel-Mode agenda under the hero card. 48pt (`min-h-[48px]`) rows with
 * per-row phase styling (`now`/`upcoming`/`done`/…) derived by `deriveRowPhases` — the SAME
 * pure `lib/travel-hero.ts` machine the hero uses, never a fork.
 *
 * Done-tracking (both variants): the whole row is a native `<button aria-pressed>` whose click
 * calls `onToggle(item)`. The consumer routes that to the EXISTING `updateItem(date, id, {done})`
 * store method — so a TM toggle and a Today toggle are the SAME mutation, and each
 * reflects on the other + survives reload for free.
 */

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

// ── TODAY variant — byte-equivalent to the pre- today-panel agenda block ────────────────

function TodayAgenda({ items, date, dayNumber, city, onToggle }: CommonProps) {
  return items.length === 0 ? (
    // Empty state — mirrors the calendar's empty-state tone.
    <div className="text-center py-10" data-testid="today-empty-state">
      <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" aria-hidden="true" />
      <p className="text-white/55 text-sm">Nothing planned for today yet</p>
      <p className="text-white/55 text-xs mt-1">A free day — or head to the planner to add something.</p>
      <Link
        href="/plan/"
        className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg glass-card text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
      >
        <Calendar className="w-4 h-4" aria-hidden="true" />
        Open the planner
      </Link>
    </div>
  ) : (
    <ul className="space-y-2" aria-label={`Today's agenda — Day ${dayNumber}, ${city}`}>
      {items.map((item) => (
        <TodayAgendaItem key={item.id} item={item} date={date} onToggle={() => onToggle(item)} />
      ))}
    </ul>
  );
}

/**
 * One agenda row + its done toggle. The whole row is a native `<button>` with
 * `aria-pressed` reflecting done state (keyboard-operable, ≥44px touch target).
 * A done item stays visible but is clearly marked (✓ + strikethrough + dim);
 * transitions are CSS `transition-*`, gated to reduced-motion via the global
 * config, so no motion-only affordance is lost.
 */
function TodayAgendaItem({ item, date, onToggle }: { item: ItineraryItem; date: string; onToggle: () => void }) {
  const done = item.done === true;
  const cat = CATEGORY_COLORS[item.category];
  const timeInfo = describeItemTime(item, date);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${item.title}`}
        data-testid={`today-done-toggle-${item.id}`}
        className={`group flex w-full items-center gap-3 rounded-xl border p-3 text-left min-h-[44px] transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
          done
            ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
            : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
        }`}
      >
        {/* The check indicator — 44px hit target lives on the parent button.
            done-tick: a small spring "pop" when toggled done. `initial={false}`
            suppresses any mount animation; the scale keyframe fires only on the
            done→ transition. Reduced motion is handled app-wide by
            <MotionConfig reducedMotion="user"> → it lands on the final scale
            with no pop; the color/state change (the real affordance) is unaffected. */}
        <m.span
          aria-hidden="true"
          initial={false}
          animate={{ scale: done ? [1, 1.25, 1] : 1 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-200 ${
            done ? 'border-emerald-400 bg-emerald-400 text-surface' : 'border-white/25 text-transparent group-hover:border-white/40'
          }`}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </m.span>

        <span className="min-w-0 flex-1">
          <span
            data-testid="today-agenda-item"
            className={`block truncate font-medium transition-colors duration-200 ${
              done ? 'text-white/50 line-through' : 'text-white'
            }`}
          >
            {item.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/55">
            {timeInfo && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {timeInfo.label}
                {timeInfo.badge && (
                  <span className="text-[10px] uppercase tracking-wide text-white/55">{timeInfo.badge}</span>
                )}
              </span>
            )}
            {item.location && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{item.location}</span>
              </span>
            )}
            {cat && (
              <span className={`inline-flex rounded-full px-2 py-0.5 ${cat.bg} ${cat.text}`}>{item.category}</span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── TRAVEL variant — 48pt rows, per-row phase styling from `deriveRowPhases` ────────────────

/** Per-phase row classes: `now` gets the gold spotlight, `done` the emerald+dim, else neutral. */
const TM_ROW_CLASS: Record<TravelRowPhase, string> = {
  now: 'border-gold-400/40 bg-gold-400/[0.08] hover:bg-gold-400/[0.12]',
  done: 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10',
  upcoming: 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
  past: 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]',
  untimed: 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
};

function TravelAgenda({ items, date, dayNumber, city, onToggle, ctx }: CommonProps & { ctx: NextUpContext }) {
  if (items.length === 0) {
    return (
      <div className="mx-auto mt-4 max-w-2xl text-center py-8" data-testid="travel-agenda-empty">
        <Calendar className="mx-auto mb-3 h-9 w-9 text-white/10" aria-hidden="true" />
        <p className="text-sm text-white/60">No agenda for today — a free day.</p>
        <Link
          href="/plan/"
          className="mt-4 inline-flex items-center gap-2 rounded-lg glass-card px-4 py-2 text-sm font-medium text-white outline-none transition-colors duration-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          Open the planner
        </Link>
      </div>
    );
  }

  const phases = deriveRowPhases(items, ctx);
  const doneCount = items.filter((it) => it.done === true).length;

  return (
    <section
      aria-labelledby="travel-agenda-title"
      data-testid="travel-agenda"
      className="mx-auto mt-4 max-w-2xl"
    >
      <header className="mb-3 flex items-end justify-between px-1">
        <h2 id="travel-agenda-title" className="text-xs uppercase tracking-widest text-gold-400/80">
          Today&rsquo;s agenda
        </h2>
        <p className="text-xs text-white/50" aria-live="polite">
          <span className="font-semibold text-gold-400">{doneCount}</span>
          <span aria-hidden="true"> / </span>
          <span className="sr-only"> of </span>
          {items.length} done
        </p>
      </header>
      <ul className="space-y-2" aria-label={`Agenda — Day ${dayNumber}, ${city}`}>
        {items.map((item, i) => (
          <TravelAgendaItem
            key={item.id}
            item={item}
            date={date}
            phase={phases[i]}
            onToggle={() => onToggle(item)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One TM agenda row. Same interaction contract as `TodayAgendaItem` (whole row is the
 * `aria-pressed` done toggle) but a 48pt min-height and phase-driven emphasis. `data-row-phase`
 * exposes the derived phase for tests/styling. Reduced motion is app-wide — CSS only.
 */
function TravelAgendaItem({
  item,
  date,
  phase,
  onToggle,
}: {
  item: ItineraryItem;
  date: string;
  phase: TravelRowPhase;
  onToggle: () => void;
}) {
  const done = item.done === true;
  const cat = CATEGORY_COLORS[item.category];
  const timeInfo = describeItemTime(item, date);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${item.title}`}
        data-testid={`travel-done-toggle-${item.id}`}
        data-row-phase={phase}
        className={`group flex w-full items-center gap-3 rounded-xl border p-3 text-left min-h-[48px] transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${TM_ROW_CLASS[phase]}`}
      >
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-200 ${
            done ? 'border-emerald-400 bg-emerald-400 text-surface' : 'border-white/25 text-transparent group-hover:border-white/40'
          }`}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>

        <span className="min-w-0 flex-1">
          <span
            data-testid="travel-agenda-item"
            className={`block truncate font-medium transition-colors duration-200 ${
              done ? 'text-white/50 line-through' : 'text-white'
            }`}
          >
            {item.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/55">
            {phase === 'now' && (
              <span className="inline-flex items-center gap-1 font-semibold text-gold-400">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Now
              </span>
            )}
            {timeInfo && (
              <span className="inline-flex items-center gap-1">
                {phase !== 'now' && <Clock className="h-3 w-3" aria-hidden="true" />}
                {timeInfo.label}
                {timeInfo.badge && (
                  <span className="text-[10px] uppercase tracking-wide text-white/55">{timeInfo.badge}</span>
                )}
              </span>
            )}
            {item.location && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{item.location}</span>
              </span>
            )}
            {cat && (
              <span className={`inline-flex rounded-full px-2 py-0.5 ${cat.bg} ${cat.text}`}>{item.category}</span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
