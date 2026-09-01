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
  /** Leg id for the country dot (himalaya = nepal, sakura = japan).: `string` — a custom
   * trip's single leg is `'main'`; for the default pack it is still exactly nepal/japan. */
  country: string;
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
            // A DAY TAB (SPEC 9.9). MATERIAL carries the active state — a lighter surface,
            // raised 5px — so it does not depend on an accent colour, which is what leaves
            // the screen's one accent fill for the thing that is actually live. A day with
            // nothing on it is drawn HOLLOW (dashed, --text-lo) at the size it will be,
            // never shorter. Under reduced motion the raise lands instantly and the tab is
            // still the lighter surface, still raised: nothing is lost.
            className={`snap-center shrink-0 w-16 relative flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-r1 border transition-all [transition-duration:var(--duration-raise)] ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              isSelected
                ? '-translate-y-[5px] bg-[rgb(var(--surface-overlay))] border-[hsl(var(--border))] text-[color:var(--text-hi)]'
                : count > 0
                  ? country === 'nepal'
                    ? 'bg-[rgb(var(--surface-low))] border-[color:var(--np-a)] text-[color:var(--np-a)] hover:bg-white/5'
                    : 'bg-[rgb(var(--surface-low))] border-[color:var(--jp-a)] text-[color:var(--jp-a)] hover:bg-white/5'
                  : 'border-dashed border-[color:var(--text-lo)] text-[color:var(--text-lo)] hover:bg-white/5'
            }`}
          >
            {/* THE STAMP — applied after printing, in another ink, off-register. There is
                exactly one of these on the strip and it answers "what is now?". */}
            {isToday && (
              <span className="stamp stamp--live absolute -top-2 z-[1] px-1 py-0" aria-hidden="true">
                Today
              </span>
            )}
            {/* bumped from /40 to /60 — axe flagged the /40 weekday label (~3.5-3.8:1)
                below the WCAG AA 4.5:1 minimum. It went unnoticed until now because every
                prior consumer (`/plan`'s mobile strip) hides it at `lg+` via a CSS `lg:hidden`
                wrapper, above which the axe pack always runs; Travel Mode has no such wrapper
                (the strip is the ONLY day picker, at every width), so it's genuinely visible to
                a real user and must clear contrast on its own. */}
            <span className="pr pr--lo">{weekday}</span>
            <span className="num text-n-sm">{dayNum}</span>
            {/* The country mark: FILLED when the day carries items, an unfilled ring when
                it does not. Same disc, same place — only the fill says which. */}
            <span
              className={`h-[7px] w-[7px] rounded-full ${
                count > 0
                  ? country === 'nepal'
                    ? 'bg-[color:var(--np-a)]'
                    : 'bg-[color:var(--jp-a)]'
                  : 'border-2 border-[color:var(--text-lo)]'
              }`}
              aria-hidden="true"
            />
            {/* Item-count badge, only when the day has items. */}
            {count > 0 && (
              <span
                className={`num absolute top-1 right-1 flex h-4 min-w-[1rem] items-center justify-center px-1 text-t-micro ${
                  isSelected ? 'text-[color:var(--text-hi)]' : 'text-[color:var(--text-lo)]'
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
