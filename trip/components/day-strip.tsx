'use client';

// Mobile day-strip picker. A horizontally scroll-snapping row of the
// 32 trip days, used ONLY below `lg` as the one-handed replacement for the desktop
// month grid. It is strictly PRESENTATIONAL — a pure consumer: it subscribes to NO
// store, holds no persistence, and simply renders the props it is handed and calls
// `onSelect` on tap. All selection/persistence stays in `calendar-planner.tsx`
//.
//
// The strip scrolls INSIDE itself (`overflow-x-auto`), so it never pushes the page
// wider than the viewport.

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Per-date presentation meta the parent precomputes from the store (pure consumer). */
export interface DayStripDateMeta {
  /** 'YYYY-MM-DD' trip date. */
  date: string;
  /** Country for the country dot (himalaya = nepal, sakura = japan). */
  country: 'nepal' | 'japan';
  /** Number of planned items on this day (drives the count badge; 0 = no badge). */
  count: number;
}

export interface DayStripProps {
  /** The 32 trip dates in order (do NOT reorder). */
  dates: string[];
  /** The currently focused date. */
  selectedDate: string;
  /** Called with the tapped date. */
  onSelect: (date: string) => void;
  /** Per-date country + item-count meta, keyed by date (order need not match). */
  meta: DayStripDateMeta[];
  /** Today's trip date when inside the trip window, else null. */
  todayDate: string | null;
}

/** Local, tz-safe parts from a 'YYYY-MM-DD' trip date (noon avoids day-edge slips). */
function parseDay(dateStr: string): { weekday: string; dayNum: number; long: string } {
  const d = new Date(dateStr + 'T12:00:00');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    dayNum: d.getDate(),
    long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  };
}

export default function DayStrip({ dates, selectedDate, onSelect, meta, todayDate }: DayStripProps) {
  const prefersReducedMotion = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const metaByDate = new Map(meta.map((m) => [m.date, m]));

  // Auto-center the selected chip on mount and whenever the selection changes. We
  // scroll the SCROLLER (not the page) via manual scrollLeft math so a horizontal
  // centering never nudges the vertical page position (scrollIntoView can scroll
  // ancestors). Reduced-motion → instant jump; otherwise smooth.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const chip = selectedRef.current;
    if (!scroller || !chip) return;
    const target = chip.offsetLeft - scroller.clientWidth / 2 + chip.clientWidth / 2;
    const left = Math.max(0, target);
    scroller.scrollTo({ left, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }, [selectedDate, prefersReducedMotion]);

  return (
    <div
      ref={scrollerRef}
      role="group"
      aria-label="Select a trip day"
      data-testid="day-strip"
      // snap physics: decisive mandatory
      // snapping with scroll-padding so chips settle centred, plus overscroll
      // containment so a horizontal flick never chains to the page scroll. Pure CSS —
      // snapping is instant positioning (not vestibular motion), and the JS auto-centre
      // already honours reduced motion via behavior:'auto'.
      className="min-w-0 flex gap-2 overflow-x-auto scrollbar-hide pb-1 snap-x snap-mandatory scroll-px-3 overscroll-x-contain"
    >
      {dates.map((date) => {
        const { weekday, dayNum, long } = parseDay(date);
        const m = metaByDate.get(date);
        const country = m?.country ?? 'nepal';
        const count = m?.count ?? 0;
        const isSelected = date === selectedDate;
        const isToday = todayDate != null && date === todayDate;

        const activityLabel = count > 0 ? `, ${count} ${count === 1 ? 'activity' : 'activities'}` : ', no activities';
        const todayLabel = isToday ? ', today' : '';

        return (
          <button
            key={date}
            ref={isSelected ? selectedRef : undefined}
            type="button"
            onClick={() => onSelect(date)}
            aria-pressed={isSelected}
            aria-label={`${long}${todayLabel}${activityLabel}`}
            data-testid={`day-strip-${date}`}
            className={`snap-center shrink-0 w-16 relative flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
              isSelected
                ? 'bg-gold-500/20 ring-2 ring-gold-400 text-white font-bold'
                : count > 0
                  ? country === 'nepal'
                    ? 'bg-himalaya-500/10 text-himalaya-400 hover:bg-himalaya-500/20'
                    : 'bg-sakura-400/10 text-sakura-400 hover:bg-sakura-400/20'
                  : 'text-white/50 hover:bg-white/5'
            }`}
          >
            {/* Today marker: a small pill above the weekday, on the matching chip only. */}
            {isToday && (
              <span
                className="absolute -top-1.5 px-1.5 py-px rounded-full bg-gold-500 text-surface text-[8px] font-bold uppercase tracking-wide leading-none"
                aria-hidden="true"
              >
                Today
              </span>
            )}
            {/* bumped from /40 to /60 — axe flagged the /40 weekday label (~3.5-3.8:1)
                below the WCAG AA 4.5:1 minimum. It went unnoticed until now because every
                prior consumer (`/plan`'s mobile strip) hides it at `lg+` via a CSS `lg:hidden`
                wrapper, above which the axe pack always runs; Travel Mode has no such wrapper
                (the strip is the ONLY day picker, at every width), so it's genuinely visible to
                a real user and must clear contrast on its own. */}
            <span className="text-[10px] uppercase tracking-wide text-white/60">{weekday}</span>
            <span className="text-base leading-none">{dayNum}</span>
            {/* Country dot: himalaya (nepal) / sakura (japan). */}
            <span
              className={`w-1.5 h-1.5 rounded-full ${country === 'nepal' ? 'bg-himalaya-400' : 'bg-sakura-400'}`}
              aria-hidden="true"
            />
            {/* Item-count badge, only when the day has items. */}
            {count > 0 && (
              <span
                className={`absolute top-1 right-1 min-w-[1rem] h-4 px-1 flex items-center justify-center rounded-full text-[9px] font-semibold ${
                  isSelected ? 'bg-gold-500 text-surface' : 'bg-white/10 text-white/70'
                }`}
                aria-hidden="true"
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
