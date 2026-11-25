'use client';

import { useState, useEffect, useRef, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { m, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Calendar, Plus, Trash2,
  MapPin, X, Check, ChevronLeft, ChevronRight, ChevronDown,
  ExternalLink, Map as MapIcon, MoreHorizontal, Sunrise, Sunset,
} from 'lucide-react';
import { DndContext, closestCenter, DragOverlay, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  TRIP_DATES, getCountryForDate, formatDate, formatDateLong,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS, DayPlan,
} from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { buildItineraryStops, stopMarkerFor } from '@/lib/itinerary-map';
import { showUndoToast } from '@/lib/undo-toast';
import { readMs } from '@/lib/toast-duration';
import { bulkMoveWithUndo } from '@/lib/bulk-move-undo';
import { getTodayInTrip } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';
import { setSelectedDay } from '@/lib/selected-day';
import DayStrip, { DayStripDateMeta } from '@/components/day-strip';
import { SortableItem, DroppableDay } from '@/components/calendar-sortable-item';
import { ConflictNotice } from '@/components/conflict-notice';
import { CATEGORY_ICON_MAP } from '@/components/category-icon';
import { ALL_CATEGORIES } from '@/lib/itinerary-category';
import { CalendarBulkToolbar } from '@/components/calendar-bulk-toolbar';
import { CalendarDayPicker } from '@/components/calendar-day-picker';
import { useCalendarDnd } from '@/hooks/use-calendar-dnd';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';
import { useItineraryContext } from '@/components/itinerary-provider';
import { freshCopyOf } from '@/hooks/use-itinerary';
import { itemPatch } from '@/core/itinerary';
import QuickAddInput from '@/components/quick-add-input';
import MapIslandBoundary from '@/components/map-island-boundary';
import { prefersReducedMotion } from '@/lib/motion';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { filterItemsByAuthor, itemMatchesAuthor } from '@/lib/author-filter';
import { useAuthorFilter } from '@/hooks/use-author-filter';
import AuthorFilterControl from '@/components/author-filter';
import { buildMapsPlaceUrl } from '@/lib/maps-link';
import { useExpenses } from '@/hooks/use-expenses';
import { expensesByDate } from '@/core/budget/burn-rate';
import { legCurrency, formatMoney } from '@/core/budget/model';
import {
  dayZoneOffsetMin,
  effectiveDurationMinutes,
  effectiveStartMinutes,
  formatTimeAmPm,
  offsetForCountry,
} from '@/core/dates';
import { daySunTimes } from '@/lib/sun-times';
import { unplannedGapsByItemId } from '@/lib/unplanned-gap';
import { minutesToHHMM, formatDurationText } from '@/lib/time-picker-format';
import { extractQuickAddTime } from '@/lib/quick-add-parse';
import { describeItemTime } from '@/lib/item-time-display';
import { dayPlaceLabel, legLabel } from '@/lib/leg-label';
import { dayShade, swatchFill } from '@/lib/city-palette';
import { clashingItemIds, describeClash, firstClashWith, timeFootprintChanged } from '@/lib/sort-items-by-time';
import TimePicker, { DurationField } from '@/components/time-picker';
import PlanSearch from '@/components/plan-search';
import type { PlanSearchResult } from '@/lib/search-plan';
import { getCachedForecastForDate, weatherTagForDay, type WeatherTag } from '@/lib/weather';
import { haptic } from '@/lib/haptics';
import { groupItemsByPhase, earliestTimedItem, PHASE_LABELS } from '@/lib/phase-of-day';

// The day container is also droppable; a keyboard drag whose centre lands nearer to it than to the
// target row resolves to `day-*`, which handleDragEnd ignores, so the reorder silently dropped.
const closestItem: CollisionDetection = (args) => {
  const rows = args.droppableContainers.filter((c) => !String(c.id).startsWith('day-'));
  return closestCenter({ ...args, droppableContainers: rows.length ? rows : args.droppableContainers });
};

// Only loaded when the map toggle is on, so maplibre stays out of /plan's first load.
const PlanDayMap = dynamic(() => import('@/components/plan-day-map'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface text-ink-mid">
      <span className="text-xs">Loading map…</span>
    </div>
  ),
});

/**
 * `href` minus the `focus` param, for history.replaceState only. The path already includes the
 * basePath, so passing it to the router would double it. Other params survive.
 */
export function stripFocusParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('focus');
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Plan density: one column per day, height by item count. Empty days are hollow, thin days
 * hatched; every 4th day labelled. One role="img" whose label carries the whole reading.
 */
function PlanDensity({ meta, selectedDate }: { meta: DayStripDateMeta[]; selectedDate: string }) {
  const total = meta.reduce((n, m) => n + m.count, 0);
  const planned = meta.filter((m) => m.count > 0).length;
  const max = Math.max(1, ...meta.map((m) => m.count));
  const mean = planned > 0 ? total / planned : 0;
  const thinAt = Math.max(1, Math.ceil(mean / 2));
  const unplanned = meta.length - planned;

  return (
    <div className="mb-6">
      <div className="sec">
        <h3 className="pr pr--l text-ink-hi">Plan density</h3>
        <span className="sub">
          {total} items · {meta.length} days
        </span>
      </div>
      <div
        className="dens"
        role="img"
        data-testid="plan-density"
        aria-label={
          `Plan density: ${total} items across ${meta.length} days, ` +
          `mean ${mean.toFixed(1)} per planned day. ` +
          `${unplanned} ${unplanned === 1 ? 'day is' : 'days are'} unplanned.`
        }
      >
        {meta.map((m) => {
          const empty = m.count === 0;
          return (
            <span
              key={m.date}
              className={`b${m.date === selectedDate ? ' outline outline-2 outline-offset-[-2px] outline-[color:hsl(var(--accent))]' : ''}`}
              data-leg={m.country}
              data-empty={empty ? '' : undefined}
              data-thin={!empty && m.count <= thinAt ? '' : undefined}
              style={{ height: empty ? '100%' : `${Math.max(8, (m.count / max) * 100)}%` }}
            />
          );
        })}
        {mean > 0 && (
          <span className="mean" style={{ bottom: `${(mean / max) * 100}%` }}>
            <span>mean {mean.toFixed(1)}</span>
          </span>
        )}
      </div>
      <div className="axis" aria-hidden="true">
        {meta.map((m, i) => (
          <span key={m.date}>{i % 4 === 0 ? m.date.slice(8) : ''}</span>
        ))}
      </div>
    </div>
  );
}

