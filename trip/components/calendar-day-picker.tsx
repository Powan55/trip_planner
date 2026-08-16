'use client';

// pure-move extraction from calendar-planner.tsx: the left-pane DAY SELECTOR — the mobile
// day-strip block (the horizontal scroll-snap strip + its collapsible "Month view") and the
// desktop month-grid / agenda date-list. Zero behavior change: same markup, same testids, same
// responsive gating (`lg:hidden` strip vs `hidden lg:block` grid). The horizontal strip chip UI
// itself already lives in its own sibling (`day-strip.tsx`, <DayStrip>) — this module extracts
// the surrounding selection pane that composes it plus the month grid it shared with the parent.
// The `showMonthView` collapse is local here (nothing outside the pane read it); every other
// input (selectedDate, viewMode, per-day data) stays owned by the parent and is passed in.

import {
  TRIP_DATES, getCountryForDate, formatDate, formatDateLong, DayPlan,
} from '@/lib/trip-data';
import { legCurrency, formatMoney } from '@/core/budget/model';

interface CalendarDayPickerProps {
  selectedDate: string;
  onSelectDate(date: string): void;
  viewMode: 'calendar' | 'agenda';
  getDayPlan(date: string): DayPlan;
  /** Per-date logged spend total, keyed 'YYYY-MM-DD'. */
  spendByDate: Record<string, number>;
  /** Today's trip date when inside the trip window, else null. */
  todayStripDate: string | null;
  /**
   * is the mobile "Month view" expanded? The strip and its expander moved up into
   * the planner's sticky Row 1 — a `position:sticky` box only sticks inside its own
   * containing block, and here that block was this pane, which is exactly as tall as the
   * strip. So the strip had to leave the grid cell, and its open/closed flag came with it.
   */
  showMonthView: boolean;
}

export function CalendarDayPicker({ selectedDate, onSelectDate, viewMode, getDayPlan, spendByDate, todayStripDate, showMonthView }: CalendarDayPickerProps) {
  // Calendar Grid
  const renderCalendar = () => {
    const weeks: string[][] = [];
    let currentWeek: string[] = [];
    const firstDate = new Date(TRIP_DATES[0] + 'T12:00:00');
    const startDay = firstDate.getDay();
    for (let i = 0; i < startDay; i++) currentWeek.push('');
    for (const date of TRIP_DATES) {
      currentWeek.push(date);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push('');
      weeks.push(currentWeek);
    }

    return (
      <div className="glass-card rounded-2xl p-3 sm:p-6">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="min-w-0 text-center text-[10px] sm:text-xs text-ink-lo py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="min-w-0 aspect-square" />;
            const country = getCountryForDate(date);
            const dayPlan = getDayPlan(date);
            const hasItems = (dayPlan.items?.length ?? 0) > 0;
            const isSelected = date === selectedDate;
            // day-cell pulse: gently pulse the "today" cell (only when inside the trip
            // window — todayStripDate is null otherwise). CSS `.animate-today-pulse`, hard-
            // neutralized under reduced motion (globals.css → static ring, no breathing).
            const isToday = todayStripDate != null && date === todayStripDate;
            // cost overlay (read-only): does this day have logged spend? The marker is a subtle
            // dot; the actual figure goes to the single-day readout + the aria-label extension below
            // (a full currency figure would break the cramped cell). Leg-local (a day is one leg).
            const daySpend = spendByDate[date] ?? 0;
            const hasSpend = daySpend > 0;
            const spendLabel = hasSpend ? `, ${formatMoney(daySpend, legCurrency(country))} spent` : '';

            return (
              <button
                key={date}
                onClick={() => onSelectDate(date)}
                aria-pressed={isSelected}
                aria-label={`${formatDateLong(date)}${hasItems ? `, ${dayPlan.items?.length ?? 0} activities planned` : ', no activities planned'}${spendLabel}`}
                data-testid={`calendar-day-${date}`}
                className={`min-w-0 aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all relative outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${isToday ? 'animate-today-pulse ' : ''}${
                  isSelected
                    ? 'bg-primary/20 ring-2 ring-ring text-white font-bold scale-105'
                    : hasItems
                      ? country === 'nepal'
                        ? 'bg-himalaya-500/10 text-himalaya-400 hover:bg-himalaya-500/20'
                        : 'bg-sakura-400/10 text-sakura-400 hover:bg-sakura-400/20'
                      : 'text-ink-mid hover:bg-white/5'
                }`}
              >
                {new Date(date + 'T12:00:00').getDate()}
                {hasItems && (
                  <div className="absolute bottom-1 flex gap-0.5">
                    {(dayPlan.items ?? []).slice(0, 3).map((_, j: number) => (
                      <div key={j} className={`w-1 h-1 rounded-full ${country === 'nepal' ? 'bg-himalaya-400' : 'bg-sakura-400'}`} />
                    ))}
                  </div>
                )}
                {/* a subtle "has spend" marker (top-right), sized to fit the cramped cell — a
                    small gold dot, NOT a currency figure (that lives in the single-day readout +
                    aria-label). aria-hidden: the label extension already announces the amount. */}
                {hasSpend && (
                  <span
                    aria-hidden="true"
                    data-testid={`calendar-day-${date}-spend`}
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-gold-400 ring-2 ring-gold-400/25"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-w-0">
      {/* Mobile picker (`<lg`): the day-strip and its "Month view" expander now live in the
          planner's sticky Row 1. What stays here is the expanded month grid itself,
          which is too tall for a sticky band. Desktop (`lg+`) never sees this block. */}
      {showMonthView && <div className="lg:hidden">{renderCalendar()}</div>}

      {/* Desktop left pane (`lg+`): the existing month-grid / agenda-list two-pane,
          pixel-equivalent to before — now gated to `lg+` since the day-strip owns `<lg`. */}
      <div className="hidden lg:block">
      {viewMode === 'calendar' ? renderCalendar() : (
        <div className="glass-card rounded-2xl p-4 max-h-[600px] overflow-y-auto scrollbar-hide space-y-1">
          {TRIP_DATES.map((date) => {
            const country = getCountryForDate(date);
            const dayPlan = getDayPlan(date);
            const hasItems = (dayPlan.items?.length ?? 0) > 0;
            const isSelected = date === selectedDate;
            return (
              <button
                key={date}
                onClick={() => onSelectDate(date)}
                aria-pressed={isSelected}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  isSelected ? 'bg-primary/20 ring-1 ring-ring/30 text-white' : 'text-ink-mid hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${country === 'nepal' ? 'bg-himalaya-400' : 'bg-sakura-400'}`} />
                  <span>{formatDate(date)}</span>
                </div>
                {hasItems && <span className="text-xs text-ink-mid">{dayPlan.items?.length ?? 0} items</span>}
              </button>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
