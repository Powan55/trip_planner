'use client';

// pure-move extraction from calendar-planner.tsx: the multi-select bulk-action bar.
// Zero behavior change — same markup, same testids, same handlers, lifted out behind props.
// It is presentational: it renders the current selection count + the move/copy-day/delete
// controls and calls back into the parent, which still owns the selection state, the store
// mutators, and the delete-confirm AlertDialog (kept in calendar-planner.tsx).

import { Trash2 } from 'lucide-react';
import { TRIP_DATES, formatDate } from '@/lib/trip-data';

interface CalendarBulkToolbarProps {
  /** Number of currently selected items on the visible day (drives count + disabled states). */
  selectedCount: number;
  /** The day the selection lives on — excluded from the move/copy target lists. */
  selectedDate: string;
  /** Move the current selection to another day. */
  onBulkMove(targetDate: string): void;
  /** Copy the WHOLE current day onto another day (independent of the selection). */
  onCopyDay(targetDate: string): void;
  /** Open the bulk-delete confirm dialog (parent owns the dialog + the delete). */
  onRequestDelete(): void;
}

// bulk-action bar — visible only in select mode. Keyboard-operable; the
// selected count is announced via aria-live. Move/Delete act on the SELECTION;
// Copy day copies the WHOLE day (a day-level op parked here for convenience). The
// day pickers reuse the native <select> idiom (SR/keyboard-friendly, no
// portal/focus-trap to hand-build).
export function CalendarBulkToolbar({ selectedCount, selectedDate, onBulkMove, onCopyDay, onRequestDelete }: CalendarBulkToolbarProps) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="calendar-bulk-bar"
      className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-r1 bg-[rgb(var(--surface-raised))] border-hair border-[color:hsl(var(--border))]"
    >
      <span
        aria-live="polite"
        data-testid="calendar-bulk-count"
        className="pr px-1"
      >
        {selectedCount} selected
      </span>
      <div className="flex-1" />
      <label className="sr-only" htmlFor="calendar-bulk-move">Move selected items to a day</label>
      <select
        id="calendar-bulk-move"
        value=""
        disabled={selectedCount === 0}
        data-testid="calendar-bulk-move-select"
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onBulkMove(e.target.value)}
        className="min-h-tap px-2 rounded-r1 bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] font-machine text-t-micro uppercase tracking-[0.11em] text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:text-ink-lo disabled:cursor-not-allowed"
      >
        <option value="" disabled>Move to day…</option>
        {TRIP_DATES.filter((d) => d !== selectedDate).map((d) => (
          <option key={d} value={d}>{formatDate(d)}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="calendar-bulk-copy">Copy this whole day to another day</label>
      <select
        id="calendar-bulk-copy"
        value=""
        data-testid="calendar-bulk-copy-select"
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onCopyDay(e.target.value)}
        className="min-h-tap px-2 rounded-r1 bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] font-machine text-t-micro uppercase tracking-[0.11em] text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <option value="" disabled>Copy day to…</option>
        {TRIP_DATES.filter((d) => d !== selectedDate).map((d) => (
          <option key={d} value={d}>{formatDate(d)}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRequestDelete}
        disabled={selectedCount === 0}
        data-testid="calendar-bulk-delete"
        className="chip min-h-tap px-3 transition-colors outline-none hover:text-[color:hsl(var(--destructive))] hover:border-[color:hsl(var(--destructive))] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:text-ink-lo disabled:border-dashed disabled:cursor-not-allowed disabled:hover:text-ink-lo disabled:hover:border-[color:var(--border-ui)]"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Delete selected
      </button>
    </div>
  );
}