// Item Editor Modal
function ItemEditor({ item, startDate, dayItems, onSave, onClose, hidden, pickedPin, onRequestPin }: {
  item?: ItineraryItem;
  startDate: string;
  /** D-316: the start day's FULL stored items, the overlap guard's comparison set. Stored,
   * not visible — an author filter hides rows from the screen, never from the clock. */
  dayItems: ItineraryItem[];
  onSave: (item: ItineraryItem) => void;
  onClose: () => void;
  /**: the map picker is armed — step aside VISUALLY but stay mounted, so every
   * field the user has already typed survives the trip to the map and back. */
  hidden?: boolean;
  /**: the coordinate the picker returned (a fresh object per pick). */
  pickedPin?: { lat: number; lng: number } | null;
  /**: arm the picker on the map pane the parent owns. */
  onRequestPin?: () => void;
}) {
  // Live ref to the latest onClose so the once-registered Esc listener always
  // calls the current closure without re-binding on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [title, setTitle] = useState(item?.title ?? '');
  const [category, setCategory] = useState<ItineraryCategory>(item?.category ?? 'sightseeing');
  // Save only rewrites the time if the picker was touched, so an unparseable legacy `time`
  // survives unrelated edits.
  const [startMinutes, setStartMinutes] = useState<number | undefined>(() => (item ? effectiveStartMinutes(item) : undefined));
  const [timeTouched, setTimeTouched] = useState(false);
  const [durationMinutes, setDurationMinutesState] = useState<number | undefined>(() => (item ? effectiveDurationMinutes(item) : undefined));
  const [durationTouched, setDurationTouched] = useState(false);
  const [location, setLocation] = useState(item?.location ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');

  // Picked on the map, so it's either null or a complete in-range pair.
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    item?.lat !== undefined && item?.lng !== undefined ? { lat: item.lat, lng: item.lng } : null,
  );
  // A coordinate handed back by the map picker (a fresh object per pick, so re-picking the
  // same spot still lands). The parent owns the picker because the map pane it drives lives
  // out there — see `pickingPin` in CalendarPlanner.
  useEffect(() => {
    if (pickedPin) setPin({ lat: pickedPin.lat, lng: pickedPin.lng });
  }, [pickedPin]);

  // Span end options: trip days after the start day. The item stays owned by its start day;
  // only rendering spreads it across days.
  const spanDayOptions = TRIP_DATES.filter((d) => d > startDate);
  const canSpan = spanDayOptions.length > 0;
  const [spanOpen, setSpanOpen] = useState(!!item?.endDate);
  const [endDate, setEndDate] = useState(item?.endDate ?? '');
  // Saved only when the toggle is open AND a valid in-range day strictly after the start day is
  // chosen (guarantees `endDate` on disk always means a genuine span — the invariant the clash-
  // exclusion in sort-items-by-time.ts relies on); otherwise cleared (undefined), same as the pin.
  const effectiveEndDate =
    spanOpen && endDate !== '' && endDate > startDate && TRIP_DATES.includes(endDate) ? endDate : undefined;

  // D-316: the refusal message for the last blocked save, or null. Rendered as a
  // `role="alert"` line above the save button; cleared as soon as the user moves either
  // field it is about, so it never contradicts what the form currently says.
  const [clashError, setClashError] = useState<string | null>(null);

  const handleTimeChange = (minutes: number | undefined) => {
    setStartMinutes(minutes);
    setTimeTouched(true);
    setClashError(null);
  };
  const handleDurationChange = (minutes: number | undefined) => {
    setDurationMinutesState(minutes);
    setDurationTouched(true);
    setClashError(null);
  };

  // Portal only after mount; document doesn't exist during prerender.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Scroll lock, ref-counted with the nested time picker. Released while the pin picker has
  // the screen, since the map pane may need scrolling into view.
  useDialogOpenFlag(!hidden);

  // Bottom sheet below lg, centred panel above. Framer variants can't use media queries, so
  // read the breakpoint once after mount.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Google Maps link: by pin when set, else title + location. Null until there's a title.
  const mapsUrl = buildMapsPlaceUrl(title, pin?.lat, pin?.lng, location);

  // which of the collapsed fields actually hold something, named in the disclosure's
  // own label so a closed "More details" never hides data silently. Read off the LIVE editor
  // state, so it updates as you type rather than describing the item as it was opened.
  const filledDetails = [
    durationMinutes !== undefined ? 'Duration' : null,
    location.trim() ? 'Location' : null,
    pin ? 'Pin' : null,
    effectiveEndDate ? 'Multi-day' : null,
    notes.trim() ? 'Notes' : null,
  ].filter((v): v is string => v !== null);

  // Stable, collision-free ids so each <label htmlFor> binds to its input and
  // the dialog can be labelled by its title heading.
  const baseId = useId();
  const titleId = `${baseId}-modal-title`;
  const titleFieldId = `${baseId}-title`;
  const timeFieldId = `${baseId}-time`;
  const durationFieldId = `${baseId}-duration`;
  const locationFieldId = `${baseId}-location`;
  const notesFieldId = `${baseId}-notes`;
  const categoryLabelId = `${baseId}-category-label`;
  const endDateFieldId = `${baseId}-enddate`;

  // The parent returns focus on onExitComplete; doing it in cleanup here races the exit animation.
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // the control that armed the picker, so focus comes back to it when the editor
  // returns from the map.
  const pinButtonRef = useRef<HTMLButtonElement>(null);
  const wasHidden = useRef(false);
  useEffect(() => {
    if (wasHidden.current && !hidden) pinButtonRef.current?.focus();
    wasHidden.current = !!hidden;
  }, [hidden]);

  // Scrim taps are ignored once anything differs from what the editor opened with.
  const formKey = JSON.stringify([title, category, startMinutes, durationMinutes, location, notes, pin, effectiveEndDate]);
  const openedKey = useRef(formKey);
  const dirty = formKey !== openedKey.current;
  const scrimDown = useRef(false);

  // The editor stays mounted through its exit animation, so a repeated Enter or double tap would add twice.
  const saved = useRef(false);

  const handleSave = () => {
    if (saved.current) return;
    if (!title.trim()) {
      setClashError('Add a title to save');
      titleInputRef.current?.focus();
      return;
    }
    const next: ItineraryItem = {
      // Spread the original item first so additive source-linkage fields
      // survive an edit of a card-created item.
      ...item,
      id: item?.id ?? generateItemId(),
      title: title.trim(),
      category,
      // dual-write: only when the user actually touched the picker/field —
      // otherwise the item's original time/duration fields pass through untouched
      // (preserves an unparseable legacy `time`/`duration` string verbatim).
      time: timeTouched ? (startMinutes !== undefined ? minutesToHHMM(startMinutes) : undefined) : item?.time,
      startMinutes: timeTouched ? startMinutes : item?.startMinutes,
      duration: durationTouched
        ? (durationMinutes !== undefined ? formatDurationText(durationMinutes) : undefined)
        : item?.duration,
      durationMinutes: durationTouched ? durationMinutes : item?.durationMinutes,
      location: location || undefined,
      notes: notes || undefined,
      // Manual pin-drop: the chosen pair, or both explicitly
      // undefined (overriding the `...item` spread above) — clearing the pin and saving
      // removes a pin the item previously had.
      lat: pin?.lat,
      lng: pin?.lng,
      // Multi-day span: the resolved end day (strictly after the start day, in-range)
      // or undefined — overriding the `...item` spread so turning the toggle off / clearing the
      // select removes a span the item previously had. Written onto the START-day doc only.
      endDate: effectiveEndDate,
    };

    // Refuse clashes (D-316), but only when the time footprint changes, so an item that already
    // overlaps (synced or imported) can still be edited. The way out is clearing the duration.
    if (!item || timeFootprintChanged(item, startDate, next, startDate)) {
      const clash = firstClashWith(
        next,
        dayItems,
        startDate,
        offsetForCountry(getCountryForDate(startDate)),
      );
      if (clash) {
        // Do not call onSave, do not close, do not haptic — just announce.
        setClashError(
          `Overlaps ${describeClash(clash)}. Pick another time, or clear the duration to leave this open-ended.`,
        );
        return;
      }
    }
    setClashError(null);
    saved.current = true;
    onSave(next);
  };

  // On open: focus the Title input. The input's `autoFocus` handles the common
  // case; this re-asserts focus shortly after, in case the open animation steals
  // it back, but only if focus isn't already inside the dialog.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        titleInputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Document-level Esc closes the editor, except while picking a pin: then Esc belongs to the
  // pick bar, and closing would lose what was typed.
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hiddenRef.current) {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Keyboard handling on the dialog: Tab / Shift+Tab is trapped to the
  // focusable elements inside the panel (a lightweight trap, no new deps).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        // `summary` is natively focusable and puts one in the panel ("More details"),
        // so it must be part of the trap's first/last computation or Tab could escape past it.
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => {
      // A closed <details> hides everything except its summary from the tab order.
      // offsetParent does not reliably reflect that native disclosure state.
      const closedDetails = el.closest('details:not([open])');
      if (closedDetails && !closedDetails.querySelector(':scope > summary')?.contains(el)) {
        return false;
      }
      return el.checkVisibility
        ? el.checkVisibility({ checkVisibilityCSS: true })
        : el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    });

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Only the first render before mount returns null; opens are always user-driven after that.
  if (!mounted) return null;

  return createPortal(
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // `invisible` (not unmount) while the map picker is armed — React keeps every
      // field's state, and visibility:hidden takes the dialog out of hit-testing AND out of
      // the a11y tree, so the map underneath is genuinely reachable by pointer and by AT.
      className={`fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-4 bg-black/70 ${hidden ? 'invisible pointer-events-none' : ''}`}
      onPointerDown={(e: React.PointerEvent) => { scrimDown.current = e.target === e.currentTarget; }}
      onClick={(e: React.MouseEvent) => {
        // A drag that starts in a field and ends on the scrim (text selection) is not a scrim tap,
        // and a tap never throws away typed input.
        if (e.target === e.currentTarget && scrimDown.current && !dirty) onClose();
        scrimDown.current = false;
      }}
    >
      <m.div
        ref={panelRef}
        role="dialog"
        data-testid="calendar-editor"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        // `<lg`: rises from the bottom (translate-y). `lg+`: the original centered scale.
        // framer honors prefers-reduced-motion,
        // so the transform is skipped under reduce and only opacity fades in.
        initial={isDesktop ? { scale: 0.9, opacity: 0 } : { y: 40, opacity: 0 }}
        animate={isDesktop ? { scale: 1, opacity: 1 } : { y: 0, opacity: 1 }}
        exit={isDesktop ? { scale: 0.9, opacity: 0 } : { y: 40, opacity: 0 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full lg:max-w-md bg-[rgb(var(--surface-low))] border-t-2 lg:border-hair border-[color:var(--border-ui)] rounded-t-r3 lg:rounded-r2 max-h-[90dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between shrink-0 px-5 sm:px-6 pt-5 sm:pt-6 pb-4">
          <h3 id={titleId} className="pr pr--l text-ink-hi">{item ? 'Edit item' : 'Add item'}</h3>
          <button type="button" onClick={onClose} aria-label="Close editor" data-testid="calendar-editor-cancel" className="inline-flex items-center justify-center min-h-tap min-w-tap rounded-r1 hover:bg-white/5 hover:text-ink-hi text-ink-mid outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><X className="w-5 h-5" /></button>
        </div>
        <form
          noValidate
          onSubmit={(e: React.FormEvent) => { e.preventDefault(); handleSave(); }}
          className="flex flex-col flex-1 min-h-0"
        >
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide px-5 sm:px-6">
        <div className="space-y-4 pb-1">
          <div>
            <label htmlFor={titleFieldId} className="pr pr--lo mb-1 block">Title *</label>
            <input id={titleFieldId} ref={titleInputRef} autoFocus enterKeyHint="done" value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setTitle(e.target.value); setClashError(null); }} data-testid="calendar-editor-title-input" className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="e.g., Visit Boudhanath Stupa" />
          </div>
          <div>
            <span id={categoryLabelId} className="pr pr--lo mb-1 block">Category</span>
            <div className="grid grid-cols-2 min-[380px]:grid-cols-3 min-[520px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-3 gap-2" role="group" aria-labelledby={categoryLabelId}>
              {ALL_CATEGORIES.map((cat) => {
                const colors = CATEGORY_COLORS[cat];
                const isActive = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    aria-pressed={isActive}
                    aria-label={`Category: ${cat}`}
                    data-testid={`calendar-editor-category-${cat}`}
                    className={`flex flex-col items-center justify-start gap-1 min-h-[3rem] px-0.5 py-2 rounded-r1 border-hair transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      isActive ? `${colors.text} border-current bg-white/5` : 'border-transparent text-ink-lo hover:bg-white/5 hover:text-ink-hi'
                    }`}
                  >
                    {CATEGORY_ICON_MAP[cat]}
                    <span className="pr pr--lo capitalize tracking-normal max-sm:text-[0.65rem] leading-tight text-center [overflow-wrap:normal] [hyphens:manual] w-full text-current">{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label htmlFor={timeFieldId} className="pr pr--lo mb-1 block">Time</label>
            <TimePicker id={timeFieldId} value={startMinutes} onChange={handleTimeChange} testId="calendar-editor-time-input" />
          </div>
          {/* Title, category and time up front; the rest behind a native <details>. It starts
              closed, and the summary names which hidden fields hold something. */}
          <details className="group rounded-r1 border-hair border-[color:hsl(var(--border))]" data-testid="calendar-editor-more">
            <summary
              data-testid="calendar-editor-more-toggle"
              className="pr flex min-h-tap cursor-pointer list-none items-center gap-1.5 rounded-r1 px-3 transition-colors hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
            >
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              More details
              {filledDetails.length > 0 && (
                <span className="text-ink-lo">· {filledDetails.join(', ')}</span>
              )}
            </summary>
            <div className="space-y-4 px-3 pb-3">
          <div>
            <label htmlFor={durationFieldId} className="pr pr--lo mb-1 block">Duration (min)</label>
            <DurationField id={durationFieldId} value={durationMinutes} onChange={handleDurationChange} testId="calendar-editor-duration-input" />
          </div>
          <div>
            <label htmlFor={locationFieldId} className="pr pr--lo mb-1 block">Location</label>
            <input id={locationFieldId} autoComplete="off" enterKeyHint="done" value={location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)} data-testid="calendar-editor-location-input" className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="e.g., Thamel, Kathmandu" />
          </div>
          {/* Pin: "Drop a pin" arms the picker on this route's existing map pane. The picked
              coordinate is echoed as text so it's readable without the map. */}
          <div>
            <span className="pr pr--lo mb-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              Pin exact location (optional)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                ref={pinButtonRef}
                onClick={() => onRequestPin?.()}
                data-testid="calendar-editor-pin-drop"
                className="chip min-h-tap px-3 transition-colors hover:bg-white/5 hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {pin ? 'Move pin' : 'Drop a pin'}
              </button>
              {pin && (
                <>
                  <span
                    data-testid="calendar-editor-pin-value"
                    data-lat={String(pin.lat)}
                    data-lng={String(pin.lng)}
                    className="num text-t-sm text-ink-hi"
                  >
                    {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPin(null)}
                    data-testid="calendar-editor-pin-clear"
                    className="inline-flex min-h-tap items-center rounded-r1 px-1 font-machine text-t-sm text-ink-mid underline underline-offset-2 transition-colors hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Clear pin
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Multi-day span; disabled on the last trip day. */}
          <div>
            <button
              type="button"
              onClick={() => setSpanOpen((v) => !v)}
              aria-expanded={spanOpen}
              disabled={!canSpan}
              data-testid="calendar-editor-span-toggle"
              className="pr flex min-h-tap items-center gap-1.5 hover:text-ink-hi transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r1 focus-visible:outline-none disabled:text-ink-lo disabled:cursor-not-allowed"
            >
              <Calendar className="w-3.5 h-3.5" />
              Spans multiple days (optional)
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${spanOpen ? 'rotate-180' : ''}`} />
            </button>
            {spanOpen && canSpan && (
              <div className="mt-2">
                <label htmlFor={endDateFieldId} className="pr pr--lo mb-1 block">Ends on (inclusive last day)</label>
                <select
                  id={endDateFieldId}
                  value={endDate}
                  data-testid="calendar-editor-span-select"
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEndDate(e.target.value)}
                  className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <option value="">Single day (no span)</option>
                  {spanDayOptions.map((d) => (
                    <option key={d} value={d}>{formatDateLong(d)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {/* Google Maps research link-out. Disabled until Title is
              non-empty; a URL, not an API — no key, no quota. */}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="calendar-editor-maps-link"
              className="chip min-h-tap w-full justify-start gap-2 px-3 chip--struck transition-colors hover:bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              Search on Google Maps
            </a>
          ) : (
            <span
              aria-disabled="true"
              data-testid="calendar-editor-maps-link"
              className="chip chip--hollow min-h-tap w-full justify-start gap-2 px-3 cursor-not-allowed select-none"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              Search on Google Maps
            </span>
          )}
          <div>
            <label htmlFor={notesFieldId} className="pr pr--lo mb-1 block">Notes</label>
            <textarea id={notesFieldId} value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} data-testid="calendar-editor-notes-input" className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo focus:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" placeholder="Additional notes..." />
          </div>
            </div>
          </details>
        </div>
        </div>
        <div className="shrink-0 border-t-2 border-[color:var(--border-ui)] bg-[rgb(var(--surface-low))] px-5 sm:px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* role="alert" for a blocked save. Always mounted with reserved height so the live
              region exists before it speaks and the panel doesn't jump. */}
          <p
            role="alert"
            data-testid="calendar-editor-clash-error"
            className="err mb-3 min-h-[1rem] text-t-sm"
          >
            {clashError}
          </p>
          <button
            type="submit"
            data-testid="calendar-editor-save"
            className="btn w-full px-4 focus-visible:outline-none"
          >
            <Check className="w-4 h-4" />
            {item ? 'Update item' : 'Add item'}
          </button>
        </div>
        </form>
      </m.div>
    </m.div>,
    document.body,
  );
}

export default function CalendarPlanner() {
  // Compact day strip once scrolled (#776). Hysteresis (64 in / 8 out) because the strip's own
  // height change shifts content and would otherwise re-cross a single threshold.
  const [stripCompact, setStripCompact] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setStripCompact((c) => (c ? y > 8 : y > 64));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // `?focus=<itemId>` from the command palette. Read reactively so a new focus while already
  // on /plan works without a remount.
  const searchParams = useSearchParams();

  // The itinerary now lives in the shared reactive store instead of
  // component-local state. `plans`/`hydrated` and the mutators come from the one
  // app-root instance, so a same-tab calendar edit propagates to the dashboard live.
  const {
    plans,
    addItem,
    updateItem,
    removeItem,
    restoreItem,
    clearDay,
    restoreDay,
    moveItem,
    deleteItems,
    moveItems,
    copyDay,
    reorderItems,
    getDayPlan,
    restoreConflict,
    dismissConflict,
  } = useItineraryContext();
  // clear-whole-day confirm gate (Radix AlertDialog — reused primitive, not bespoke).
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // multi-select mode — OFF/invisible by default. When on, items show a checkbox and a
  // bulk-action bar appears (move / copy-day / delete). Selection is per-day (the calendar
  // shows one day at a time), so every selected id belongs to `selectedDate`.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(TRIP_DATES[0]);
  const [editingItem, setEditingItem] = useState<ItineraryItem | undefined>(undefined);
  const [showEditor, setShowEditor] = useState(false);
  const [viewMode, setViewMode] = useState<'calendar' | 'agenda'>('calendar');
  // Row 2: under 640px the toolbar's secondary controls fold into a disclosure. One
  // boolean and a Tailwind breakpoint — at `sm+` the panel is always laid out inline and
  // this flag is inert, so the controls are declared once and never duplicated per width.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowPanelId = useId();
  // the mobile month-grid expander, lifted out of CalendarDayPicker with the strip
  // (see Row 1 below and the prop doc in calendar-day-picker.tsx). Collapsed by default so
  // the phone still lands on the single-day agenda.
  const [showMonthView, setShowMonthView] = useState(false);

  // split map/list view. OFF by default so the maplibre island stays
  // interaction-lazy.
  const [showMap, setShowMap] = useState(false);
  // Shared highlight for map markers and list rows; also takes a plain item id from search.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Cross-day focus: change the day first and highlight once it settles, or the day-change
  // effect clears the highlight in the same commit.
  const pendingFocusRef = useRef<{ date: string; id: string } | null>(null);
  // Mobile bottom-sheet peek ⇄ expanded. `isDesktop` picks the inline split pane
  // (lg+) vs the bottom-sheet (`<lg`) — one <PlanDayMap> instance, placed responsively.
  // Eager init is safe: CalendarPlanner is a dynamic(ssr:false) island (client-only).
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [mapExpanded, setMapExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dayHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const lastDeleteAtRef = useRef(0);

  // Pin picking: the editor stays mounted but hidden while the map pane collects a point.
  // A fresh object per pick, so re-picking the same spot still updates the editor.
  const [pickingPin, setPickingPin] = useState(false);
  const [pickedPin, setPickedPin] = useState<{ lat: number; lng: number } | null>(null);
  const handleRequestPin = () => {
    setShowMap(true); // reuses the one lazy pane; a no-op if the map is already open
    setPickingPin(true);
  };
  const handleMapPick = (ll: { lng: number; lat: number }) => {
    setPickedPin({ lat: ll.lat, lng: ll.lng });
    setPickingPin(false);
  };

  // Presentational author filter: READ-ONLY. It only narrows which items
  // are SHOWN; it never touches `plans`/localStorage or any store mutator. CRUD, DnD and
  // persistence operate on the FULL stored set below, unaffected by the active filter.
  const { filter: authorFilter, myName, myPriorNames } = useAuthorFilter();

  /**
   * The one place the author filter is applied. Every calendar surface reads days through this,
   * so new ones are filtered by default. With no filter it returns `getDayPlan` itself, keeping
   * the same references and memo identities.
   * Don't route destructive or whole-day logic through it: drag reorder, Clear day, bulk delete
   * and the empty-state check all need the unfiltered day.
   */
  const getVisibleDayPlan = useMemo(
    () =>
      authorFilter.kind === 'all'
        ? getDayPlan
        : (date: string): DayPlan => {
            const plan = getDayPlan(date);
            return { ...plan, items: filterItemsByAuthor(plan.items ?? [], authorFilter, myName, myPriorNames) };
          },
    [getDayPlan, authorFilter, myName, myPriorNames],
  );

  // Read-only spend per day. Rows from another leg are excluded because the day formats in its
  // own currency; they still count in the leg and trip totals.
  const { expenses } = useExpenses();
  const spendByDate = useMemo(() => expensesByDate(expenses), [expenses]);

  // The element focused when the editor opened (the "Add Activity" / edit
  // button), captured before the modal autofocuses, so focus returns to it once
  // the exit animation completes. See AnimatePresence onExitComplete below.
  const triggerRef = useRef<HTMLElement | null>(null);

  // drag-and-drop wiring (sensors, active-drag id, reorder / move-between-days
  // handlers) lives in a co-located hook now — same logic, lifted out to shrink this file.
  const { sensors, announcements, activeItem, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel } = useCalendarDnd({
    plans,
    getDayPlan,
    moveItem,
    reorderItems,
  });

  // In-trip, start on today. Once, after mount, so the first paint matches the prerender.
  useEffect(() => {
    const t = getTodayInTrip();
    if (t) setSelectedDate(t.date);
  }, []);

  // So the quick-add FAB defaults to the day on screen. In memory only.
  useEffect(() => {
    setSelectedDay(selectedDate);
  }, [selectedDate]);

  const handleAddItem = () => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setEditingItem(undefined);
    // a pick left over from the last editor session must not seed the next one —
    // the editor applies `pickedPin` on mount as well as on change.
    setPickedPin(null);
    setShowEditor(true);
  };

  // Peel a leading or trailing time off the text and write the same fields the editor does.
  const handleQuickAdd = (text: string) => {
    const { title, startMinutes } = extractQuickAddTime(text);
    if (!title) return;
    addItem(selectedDate, {
      id: generateItemId(),
      title,
      category: 'sightseeing',
      ...(startMinutes !== undefined ? { startMinutes, time: minutesToHHMM(startMinutes) } : {}),
    });
  };

  const handleEditItem = (item: ItineraryItem) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setEditingItem(item);
    setPickedPin(null); // see handleAddItem
    setShowEditor(true);
  };

  const handleSaveItem = (item: ItineraryItem) => {
    // Edit-in-place when the item already exists on the selected day; otherwise add.
    // Mirrors the former updateDayPlan upsert (replace by id, else append).
    const dayPlan = getDayPlan(selectedDate);
    const exists = (dayPlan.items ?? []).some((i) => i.id === item.id);
    if (exists) {
      // changed keys only: a whole-item patch re-stamps done and carries stale rev/hlc (#844)
      const prev = editingItem ?? (dayPlan.items ?? []).find((i) => i.id === item.id)!;
      updateItem(selectedDate, item.id, itemPatch(prev, item));
    } else {
      addItem(selectedDate, item);
    }
    setShowEditor(false);
    setEditingItem(undefined);
    haptic(); // — subtle pulse on itinerary item save (gated internally on reduced-motion).
  };

  // Copy with a fresh id (freshCopyOf drops id and sync stamps).
  const handleDuplicateItem = (item: ItineraryItem, targetDate: string) => {
    const copy = freshCopyOf(item);
    // Check the copy, not the source: the source would exclude itself and miss a same-day clash.
    const clash = firstClashWith(
      copy,
      getDayPlan(targetDate).items ?? [],
      targetDate,
      offsetForCountry(getCountryForDate(targetDate)),
    );
    if (clash) {
      const msg = `Can’t copy to ${formatDate(targetDate)} — overlaps ${describeClash(clash)}.`;
      toast.error(msg, { duration: readMs(msg) });
      return;
    }
    addItem(targetDate, copy);
  };

  const handleDeleteItem = (item: ItineraryItem) => {
    // A double tap's second hit lands on the row that reflowed under the first, so an id guard
    // can't catch it. A short window covers pointer, swipe and Enter key-repeat alike.
    const now = Date.now();
    if (now - lastDeleteAtRef.current < 400) return;
    lastDeleteAtRef.current = now;
    // Capture the full item in the closure BEFORE removing, so Undo can restore it.
    // removeItem is unchanged (tombstone under sync, physical under dormant); restoreItem
    // mirrors it (fresh-id under sync, same-id under dormant).
    const day = selectedDate;
    const at = allItemIds.indexOf(item.id);
    const neighbourId = allItemIds[at + 1] ?? allItemIds[at - 1];
    removeItem(day, item.id);
    showUndoToast(`Deleted “${item.title}”`, () => restoreItem(day, item));
    // The focused Delete button just unmounted; hand focus to the next/previous row's Delete,
    // else the day heading, instead of letting it fall to <body>.
    requestAnimationFrame(() => {
      const next = neighbourId
        ? listRef.current?.querySelector<HTMLElement>(`[data-testid="calendar-item-delete-${neighbourId}"]`)
        : null;
      if (next) next.focus({ preventScroll: true });
      else dayHeadingRef.current?.focus();
    });
  };

  // Capture the items first so Undo can restore them all.
  const handleClearDay = () => {
    const day = selectedDate;
    const items = getDayPlan(day).items ?? []; // exposed = live items only
    if (items.length === 0) return;
    clearDay(day);
    showUndoToast(
      `Cleared ${items.length} item${items.length === 1 ? '' : 's'}`,
      () => restoreDay(day, items),
    );
  };

  // ── multi-select handlers ───────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // Selection is per-day: clear it whenever the visible day changes, so a stale id from a
  // previous day can never leak into a bulk op on the new day.: the map highlight is
  // likewise per-day (a marker from another day must not stay emphasized) — clear it too.
  useEffect(() => {
    setSelectedIds(new Set());
    setHighlightId(null);
  }, [selectedDate]);

  // Must stay after the clear-highlight effect so its setHighlightId wins.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending && pending.date === selectedDate) {
      setHighlightId(pending.id);
      pendingFocusRef.current = null;
    }
  }, [selectedDate]);

  // Same day: highlight now. Other day: queue it and switch days.
  const focusItem = (date: string, id: string) => {
    if (date === selectedDate) {
      setHighlightId(id);
    } else {
      pendingFocusRef.current = { date, id };
      setSelectedDate(date);
    }
  };

  const handleSearchSelect = (result: PlanSearchResult) => focusItem(result.date, result.item.id);

  // Consume ?focus= then strip it with history.replaceState so a reload doesn't re-highlight.
  // Not the router: the path already has the basePath (see stripFocusParam).
  useEffect(() => {
    const focusId = searchParams?.get('focus');
    if (!focusId) return;
    const day = plans.find((p) => (p.items ?? []).some((i: ItineraryItem) => i.id === focusId));
    if (day) focusItem(day.date, focusId);
    window.history.replaceState(null, '', stripFocusParam(window.location.href));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // track the lg breakpoint so the map renders as the inline split pane (lg+) or the
  // bottom-sheet peek (`<lg`) — a single PlanDayMap instance placed by `isDesktop`.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // a marker click on the map → emphasize its row + bring it into view. `highlightId`
  // is a MARKER id (the shared join vocabulary), so the same value drives both the map paint
  // and the list ring — the row whose matched marker equals it lights up.
  const handleMarkerClick = (markerId: string) => setHighlightId(markerId);
  useEffect(() => {
    if (!highlightId) return;
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlightId]);

  // One commit. bulkMoveWithUndo owns the undo, which must address the landed ids, not the
  // selected ones.
  const handleBulkMove = (targetDate: string) => {
    if (!targetDate || targetDate === selectedDate || selectedIds.size === 0) return;
    // All or nothing (D-316). Checked only against the target day's items, not each other,
    // since they already coexist.
    const moving = (getDayPlan(selectedDate).items ?? []).filter((i) => selectedIds.has(i.id));
    const targetItems = getDayPlan(targetDate).items ?? [];
    const targetOffset = offsetForCountry(getCountryForDate(targetDate));
    for (const moved of moving) {
      const clash = firstClashWith(moved, targetItems, targetDate, targetOffset);
      if (clash) {
        const msg = `Can’t move ${moving.length} item${moving.length === 1 ? '' : 's'} to ${formatDate(targetDate)} — “${moved.title}” overlaps ${describeClash(clash)}.`;
        toast.error(msg, { duration: readMs(msg) });
        return;
      }
    }
    bulkMoveWithUndo(moveItems, [...selectedIds], selectedDate, targetDate);
    exitSelectMode();
  };

  // Copy the WHOLE current day onto another day (copyDay — fresh-id copies of every live item).
  // Independent of the selection (it is a day-level op living in the bulk bar for convenience).
  const handleCopyDay = (targetDate: string) => {
    if (!targetDate) return;
    // D-316 — ALL-OR-NOTHING, same shape as the bulk move. Checked on `freshCopyOf` of each
    // source item, which is literally the transform `copyDay` applies, so the ids under
    // test are the ones that would land.
    const targetItems = getDayPlan(targetDate).items ?? [];
    const targetOffset = offsetForCountry(getCountryForDate(targetDate));
    for (const source of getDayPlan(selectedDate).items ?? []) {
      const clash = firstClashWith(freshCopyOf(source), targetItems, targetDate, targetOffset);
      if (clash) {
        const msg = `Can’t copy this day to ${formatDate(targetDate)} — “${source.title}” overlaps ${describeClash(clash)}.`;
        toast.error(msg, { duration: readMs(msg) });
        return;
      }
    }
    copyDay(selectedDate, targetDate);
    exitSelectMode();
  };

  // Bulk delete the current selection (confirmed via the Radix AlertDialog). Capture the full
  // items BEFORE deleting so Undo can restore them (restoreDay = fresh-id batch restore under
  // sync, same-id under dormant — reused, not re-invented). deleteItems is ONE commit.
  const handleBulkDelete = () => {
    const day = selectedDate;
    const items = (getDayPlan(day).items ?? []).filter((i) => selectedIds.has(i.id));
    if (items.length === 0) return;
    deleteItems(items.map((i) => ({ date: day, itemId: i.id })));
    showUndoToast(
      `Deleted ${items.length} item${items.length === 1 ? '' : 's'}`,
      () => restoreDay(day, items),
    );
    exitSelectMode();
  };

  const currentPlan = getDayPlan(selectedDate);
  const currentIdx = TRIP_DATES.indexOf(selectedDate);

  // Weather tag from the existing forecast cache, no new fetch. Read in an effect, like other
  // storage reads.
  const [dayWeatherTag, setDayWeatherTag] = useState<WeatherTag | null>(null);
  useEffect(() => {
    setDayWeatherTag(weatherTagForDay(getCachedForecastForDate(currentPlan.city, selectedDate)));
  }, [currentPlan.city, selectedDate]);

  const goToPrev = () => {
    if (currentIdx > 0) setSelectedDate(TRIP_DATES[currentIdx - 1] ?? selectedDate);
  };
  const goToNext = () => {
    if (currentIdx < TRIP_DATES.length - 1) setSelectedDate(TRIP_DATES[currentIdx + 1] ?? selectedDate);
  };

  // The selected day's full stored item set (unfiltered — this is the CRUD/DnD target, and the
  // count "Clear day" and the empty-state branch must both reason about).
  const dayItems = currentPlan.items ?? [];
  // the selected day AS SHOWN. Memoized so the split-view map's `dayStops` (and anything
  // else keyed on the plan object) keeps a stable identity across renders while a filter is
  // active — `getVisibleDayPlan` builds a fresh object per call when it is filtering.
  const visiblePlan = useMemo(
    () => getVisibleDayPlan(selectedDate),
    [getVisibleDayPlan, selectedDate],
  );
  // Filtered items for rendering. Memoized so exhaustive-deps doesn't flag the memos below.
  const visibleItems = useMemo(() => visiblePlan.items ?? [], [visiblePlan]);
  // The day's UTC offset, from the full day: filtered-out rows may be what set it.
  const dayOffsetMin = dayZoneOffsetMin(
    currentPlan.items,
    selectedDate,
    offsetForCountry(getCountryForDate(selectedDate)),
  );
  const daySun = useMemo(
    () => daySunTimes(selectedDate, currentPlan.city, currentPlan.country),
    [selectedDate, currentPlan.city, currentPlan.country],
  );
  // Timed items by instant, then an "Anytime" run. View only; stored order is untouched.
  // SortableContext uses this order so dnd-kit matches the DOM.
  const phaseGroups = useMemo(
    () => groupItemsByPhase(visibleItems, selectedDate, dayOffsetMin),
    [visibleItems, selectedDate, dayOffsetMin],
  );
  const allItemIds = phaseGroups.map((g) => g.item.id);
  // FILLED means committed: an item that carries a real start time is STRUCK, an untimed one is
  // still an idea and is drawn HOLLOW. The running head prints both counts.
  const struckCount = useMemo(
    () => visibleItems.filter((i) => effectiveStartMinutes(i) !== undefined).length,
    [visibleItems],
  );
  // From the visible set. Spend and weather stay unfiltered: they're about the day.
  const firstTimedItem = useMemo(() => earliestTimedItem(visibleItems), [visibleItems]);
  const firstStartInfo = firstTimedItem ? describeItemTime(firstTimedItem, selectedDate) : null;
  // Warning only, over visible items, compared as absolute instants.
  const dayClashIds = useMemo(
    () => clashingItemIds(visibleItems, selectedDate, dayOffsetMin),
    [visibleItems, selectedDate, dayOffsetMin],
  );
  // the day's unplanned rules, keyed by the row each is drawn ABOVE. Measured in chronological
  // order, presentation-only — and since the rendered order is now chronological too, each rule
  // lands between the two rows it actually describes.
  const dayGaps = useMemo(
    () => unplannedGapsByItemId(visibleItems, selectedDate, dayOffsetMin),
    [visibleItems, selectedDate, dayOffsetMin],
  );

  // Spanning items covering the selected day (ISO dates compare as strings). On days other than
  // the start day the item appears only as a band.
  const spanBands = useMemo(() => {
    const bands: { item: ItineraryItem; spanStart: string; spanEnd: string; isStartDay: boolean }[] = [];
    for (const plan of plans) {
      for (const item of plan.items ?? []) {
        if (!item.endDate || item.endDate <= plan.date) continue; // genuine forward span only
        // A band's owning day isn't the selected one, so apply the filter predicate directly.
        if (!itemMatchesAuthor(item, authorFilter, myName, myPriorNames)) continue;
        if (plan.date <= selectedDate && selectedDate <= item.endDate) {
          bands.push({ item, spanStart: plan.date, spanEnd: item.endDate, isStartDay: plan.date === selectedDate });
        }
      }
    }
    return bands;
  }, [plans, selectedDate, authorFilter, myName, myPriorNames]);

  // The visible day's stops; a reorder produces a new array and redraws the route.
  const dayStops = useMemo(() => buildItineraryStops([visiblePlan]), [visiblePlan]);
  // Per-item matched marker id — the same stopMarkerFor join buildItineraryStops uses (pin
  // BEATS name/sourceId match,), so a row and its map stop always agree. Drives the
  // row ring + the "show on map" affordance.
  const markerIdFor = (item: ItineraryItem) =>
    stopMarkerFor(item, legLabel(currentPlan.country))?.id ?? null;

  // Per-day meta for the mobile strip. Memoized: it walks every trip day.
  const dayStripMeta: DayStripDateMeta[] = useMemo(
    () =>
      TRIP_DATES.map((date) => ({
        date,
        country: getCountryForDate(date),
        count: getVisibleDayPlan(date).items?.length ?? 0,
      })),
    [getVisibleDayPlan],
  );
  useTravelTick(); // re-render on the shared tick so the "today" strip rolls over past midnight (#791)
  const todayStripDate = getTodayInTrip()?.date ?? null;

  // One map instance, desktop pane or mobile sheet, never both.
  // The boundary is required: the maplibre chunk isn't precached, so offline the lazy load
  // throws here and would otherwise take down all of /plan. gen-sw.mjs checks for it.
  const mapEl = (
    <MapIslandBoundary label="The day map">
      <PlanDayMap
        dayStops={dayStops}
        totalItems={visibleItems.length}
        highlightId={highlightId}
        onMarkerClick={handleMarkerClick}
        pickMode={pickingPin}
        onPick={handleMapPick}
        onCancelPick={() => setPickingPin(false)}
      />
    </MapIslandBoundary>
  );

  return (
    <section id="itinerary" aria-labelledby="itinerary-heading" className="py-4 px-4 sm:px-6 sm:py-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Running head. Not sticky: the day strip is already pinned below the navbar. */}
        {/* Focusable because it scrolls sideways with nothing focusable inside. role="group",
            since axe rejects "region" on a header. */}
        <header
          className="head static mb-3 -mx-4 sm:-mx-6 max-sm:hidden outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          tabIndex={0}
          role="group"
          aria-label="Day summary"
          data-leg={currentPlan.country}
          style={{ ['--now' as string]: dayShade(selectedDate).color }}
        >
          <div className="f">
            <span className="k">Day</span>
            <span className="v">{currentIdx + 1} / {TRIP_DATES.length}</span>
          </div>
          <div className="f f--now">
            <span className="k">{formatDate(selectedDate)}</span>
            <span className="v">{dayPlaceLabel(currentPlan)}</span>
          </div>
          <div className="f">
            <span className="k">On this day</span>
            <span className="v">{visibleItems.length} {visibleItems.length === 1 ? 'item' : 'items'}</span>
          </div>
          <div className="f f--drop">
            <span className="k">Marks</span>
            <span className="v">{struckCount} struck · {visibleItems.length - struckCount} hollow</span>
          </div>
          <div className="f f--drop">
            <span className="k">Trip</span>
            <span className="v">{TRIP_DATES.length} days</span>
          </div>
        </header>

        {/* #920: heading is screen-reader only so the day workspace opens in the first screen;
            the trip-wide density overview sits below the planner in a disclosure. */}
        <h2 id="itinerary-heading" className="sr-only">Itinerary planner</h2>

        {/* Sticky day strip below lg. A direct child of the planner so sticky spans the whole
            scroll. Top is navbar height plus its 2px border; 104px resting, 72px compact once
            scrolled. */}
        <div className={`sticky top-[calc(var(--nav-h)+2px)] z-20 -mx-4 mb-4 flex ${stripCompact ? 'h-[72px]' : 'h-[104px]'} items-center gap-2 border-b-2 border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] px-4 sm:-mx-6 sm:px-6 lg:hidden`}>
          <div className="min-w-0 flex-1">
            <DayStrip
              dates={TRIP_DATES}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
              meta={dayStripMeta}
              todayDate={todayStripDate}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowMonthView((v) => !v)}
            aria-expanded={showMonthView}
            aria-label="Month view"
            data-testid="calendar-month-view-toggle"
            className="inline-flex min-h-tap min-w-tap shrink-0 flex-col items-center justify-center rounded-r1 text-ink-mid transition-colors hover:bg-white/5 hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Calendar className="w-4 h-4" aria-hidden="true" />
            <ChevronDown className={`w-3 h-3 transition-transform ${showMonthView ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>

        {/* One 44px toolbar. Below sm everything but the map toggle folds into an overflow
            panel; the same nodes are reused rather than duplicated, which would double the
            testids. */}
        {/* Search shares this row on phones so the day clears the tab bar. */}
        <div className="flex items-start gap-2 max-sm:mb-3 sm:block">
        <PlanSearch plans={plans} onSelect={handleSearchSelect} />
        <div
          role="group"
          aria-label="Plan tools"
          data-testid="calendar-toolbar"
          className="relative flex min-h-tap shrink-0 items-center justify-center gap-2 sm:mb-6 sm:flex-wrap"
        >
          {/* Map toggle, off by default so maplibre loads lazily. Never in the overflow. */}
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            aria-pressed={showMap}
            data-testid="plan-map-toggle"
            className={`chip min-h-tap px-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              showMap ? 'chip--struck bg-white/5' : 'hover:bg-white/5 hover:text-ink-hi'
            }`}
          >
            <MapIcon className="w-4 h-4" aria-hidden="true" />
            <span className="max-sm:sr-only">{showMap ? 'Hide map' : 'Show map'}</span>
          </button>

          <button
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            aria-expanded={overflowOpen}
            aria-controls={overflowPanelId}
            data-testid="calendar-toolbar-overflow"
            className="chip min-h-tap min-w-tap px-3 transition-colors hover:bg-white/5 hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:hidden"
          >
            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">More</span>
          </button>

          <div
            id={overflowPanelId}
            data-testid="calendar-toolbar-panel"
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Escape') setOverflowOpen(false);
            }}
            className={`${
              overflowOpen
                ? 'absolute right-0 top-full z-20 mt-1 w-56 flex-col items-stretch gap-1 rounded-r2 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface-overlay))] p-2 flex'
                : 'hidden'
            } sm:static sm:z-auto sm:mt-0 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0 sm:flex`}
          >
            {/* View Toggle — desktop only (`lg+`). On phones the day-strip + collapsible
                month view replace this Calendar/Agenda switch, so it is hidden below `lg`. */}
            <button
              onClick={() => setViewMode('calendar')}
              aria-pressed={viewMode === 'calendar'}
              className={`chip hidden min-h-tap px-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:inline-flex ${viewMode === 'calendar' ? 'chip--struck bg-white/5' : 'hover:bg-white/5 hover:text-ink-hi'}`}
            >
              <Calendar className="w-4 h-4 inline mr-1.5" />
              Calendar View
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              aria-pressed={viewMode === 'agenda'}
              className={`chip hidden min-h-tap px-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:inline-flex ${viewMode === 'agenda' ? 'chip--struck bg-white/5' : 'hover:bg-white/5 hover:text-ink-hi'}`}
            >
              <MapPin className="w-4 h-4 inline mr-1.5" />
              Agenda View
            </button>

            {/* Author filter; hides itself when nothing is attributed. */}
            <AuthorFilterControl plans={plans} />

            {/* Unfiltered dayItems on purpose: Clear day also removes hidden items. */}
            {dayItems.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  aria-pressed={selectMode}
                  data-testid="calendar-select-toggle"
                  className={`chip min-h-tap px-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    selectMode ? 'chip--struck bg-white/5' : 'hover:text-ink-hi hover:bg-white/5'
                  }`}
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  {selectMode ? 'Done' : 'Select'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  data-testid="calendar-clear-day"
                  className="chip min-h-tap px-3 transition-colors hover:border-[color:hsl(var(--destructive))] hover:text-[color:hsl(var(--destructive))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Clear day
                </button>
              </>
            )}
          </div>
        </div>
        </div>

        <div className="grid lg:grid-cols-[340px_1fr] gap-6">
          {/* Left: the day selector — extracted the mobile day-strip block + desktop
              month-grid / agenda-list into CalendarDayPicker (pure move, same markup). */}
          <CalendarDayPicker
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            viewMode={viewMode}
            // the FILTERED accessor. This single prop is what makes the month-grid dots,
            // its per-cell `aria-label` ("N activities planned") and the agenda list's "N items"
            // all agree with the filtered day list — `calendar-day-picker.tsx` needed no edit.
            getDayPlan={getVisibleDayPlan}
            spendByDate={spendByDate}
            todayStripDate={todayStripDate}
            showMonthView={showMonthView}
          />

          {/* Right region: the day detail + the optional inline map pane. When the
              map is open on lg+ they sit side-by-side at xl and stack at lg. */}
          <div className={`min-w-0 ${showMap && isDesktop ? 'grid grid-cols-1 xl:grid-cols-[1fr_minmax(300px,360px)] gap-6 items-start' : ''}`}>
          {/* Right: Day Detail with DnD */}
          <div className="min-w-0 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] p-4 sm:p-6" data-leg={currentPlan.country} style={{ ['--now' as string]: dayShade(selectedDate).color }}>
            {/* Day Header */}
            <div className="flex items-center justify-between gap-1 mb-3 sm:mb-5">
              <button onClick={goToPrev} disabled={currentIdx <= 0} aria-label="Previous day" data-testid="calendar-prev-day" className="shrink-0 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 hover:bg-white/5 text-ink-mid disabled:text-ink-lo disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><ChevronLeft className="w-5 h-5" /></button>
              <div className="text-center min-w-0 px-1">
                <h3 ref={dayHeadingRef} tabIndex={-1} className="font-sans text-n-sm font-semibold text-ink-hi outline-none sm:text-n-md">{formatDateLong(selectedDate)}</h3>
                <p className="pr pr--lo mt-0.5">
                  <span
                    aria-hidden="true"
                    data-testid="calendar-day-swatch"
                    className={`mr-1.5 inline-block h-2 w-2 align-middle ${dayShade(selectedDate).satellite ? 'rotate-45' : 'rounded-full'}`}
                    style={{ background: swatchFill(dayShade(selectedDate)) }}
                  />
                  Day {currentIdx + 1} · {dayPlaceLabel(currentPlan)}
                </p>
                {/* Count, first start, spend, weather. */}
                <div
                  data-testid="calendar-day-glance"
                  className="mt-1 flex flex-wrap justify-center items-center gap-1.5"
                >
                  {/* the VISIBLE count. This pill sitting at "7 items" above a list showing
                      2 was the headline symptom of the filter bug. */}
                  {visibleItems.length > 0 && (
                    <span
                      data-testid="calendar-day-glance-count"
                      className="chip"
                    >
                      {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {firstStartInfo && (
                    <span
                      data-testid="calendar-day-glance-first-start"
                      className="chip"
                    >
                      From {firstStartInfo.label}
                    </span>
                  )}
                  {daySun && (
                    <span data-testid="calendar-day-sun" className="chip max-sm:[@media(max-height:699px)]:hidden">
                      <Sunrise className="w-3 h-3" aria-hidden="true" />
                      <span>Sunrise {formatTimeAmPm(daySun.sunriseMin)}</span>
                      <Sunset className="w-3 h-3" aria-hidden="true" />
                      <span>Sunset {formatTimeAmPm(daySun.sunsetMin)}</span>
                    </span>
                  )}
                  {/* cost overlay (read-only): this day's total logged spend, in the day's
                      leg-local currency (a single day is one leg). Renders only when there is spend;
                      an unplanned/no-spend day shows nothing extra. Purely derived from useExpenses(). */}
                  {(spendByDate[selectedDate] ?? 0) > 0 && (
                    <span
                      data-testid="calendar-day-spend-total"
                      className="chip chip--struck"
                    >
                      <span aria-hidden="true">•</span>
                      <span>
                        {formatMoney(spendByDate[selectedDate] ?? 0, legCurrency(currentPlan.country))} spent
                      </span>
                    </span>
                  )}
                  {/* Only when the cache covers this city and date. */}
                  {dayWeatherTag && (
                    <span
                      data-testid="calendar-day-weather-tag"
                      className="chip"
                    >
                      <span aria-hidden="true">{dayWeatherTag.icon}</span>
                      <span>{dayWeatherTag.label}</span>
                    </span>
                  )}
                </div>
              </div>
              <button onClick={goToNext} disabled={currentIdx >= TRIP_DATES.length - 1} aria-label="Next day" data-testid="calendar-next-day" className="shrink-0 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 hover:bg-white/5 text-ink-mid disabled:text-ink-lo disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><ChevronRight className="w-5 h-5" /></button>
            </div>

            {/* Composer. A leading or trailing time ("7pm dinner") becomes the item's time.
                "Details" is the only way to open a blank editor. */}
            {/* Scrolls with the content; only the navbar and day strip stay pinned. */}
            <div className="z-10 -mx-4 sm:-mx-6 mb-3 border-b-2 border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] px-4 py-2 sm:px-6">
              <div className="flex items-center gap-2">
                <QuickAddInput
                  className="min-w-0 flex-1"
                  // The accessible name carries the time hint in full; the placeholder cannot,
                  // because at 390px this row also holds the submit + Details buttons and
                  // anything longer than ~20 characters truncates mid-word (measured).
                  label={`Quick-add a plan for ${formatDateLong(selectedDate)} — begin or end with a time like 7pm to set it`}
                  placeholder="Add a plan…"
                  testId="calendar-quick-add"
                  onAdd={handleQuickAdd}
                />
                <button
                  type="button"
                  onClick={handleAddItem}
                  data-testid="calendar-add-item"
                  className="chip chip--hollow shrink-0 min-h-tap px-3 transition-colors hover:border-[color:hsl(var(--accent))] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Details
                </button>
              </div>
              {/* Time-syntax hint on its own line so it wraps instead of truncating. */}
              <p
                data-testid="calendar-quick-add-hint"
                className="mt-1 text-t-sm leading-snug text-ink-mid max-sm:[@media(max-height:699px)]:hidden"
              >
                Tip: start with a time — “7pm dinner”
              </p>
            </div>

            {/* Select and Clear day live in the toolbar above. */}

            {/* Bulk actions in select mode; this component owns selection and the confirm. */}
            {selectMode && (
              <CalendarBulkToolbar
                selectedCount={selectedIds.size}
                selectedDate={selectedDate}
                onBulkMove={handleBulkMove}
                onCopyDay={handleCopyDay}
                onRequestDelete={() => setConfirmBulkDeleteOpen(true)}
              />
            )}

            {/* bulk-delete confirm. */}
            <AlertDialog open={confirmBulkDeleteOpen} onOpenChange={setConfirmBulkDeleteOpen}>
              <AlertDialogContent className="bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] rounded-r2 text-ink-hi" data-testid="calendar-bulk-delete-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete selected items?</AlertDialogTitle>
                  <AlertDialogDescription className="text-t-body text-ink-mid">
                    This removes the {selectedIds.size} selected item{selectedIds.size === 1 ? '' : 's'} from {formatDateLong(selectedDate)}. You can undo it right after.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="calendar-bulk-delete-cancel">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="calendar-bulk-delete-action"
                    onClick={handleBulkDelete}
                    className="btn btn--danger"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
              <AlertDialogContent className="bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] rounded-r2 text-ink-hi" data-testid="calendar-clear-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear this day?</AlertDialogTitle>
                  {/* Unfiltered count: it states what will actually be deleted. */}
                  <AlertDialogDescription className="text-t-body text-ink-mid">
                    This removes all {dayItems.length} item{dayItems.length === 1 ? '' : 's'} planned for {formatDateLong(selectedDate)}. You can undo it right after.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="calendar-clear-cancel">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="calendar-clear-confirm-action"
                    onClick={handleClearDay}
                    className="btn btn--danger"
                  >
                    Clear day
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Multi-day span bands, above the list on every covered day. */}
            {spanBands.length > 0 && (
              <div className="space-y-2 mb-3" data-testid="calendar-span-bands">
                {spanBands.map(({ item, spanStart, spanEnd, isStartDay }) => {
                  const colors = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.free;
                  return (
                    <div
                      key={item.id}
                      data-testid={`calendar-span-band-${item.id}`}
                      aria-label={`${item.title} — multi-day, spans ${formatDateLong(spanStart)} to ${formatDateLong(spanEnd)}`}
                      className="empty-frame flex items-center gap-2 px-3 py-2"
                    >
                      <span className={colors.text} aria-hidden="true">{CATEGORY_ICON_MAP[item.category]}</span>
                      <span className="truncate text-t-body font-medium text-ink-hi">{item.title}</span>
                      <span className="pr pr--lo ml-auto shrink-0" aria-hidden="true">
                        {isStartDay ? `Until ${formatDate(spanEnd)}` : `${formatDate(spanStart)} – ${formatDate(spanEnd)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Items */}
            <DndContext
              sensors={sensors}
              accessibility={{ announcements }}
              collisionDetection={closestItem}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <DroppableDay dateStr={selectedDate}>
                <SortableContext items={allItemIds} strategy={verticalListSortingStrategy}>
                  <div className="list" ref={listRef}>
                    {visibleItems.length === 0 ? (
                      /* Hollow slots plus the condition in words. Both strings are asserted by
                         e2e/author-filter-propagation.spec.ts. */
                      <div data-testid="calendar-empty-state">
                        <div aria-hidden="true">
                          {['Morning', 'Afternoon', 'Evening'].map((slot) => (
                            <div key={slot} className="r" data-mark="hollow">
                              <span className="tm text-ink-lo">{slot.slice(0, 3).toLowerCase()}</span>
                              <span className="min-w-0">
                                <span className="empty-frame block h-4 w-full max-w-[16rem]" />
                                <span className="mt">nothing struck in yet</span>
                              </span>
                              <span className="hollow-tag">open</span>
                            </div>
                          ))}
                        </div>
                        {/* Unfiltered: tells "nothing planned" from "nothing matches". */}
                        {dayItems.length === 0 ? (
                          <p className="empty px-gut py-4">
                            No activities planned for this day. The day is open from morning to
                            night — quick-add a plan above, or open Details for anything one line
                            cannot say.
                          </p>
                        ) : (
                          /* Day HAS items, but none match the active author filter (read-only
                             view filter,) — the stored items are untouched. */
                          <p className="empty px-gut py-4">
                            No activities match this filter. The day still holds {dayItems.length}{' '}
                            {dayItems.length === 1 ? 'item' : 'items'} — switch the author filter to
                            “All” to see every item.
                          </p>
                        )}
                      </div>
                    ) : (
                      phaseGroups.map(({ item, phase, isNewPhase }, idx) => {
                        const markerId = markerIdFor(item);
                        // The explicit unplanned rule above this row. A FACT about the pair, not a
                        // spacer — see `unplannedGapsByItemId`.
                        const gapMin = dayGaps.get(item.id) ?? null;
                        return (
                        <div key={item.id}>
                          {/* Phase header; never repeats on a date-line day (lib/phase-of-day.ts). */}
                          {isNewPhase && (
                            <p
                              data-testid={`calendar-phase-header-${phase}-${item.id}`}
                              className={`pr pr--lo border-b-hair border-[color:hsl(var(--border))] px-gut pb-1 ${idx === 0 ? '' : 'mt-4'}`}
                            >
                              {PHASE_LABELS[phase]}
                            </p>
                          )}
                          {gapMin !== null && (
                            <div className="gap" data-testid={`calendar-gap-${item.id}`}>
                              <span>{formatDurationText(gapMin)} unplanned</span>
                            </div>
                          )}
                          <SortableItem
                            item={item}
                            date={selectedDate}
                            /* Timed rows sort by time, so only "Anytime" rows can be dragged. */
                            dragDisabled={phase !== 'anytime'}
                            clashes={dayClashIds.has(item.id)}
                            sunsetMin={daySun?.sunsetMin}
                            selectMode={selectMode}
                            selected={selectedIds.has(item.id)}
                            highlighted={item.id === highlightId || (showMap && markerId != null && markerId === highlightId)}
                            mapVisible={showMap}
                            hasMarker={markerId != null}
                            onToggleSelect={() => toggleSelect(item.id)}
                            onEdit={() => handleEditItem(item)}
                            onDelete={() => handleDeleteItem(item)}
                            onDuplicate={(targetDate) => handleDuplicateItem(item, targetDate)}
                            onLocate={() => setHighlightId((cur) => (cur === markerId ? null : markerId))}
                          />
                          <ConflictNotice itemId={item.id} title={item.title} onRestore={restoreConflict} onDismiss={dismissConflict} />
                        </div>
                        );
                      })
                    )}
                  </div>
                </SortableContext>
              </DroppableDay>

              {/* dnd-kit's drop animation is WAAPI, which the CSS reduce block cannot reach (#782). */}
              <DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>
                {activeItem ? (
                  <div className="drag-overlay border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface-overlay))] p-3">
                    <div className="flex items-center gap-2">
                      <span className={CATEGORY_COLORS[activeItem.category]?.text ?? 'text-ink-hi'}>
                        {CATEGORY_ICON_MAP[activeItem.category]}
                      </span>
                      <span className="text-t-body font-semibold text-ink-hi">{activeItem.title}</span>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

          </div>

          {/* desktop inline map pane (lg+). Sticky + tall; stacks under the day
              detail at lg, sits beside it at xl. Mobile (`<lg`) uses the sheet below. */}
          {showMap && isDesktop && (
            <aside
              aria-label={`Map of stops for ${formatDateLong(selectedDate)}`}
              className="hidden lg:block sticky top-[calc(6rem+var(--safe-top))] h-[480px] xl:h-[560px] overflow-hidden border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]"
            >
              {mapEl}
            </aside>
          )}
          </div>
        </div>
      </div>

      <details className="group mx-auto mt-6 max-w-[1200px]" data-testid="plan-overview">
        <summary className="chip min-h-tap cursor-pointer list-none px-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          Trip overview
        </summary>
        <div className="mt-4">
          <PlanDensity meta={dayStripMeta} selectedDate={selectedDate} />
        </div>
      </details>

      {/* Mobile map sheet, non-modal. Tab-bar clearance is padding, not a bottom offset, so
          the expanded sheet can't be pushed off the top and the map attribution (a licence
          condition) stays visible. */}
      {showMap && !isDesktop && (
        <div
          data-testid="plan-map-sheet"
          data-expanded={mapExpanded ? 'true' : 'false'}
          className={`lg:hidden fixed inset-x-0 bottom-0 z-40 flex flex-col bg-[rgb(var(--surface-low))] border-t-2 border-[color:hsl(var(--border))] pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))] transition-[height] duration-300 motion-reduce:transition-none md:pb-0 ${mapExpanded ? 'h-[85dvh]' : 'h-[42dvh]'}`}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b-hair border-[color:hsl(var(--border))] shrink-0">
            <span className="pr flex items-center gap-1.5 text-ink-hi">
              <MapIcon className="w-3.5 h-3.5" />
              Map · {formatDate(selectedDate)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMapExpanded((v) => !v)}
                aria-expanded={mapExpanded}
                aria-label={mapExpanded ? 'Collapse map' : 'Expand map'}
                data-testid="plan-map-sheet-expand"
                className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg hover:bg-white/10 text-ink-mid hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${mapExpanded ? '' : 'rotate-180'}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowMap(false)}
                aria-label="Hide map"
                data-testid="plan-map-sheet-close"
                className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg hover:bg-white/10 text-ink-mid hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative flex-1 min-h-0">{mapEl}</div>
        </div>
      )}

      {/* Item editor. Focus returns on onExitComplete, after the exit animation. */}
      <AnimatePresence
        onExitComplete={() => {
          triggerRef.current?.focus?.();
          triggerRef.current = null;
        }}
      >
        {showEditor && (
          <ItemEditor
            item={editingItem}
            startDate={selectedDate}
            // D-316: `dayItems` is the UNFILTERED stored day, deliberately — a collision
            // with a row the author filter is hiding is still a collision.
            dayItems={dayItems}
            onSave={handleSaveItem}
            onClose={() => { setShowEditor(false); setEditingItem(undefined); setPickingPin(false); setPickedPin(null); }}
            hidden={pickingPin}
            pickedPin={pickedPin}
            onRequestPin={handleRequestPin}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
