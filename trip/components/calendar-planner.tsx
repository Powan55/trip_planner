'use client';

import { useState, useEffect, useRef, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { m, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { SectionHeading } from '@/components/section-heading';
import {
  Calendar, Plus, Trash2,
  MapPin, X, Check, ChevronLeft, ChevronRight, ChevronDown,
  ExternalLink, Map as MapIcon, MoreHorizontal,
} from 'lucide-react';
import { DndContext, closestCenter, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  TRIP_DATES, getCountryForDate, formatDate, formatDateLong,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS, DayPlan,
} from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { buildItineraryStops, stopMarkerFor } from '@/lib/itinerary-map';
import { showUndoToast } from '@/lib/undo-toast';
import { bulkMoveWithUndo } from '@/lib/bulk-move-undo';
import { getTodayInTrip } from '@/lib/trip-now';
import { setSelectedDay } from '@/lib/selected-day';
import DayStrip, { DayStripDateMeta } from '@/components/day-strip';
import { SortableItem, DroppableDay } from '@/components/calendar-sortable-item';
import { CATEGORY_ICON_MAP } from '@/components/category-icon';
import { ALL_CATEGORIES } from '@/lib/itinerary-category';
import { CalendarBulkToolbar } from '@/components/calendar-bulk-toolbar';
import { CalendarDayPicker } from '@/components/calendar-day-picker';
import { useCalendarDnd } from '@/hooks/use-calendar-dnd';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';
import { useItineraryContext } from '@/components/itinerary-provider';
import { freshCopyOf } from '@/hooks/use-itinerary';
import QuickAddInput from '@/components/quick-add-input';
import MapIslandBoundary from '@/components/map-island-boundary';
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
import { effectiveStartMinutes, offsetForCountry } from '@/core/dates';
import { unplannedGapMinutes } from '@/lib/unplanned-gap';
import { minutesToHHMM, formatDurationText } from '@/lib/time-picker-format';
import { extractQuickAddTime } from '@/lib/quick-add-parse';
import { describeItemTime } from '@/lib/item-time-display';
import { dayPlaceLabel, legLabel } from '@/lib/leg-label';
import { clashingItemIds, describeClash, firstClashWith, timeFootprintChanged } from '@/lib/sort-items-by-time';
import TimePicker, { DurationField } from '@/components/time-picker';
import PlanSearch from '@/components/plan-search';
import type { PlanSearchResult } from '@/lib/search-plan';
import { getCachedForecastForDate, weatherTagForDay, type WeatherTag } from '@/lib/weather';
import { haptic } from '@/lib/haptics';
import { groupItemsByPhase, earliestTimedItem, PHASE_LABELS } from '@/lib/phase-of-day';

// split-view map pane, mounted as a dynamic(ssr:false) island gated on the
// map-view toggle below. Because it is NOT in the initial render tree (showMap is
// off by default), its chunk — and the ~200 kB maplibre runtime it pulls via
// trip-map's own `await import('maplibre-gl')` — only fetches when the user opens
// the map. /plan First Load JS stays 106 kB (maplibre never in the shared
// bundle). Sized loading skeleton fills the pane while the chunk streams in.
const PlanDayMap = dynamic(() => import('@/components/plan-day-map'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface text-ink-mid">
      <span className="text-xs">Loading map…</span>
    </div>
  ),
});

/**
 * `href` with only the `focus` query param removed, as a SAME-ORIGIN-RELATIVE url.
 *
 * Returned for `history.replaceState`, never for `router.replace`/`push`: the returned path
 * carries the deployed basePath (it comes out of `window.location`), and the App Router prepends
 * basePath itself — feeding one to the other is what doubled `/trip_planner/` and 404'd the
 * planner. Every other param (`?today=`, …) survives, unlike a bare `location.pathname`.
 */
export function stripFocusParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('focus');
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * `.dens` — plan density across the whole trip: one column per trip day, height in
 * proportion to the real item count, screened by leg at the 14% tint ceiling with a
 * full-strength 1px border carrying the identity at no contrast cost.
 *
 * An EMPTY day is drawn hollow at the height it will occupy, not short — that is the empty state
 * rendered at full size rather than said in a sentence. A THIN day (at most half the mean) takes
 * the 45° hatch. Only every 4th day is labelled; 32 labels collide.
 *
 * Read-only: it reports the same per-day counts the day strip and the month grid read, so it can
 * never disagree with them. It is a single `role="img"` with the whole reading in its label, so
 * nothing here is available only to sighted users.
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
              className={`b${m.date === selectedDate ? ' outline outline-2 outline-offset-[-2px] outline-[color:var(--accent)]' : ''}`}
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
  // Time picker state. The trigger shows `effectiveStartMinutes` —
  // fallback parser, so opening the picker on a legacy-`time`-only item pre-positions it
  // correctly — but the SAVE only dual-writes when the user actually touched the picker
  // (`timeTouched`); an untouched item's original `time`/`startMinutes` are preserved
  // byte-for-byte, so an unparseable legacy `time` string is never silently clobbered by
  // an edit that never touched the time field.
  const [startMinutes, setStartMinutes] = useState<number | undefined>(() => (item ? effectiveStartMinutes(item) : undefined));
  const [timeTouched, setTimeTouched] = useState(false);
  const [durationMinutes, setDurationMinutesState] = useState<number | undefined>(item?.durationMinutes);
  const [durationTouched, setDurationTouched] = useState(false);
  const [location, setLocation] = useState(item?.location ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');

  // Manual pin-drop. The pin is now a single lat/lng PAIR chosen on
  // the map, never two typed decimals: free-text fields could hold a half-entered or
  // out-of-range pin, which is why they needed range validation, an inline error and a
  // save-disable. Picking a coordinate off the map makes all three states unrepresentable —
  // a pin is either absent or a complete, in-range pair, because it came from a real
  // projection. `null` = no pin.
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    item?.lat !== undefined && item?.lng !== undefined ? { lat: item.lat, lng: item.lng } : null,
  );
  // A coordinate handed back by the map picker (a fresh object per pick, so re-picking the
  // same spot still lands). The parent owns the picker because the map pane it drives lives
  // out there — see `pickingPin` in CalendarPlanner.
  useEffect(() => {
    if (pickedPin) setPin({ lat: pickedPin.lat, lng: pickedPin.lng });
  }, [pickedPin]);

  // Multi-day span. Opt-in toggle → a native <select> of trip days strictly AFTER the
  // item's start day (`startDate` = the day this editor operates on). Reuses the duplicate-
  // picker idiom (native select / TRIP_DATES — SR/keyboard-friendly, no new dep). The item stays
  // OWNED by its start day; only the render layer expands the band across the covered days (the
  // MERGE INVARIANT — no multi-homing). Section starts open only when the item already spans
  // If the start day is the last trip day there is no valid
  // end day → the toggle is disabled.
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

  // Portal mount guard ( / mirrored from add-to-itinerary-dialog.tsx /
  //). `createPortal(…, document.body)` must not run during the static-export
  // prerender, so we only portal after the component has mounted on the client. The
  // editor only ever mounts on a user click (post-hydration), so this is satisfied
  // immediately in practice; it exists purely to keep `document` untouched on the
  // server and to keep tsc/SSR honest.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Locks page scroll behind the modal (`body[data-dialog-open]`, globals.css), the half of
  // the modal contract this editor never opted into. Ref-counted, so the nested time picker
  // opening and closing can't clear it. Released while `hidden`: the pin picker hands the
  // screen to the map pane, a non-modal surface the page is meant to scroll behind — and on
  // `lg+` the map is a sticky aside the user may still have to scroll into view.
  useDialogOpenFlag(!hidden);

  // present as a slide-up bottom-sheet on `<lg` (the place-detail-sheet idiom) and
  // as the existing centered panel on `lg+`. The layout is Tailwind-responsive (classes
  // below), but framer's entrance variant can't be a media query — so we read the `lg`
  // breakpoint once and pick translate-y (sheet) vs scale (desktop panel). Only runs
  // post-mount (the portal itself is mount-guarded), so there is no SSR/hydration read.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Google Maps research link-out.
  // Reuses the shared, already-exported builder — no reimplementation of the URL
  // scheme. Recomputed live off the editor's own title/location state; null (and
  // therefore disabled) until the title is non-empty.
  // coordinate-first once the item carries a pin (the same value Save would persist) —
  // falls back to the existing title+location text search otherwise, byte-identical to
  // pre- behavior.: the pin is now a single nullable pair, so the former
  // `pinComplete` half-pin guard has nothing left to guard.
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

  // Refs for focus management: the panel (focus-trap boundary) and the first
  // field (focused on open). Returning focus to the trigger is the parent's job
  // via AnimatePresence onExitComplete — doing it here in an effect cleanup
  // raced framer-motion's exit animation and grabbed the wrong element.
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

  const handleSave = () => {
    if (!title.trim()) return;
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

    // D-316 — hard refuse, DELTA-SCOPED. Only a write that moves the item's time footprint
    // is guarded, so an already-overlapping item can still have its title, notes or category
    // edited. That is no longer about the seed: D-327 un-nested the last three containments,
    // and the seed is clean. What still arrives overlapping is a synced peer's write, a vault
    // import, or a day saved by an older build. A brand-new item has no previous footprint and
    // is therefore always guarded. There is no "Save anyway": the escape hatch is to clear the
    // duration, which the message names.
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

  // Esc closes the dialog, handled at the document level so it fires wherever
  // focus sits (even if the panel never holds it). onClose only flips parent
  // state; the parent returns focus once the exit animation completes.
  // while the picker is armed this editor is off-screen and Escape belongs to the
  // pick bar (it cancels the pick and brings the editor back) — closing the whole editor
  // there would throw away everything the user typed before going to the map.
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
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

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

  // Don't render the overlay during the prerender / before the client mounts — the
  // portal target (`document.body`) doesn't exist on the server. Returning null here
  // is safe for the parent `AnimatePresence`: this only short-circuits for the single
  // synchronous render before `useEffect` flips `mounted`, which never coincides with
  // a user-driven open in the static-export client.
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
      onClick={onClose}
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
        className="w-full lg:max-w-md bg-[rgb(var(--surface-low))] border-t-2 lg:border-hair border-[color:var(--border-ui)] rounded-t-r3 lg:rounded-r2 p-5 sm:p-6 max-h-[90vh] overflow-y-auto overscroll-contain scrollbar-hide"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 id={titleId} className="pr pr--l text-ink-hi">{item ? 'Edit item' : 'Add item'}</h3>
          <button type="button" onClick={onClose} aria-label="Close editor" data-testid="calendar-editor-cancel" className="inline-flex items-center justify-center min-h-tap min-w-tap rounded-r1 hover:bg-white/5 hover:text-ink-hi text-ink-mid outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor={titleFieldId} className="pr pr--lo mb-1 block">Title *</label>
            <input id={titleFieldId} ref={titleInputRef} autoFocus value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} data-testid="calendar-editor-title-input" className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="e.g., Visit Boudhanath Stupa" />
          </div>
          <div>
            <span id={categoryLabelId} className="pr pr--lo mb-1 block">Category</span>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2" role="group" aria-labelledby={categoryLabelId}>
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
                    className={`flex flex-col items-center justify-start gap-1 min-h-[3rem] px-1 py-2 rounded-r1 border-hair transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      isActive ? `${colors.text} border-current bg-white/5` : 'border-transparent text-ink-lo hover:bg-white/5 hover:text-ink-hi'
                    }`}
                  >
                    {CATEGORY_ICON_MAP[cat]}
                    <span className="pr pr--lo capitalize leading-tight text-center break-words w-full text-current">{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label htmlFor={timeFieldId} className="pr pr--lo mb-1 block">Time</label>
            <TimePicker id={timeFieldId} value={startMinutes} onChange={handleTimeChange} testId="calendar-editor-time-input" />
          </div>
          {/* — the editor opens as THREE fields (Title, Category, Time). Everything else
              lives behind this one disclosure. Native <details>/<summary>: no state, no new dep,
              keyboard-operable and screen-reader-announced for free (the default marker is
              hidden and replaced by the chevron). It starts CLOSED even on a populated item, so
              the summary names which of these fields actually hold something (: the label
              carries the meaning, not a colour) — nothing is hidden without saying so.
              The enclosed fields keep their original indentation: this change only WRAPS them,
              and an unindented diff is what makes that reviewable. */}
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
            <input id={locationFieldId} value={location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)} data-testid="calendar-editor-location-input" className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="e.g., Thamel, Kathmandu" />
          </div>
          {/* Pin an exact location. Typing two decimals was
              the only way to place a pin and nobody knows their coordinates — so the fields
              are gone and the pin comes off the map instead. "Drop a pin" arms the picker on
              the map pane that ALREADY exists on this route (desktop aside / mobile sheet),
              so maplibre stays behind its interaction-lazy boundary and there is no
              second map surface. The chosen pair is echoed here as text (and on
              `data-lat`/`data-lng`) so the value is legible without a map, and readable by a
              screen reader — the picked coordinate is never write-only. */}
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
          {/* Multi-day span — opt-in, collapsed unless the item already spans. A "spans
              multiple days" toggle reveals a native <select> of trip days AFTER the start day.
              The item stays owned by its start day (no multi-homing); only the render layer
              expands a band across the covered days. Disabled if the start day is the last day. */}
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
          {/* D-316 — the refusal. A BLOCKED user action, so `role="alert"` (assertive),
              not `role="status"`: the pattern backup-restore.tsx/photo-attach.tsx already
              use. Always mounted with a reserved height so the panel never jumps and the
              live region exists before it has anything to say. Focus is deliberately NOT
              moved — it is already on the save button the user just pressed. */}
          <p
            role="alert"
            data-testid="calendar-editor-clash-error"
            className="err mb-3 min-h-[1rem] text-t-sm"
          >
            {clashError}
          </p>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            data-testid="calendar-editor-save"
            className="btn w-full px-4 focus-visible:outline-none"
          >
            <Check className="w-4 h-4" />
            {item ? 'Update item' : 'Add item'}
          </button>
        </div>
      </m.div>
    </m.div>,
    document.body,
  );
}

export default function CalendarPlanner() {
  // search-within-plan: cross-route focus channel. `?focus=<itemId>` (pushed by
  // the command palette's "In your plan" results, which live OUTSIDE the provider and
  // so cannot share `highlightId` state directly) is read reactively via
  // `useSearchParams` — unlike the module-cached `?today=` override in trip-now.ts,
  // this one must react to an in-place navigation (already on /plan, palette pushes a
  // new `?focus=`) without a remount, which only the router-bound hook delivers.
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
  // The marker id currently emphasized on the map + ringed in the list — the single
  // shared highlight state that both directions write (row "show on map" ↔ marker click).
  // generalizes what a row match means: `highlightId` also accepts a plain ITEM id
  // (a search result), matched independently of `showMap`/marker-join in the row's
  // `highlighted` computation below — same state, same clear-on-day-change effect, same
  // scroll-into-view effect, no second highlight mechanism.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // when a search result lands on a DIFFERENT day than `selectedDate`, we must
  // set the date first and apply the highlight only once that settles — otherwise the
  // existing clear-highlight effect (below, keyed on `selectedDate`) wipes it out in the
  // same commit (the ordering trap). Consumed by the effect right after that one.
  const pendingFocusRef = useRef<{ date: string; id: string } | null>(null);
  // Mobile bottom-sheet peek ⇄ expanded. `isDesktop` picks the inline split pane
  // (lg+) vs the bottom-sheet (`<lg`) — one <PlanDayMap> instance, placed responsively.
  // Eager init is safe: CalendarPlanner is a dynamic(ssr:false) island (client-only).
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [mapExpanded, setMapExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // pin-pick. The editor asks for a coordinate; the MAP PANE (which lives out here,
  // not in the portal) collects it. While `pickingPin` the editor is visually hidden but
  // still mounted, so the trip to the map costs nothing the user has typed. `pickedPin` is
  // a fresh object per pick so re-picking the identical spot still reaches the editor.
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
   * 🔴 (INTAKE-07) — THE ONE PLACE THE FILTER IS APPLIED.
   *
   * Reported: *"when i click on the filter by name all everything thats not related to that person
   * should dessipear from the calander"*. Before this, exactly one consumer (the day list)
   * filtered, and every other piece of calendar chrome read the day straight off the store — so
   * "Sushil" showed 2 rows under a pill that said "7 items", a month grid with 7 dots, and a map
   * plotting all 7.
   *
   * The fix is ONE filtered accessor, not seven guards. Every calendar surface already derives its
   * data from `getDayPlan(date)` — the month grid, the agenda list, the mobile day strip, the day
   * header, the split-view map. Handing those consumers this wrapper fixes all of them at once and,
   * more importantly, makes the FUTURE consumer filtered by default. A per-call-site guard would
   * leave the next one broken.
   *
   * 🔴 WHY THE `'all'` BRANCH RETURNS `getDayPlan` ITSELF, not a wrapper that filters to
   * everything: with no filter selected the chrome must be BYTE-IDENTICAL to before. Returning the
   * same function means the no-filter path is not "a filtered path that happens to match" — it is
   * literally the original call, same object references, same memo identities, same render output.
   * That is a structural guarantee rather than an assertion (and `e2e/author-filter-propagation`
   * measures it anyway).
   *
   * 🔴 WHAT MUST NOT ROUTE THROUGH THIS — anything DESTRUCTIVE or anything that has to know the
   * day's real contents:
   * · `useCalendarDnd` (below) keeps the raw `getDayPlan` — reordering persists against the full
   * stored array.
   * · `handleClearDay` / `handleBulkDelete` read the raw store — "Clear day" must remove the
   * items you cannot currently see, and its confirm copy must count them.
   * · The empty-state branch keeps reading `dayItems` — that unfiltered count is the ONLY thing
   * that distinguishes "no activities match this filter" from "no activities planned".
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

  // cost overlay — READ-ONLY / DISPLAY-ONLY. A SEPARATE reactive read of the
  // expense store (NOT the itinerary store): the calendar's CRUD/DnD/select all still operate on
  // `plans` from `useItineraryContext()`, entirely untouched. This adds a per-day leg-local spend
  // figure to the single-day header and a subtle "has spend" marker on month-grid cells. The pure
  // `expensesByDate` buckets logged expenses by their 'YYYY-MM-DD', excluding undated rows (matching
  // the burn-rate view) AND rows whose `leg` is not the leg that owns that date — the day header and
  // the grid cells format the bucket with the DAY's currency, so a cross-leg row would be mis-priced.
  // It still counts in the leg total, the trip total and settle-up. Nothing here writes; it only
  // decorates existing cells.
  const { expenses } = useExpenses();
  const spendByDate = useMemo(() => expensesByDate(expenses), [expenses]);

  // The element focused when the editor opened (the "Add Activity" / edit
  // button), captured before the modal autofocuses, so focus returns to it once
  // the exit animation completes. See AnimatePresence onExitComplete below.
  const triggerRef = useRef<HTMLElement | null>(null);

  // drag-and-drop wiring (sensors, active-drag id, reorder / move-between-days
  // handlers) lives in a co-located hook now — same logic, lifted out to shrink this file.
  const { sensors, activeItem, handleDragStart, handleDragOver, handleDragEnd } = useCalendarDnd({
    plans,
    getDayPlan,
    moveItem,
    reorderItems,
  });

  // Load/save effects and the local getDayPlan/updateDayPlan are gone — the store
  // owns load-on-mount, the savePlans-on-write + CustomEvent fan-out, and
  // the existing-or-synthesized getDayPlan. The calendar is now a pure consumer.

  // Travel-mode default: jump the initial selection to today when we are
  // inside the trip window. Run ONCE post-mount ([] deps) — NOT during the initial
  // render — so the SSR/first-client paint keeps the SSR-safe TRIP_DATES[0] default and
  // there is no hydration mismatch. Only overrides the untouched initial selection;
  // any later user selection is unaffected because this never re-runs.
  useEffect(() => {
    const t = getTodayInTrip();
    if (t) setSelectedDate(t.date);
  }, []);

  // Seam 3: mirror the focused day into the in-memory selected-day signal so
  // the quick-add FAB presets its date to whatever day the calendar shows. Covers every
  // selection path uniformly — day-strip taps, month-grid clicks, agenda-list clicks,
  // prev/next, and the today-init above — since all of them flow through
  // `selectedDate`. In-memory only: setSelectedDay never touches storage.
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

  // composer add: peel a leading/trailing time token off the typed text (the pinned
  // `parseTimeString` is anchored and stays that way —), then write the SAME structured
  // pair the editor writes, so a
  // composer-created item and an editor-created one are byte-identical on disk. No time in the
  // text → an untimed item, exactly as before. Same addItem → commit() choke-point.
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
      updateItem(selectedDate, item.id, item);
    } else {
      addItem(selectedDate, item);
    }
    setShowEditor(false);
    setEditingItem(undefined);
    haptic(); // — subtle pulse on itinerary item save (gated internally on reduced-motion).
  };

  // duplicate: a fresh-id copy of the item's CONTENT onto the chosen day, through the
  // SAME addItem → commit() choke-point as every other add. `freshCopyOf` (the
  // stripper, reused verbatim — not re-implemented) drops id/deleted/rev/hlc and mints a new
  // id, so the copy NEVER reuses the source id; addItem then stamps attribution/rev/hlc.
  const handleDuplicateItem = (item: ItineraryItem, targetDate: string) => {
    const copy = freshCopyOf(item);
    // D-316: `freshCopyOf` carries time + duration verbatim, so duplicating onto the SAME
    // day (the picker offers every trip day, including this one) is a guaranteed exact
    // collision. The check runs on the COPY, whose id is already fresh — checking the
    // source item would self-exclude against itself and wave the collision through.
    const clash = firstClashWith(
      copy,
      getDayPlan(targetDate).items ?? [],
      targetDate,
      offsetForCountry(getCountryForDate(targetDate)),
    );
    if (clash) {
      toast.error(`Can’t copy to ${formatDate(targetDate)} — overlaps ${describeClash(clash)}.`);
      return;
    }
    addItem(targetDate, copy);
  };

  const handleDeleteItem = (item: ItineraryItem) => {
    // Capture the full item in the closure BEFORE removing, so Undo can restore it.
    // removeItem is unchanged (tombstone under sync, physical under dormant); restoreItem
    // mirrors it (fresh-id under sync, same-id under dormant).
    const day = selectedDate;
    removeItem(day, item.id);
    showUndoToast(`Deleted “${item.title}”`, () => restoreItem(day, item));
  };

  // clear-whole-day: capture the day's LIVE items BEFORE clearing (so Undo can restore the
  // full list), clearDay (tombstone-all in one commit under sync / physical empty under dormant),
  // then one undo toast whose action restores every captured item (fresh-id under sync). After
  // the clear the day falls back to the existing empty-state design.
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

  // consume a pending cross-day search focus. Declared right AFTER the
  // clear-highlight effect above (same [selectedDate] dependency) so, within the same
  // commit, the clear runs first and this one runs second — the later `setHighlightId`
  // call wins. Only fires once `selectedDate` has actually settled onto the pending
  // result's day; same-day selections never touch this ref (handled directly by
  // `focusItem` below) and so this effect no-ops for them.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending && pending.date === selectedDate) {
      setHighlightId(pending.id);
      pendingFocusRef.current = null;
    }
  }, [selectedDate]);

  // jump to an item's day + highlight it (shared by both the `/plan` search and
  // the `?focus=` param consumed below). Same-day: highlight immediately — the
  // clear-on-day-change effect above never fires because `selectedDate` doesn't change.
  // Cross-day: stash the target in the pending ref and change the day; the effect above
  // applies the highlight once that settles (the ordering trap, handled once, here).
  const focusItem = (date: string, id: string) => {
    if (date === selectedDate) {
      setHighlightId(id);
    } else {
      pendingFocusRef.current = { date, id };
      setSelectedDate(date);
    }
  };

  const handleSearchSelect = (result: PlanSearchResult) => focusItem(result.date, result.item.id);

  // consume `?focus=<itemId>` — the palette's cross-route hand-off (the palette is
  // mounted outside ItineraryProvider and cannot call `focusItem` directly). Keyed on the
  // reactive `searchParams` value (not a mount-only effect) so it fires both when
  // navigating to /plan fresh AND when already on /plan and the palette pushes a new
  // focus id. The param is stripped via history-replace (no new history entry, mirrors
  // command-palette.tsx's own `history.replaceState` hash bookkeeping) so a manual
  // reload doesn't re-highlight, without breaking the back button.
  //
  // The strip MUST NOT go through `router.replace`: `window.location.pathname` already carries
  // the basePath and the App Router prepends it again, so on the deployed `/trip_planner/` build
  // this navigated to `/trip_planner/trip_planner/plan/` and 404'd (empty basePath locally, which
  // is why dev and e2e never saw it). Same-document `history.replaceState` is the fix
  // `travel-date-picker.tsx` already made for this class; Next syncs it into `useSearchParams`,
  // and only `focus` is deleted so `?today=` and friends survive.
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

  // Bulk move the current selection to another day. Every selected id lives on selectedDate, so
  // the move is (selection, selectedDate) → targetDate. moveItems is ONE commit (tombstone-source
  // + fresh-id-target under sync; physical under dormant). Same-day is guarded out.
  //
  // the Undo its two destructive siblings already had. `bulkMoveWithUndo` owns the closure
  // capture + the toast because the inverse MUST address the LANDED ids, not the selected ones —
  // see the docblock there; that construction is what `use-itinerary-bulk-sync.test.ts` drives.
  const handleBulkMove = (targetDate: string) => {
    if (!targetDate || targetDate === selectedDate || selectedIds.size === 0) return;
    // D-316 — ALL-OR-NOTHING. Refuse the whole move if any selected item would collide on
    // the target day, naming the first offender. Partial application would break
    // `moveItems`' single-commit semantics and leave `bulkMoveWithUndo`'s inverse
    // addressing ids that never landed. The selection is only ever checked against the
    // TARGET day's existing items, never against each other: they already coexist on the
    // source day, so a grandfathered pair must still be movable as a pair.
    const moving = (getDayPlan(selectedDate).items ?? []).filter((i) => selectedIds.has(i.id));
    const targetItems = getDayPlan(targetDate).items ?? [];
    const targetOffset = offsetForCountry(getCountryForDate(targetDate));
    for (const moved of moving) {
      const clash = firstClashWith(moved, targetItems, targetDate, targetOffset);
      if (clash) {
        toast.error(
          `Can’t move ${moving.length} item${moving.length === 1 ? '' : 's'} to ${formatDate(targetDate)} — “${moved.title}” overlaps ${describeClash(clash)}.`,
        );
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
        toast.error(
          `Can’t copy this day to ${formatDate(targetDate)} — “${source.title}” overlaps ${describeClash(clash)}.`,
        );
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

  // an optional, read-only contextual weather tag for the day header — pure derivation
  // over the SAME Open-Meteo cache the Essentials/Today panels already fetch,
  // zero new fetch. Read in an effect (not inline) so server/first-paint render matches the
  // client before hydration (the gateway is SSR-safe and returns null, but we still avoid
  // reading it during render to keep this consistent with the rest of the app's localStorage
  // reads). `null` whenever the city/date isn't in whatever 7-day window was last cached.
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
  // The presentational view: narrowed by the active author filter (read-only). DnD reorder
  // still reads the full set from the store in handleDragEnd, so persistence is unaffected;
  // we only change what renders and which ids the SortableContext tracks (so a drag inside
  // a filtered view stays consistent with what's visible).
  const visibleItems = visiblePlan.items ?? [];
  // phase-of-day grouping: NEVER re-sorts
  // timed items — the calendar view's manual/stored order stays untouched (sort-clash.spec.ts's
  // regression net) — only moves untimed items to a trailing "Anytime" run. `isNewPhase` marks
  // where the render layer inserts a subtle phase header. SortableContext's `items` below is
  // this GROUPED order so dnd-kit's index math matches the actual DOM order.
  const phaseGroups = useMemo(() => groupItemsByPhase(visibleItems), [visibleItems]);
  const allItemIds = phaseGroups.map((g) => g.item.id);
  // FILLED means committed: an item that carries a real start time is STRUCK, an untimed one is
  // still an idea and is drawn HOLLOW. The running head prints both counts.
  const struckCount = useMemo(
    () => visibleItems.filter((i) => effectiveStartMinutes(i) !== undefined).length,
    [visibleItems],
  );
  // day-at-a-glance pill row: item count + first-start time (composed alongside the
  // existing spend/weather pills at the day header, below).
  // derived from the VISIBLE set. "From 9:00 AM" pointing at an item the filter has hidden
  // is exactly the reported disagreement. (Spend and weather stay day-level — money and
  // weather are facts about the day, not about a person, so they are deliberately NOT filtered.)
  const firstTimedItem = useMemo(() => earliestTimedItem(visibleItems), [visibleItems]);
  const firstStartInfo = firstTimedItem ? describeItemTime(firstTimedItem, selectedDate) : null;
  // warn-only clash badge, presentation-only — it never touches the manual
  // drag-order (`handleDragEnd`/`arrayMove`/`SortableContext` are all untouched below).
  // computed over the VISIBLE set. A badge warning about a collision with an item that is
  // not on screen is unreadable; clash detection is order-independent so this is a pure narrowing.
  // The overlap is judged on the absolute instant, so the day and its offset
  // come along — a day can hold items in another zone.
  const dayClashIds = useMemo(
    () => clashingItemIds(visibleItems, selectedDate, offsetForCountry(getCountryForDate(selectedDate))),
    [visibleItems, selectedDate],
  );

  // multi-day spans — a PURE view-layer render derivation off the existing `plans` (no
  // store write, no multi-homing;). For the selected day, collect every spanning item
  // (an item carrying an `endDate` genuinely after its start day) whose inclusive
  // [startDay..endDate] window COVERS `selectedDate`. ISO `YYYY-MM-DD` strings compare
  // lexicographically, so the date math is plain string comparison. `isStartDay` marks the day
  // that actually OWNS the item (it also appears as an editable row in the list below); on every
  // other covered day the item shows ONLY as this band — it is never re-inserted into a list.
  const spanBands = useMemo(() => {
    const bands: { item: ItineraryItem; spanStart: string; spanEnd: string; isStartDay: boolean }[] = [];
    for (const plan of plans) {
      for (const item of plan.items ?? []) {
        if (!item.endDate || item.endDate <= plan.date) continue; // genuine forward span only
        // bands iterate `plans` directly rather than going through `getVisibleDayPlan`,
        // because a band's OWNING day is not the selected day — so it is the one calendar surface
        // that cannot reuse the shared accessor and needs the predicate itself. `itemMatchesAuthor`
        // is the same predicate `filterItemsByAuthor` applies, so the two cannot drift.
        if (!itemMatchesAuthor(item, authorFilter, myName, myPriorNames)) continue;
        if (plan.date <= selectedDate && selectedDate <= item.endDate) {
          bands.push({ item, spanStart: plan.date, spanEnd: item.endDate, isStartDay: plan.date === selectedDate });
        }
      }
    }
    return bands;
  }, [plans, selectedDate, authorFilter, myName]);

  // day-scoped map data: the selected day's coordinate stops (marker-matched),
  // re-derived from the live plan so a reorder yields a new ordered array → PlanDayMap
  // re-passes it → TripMap redraws the polyline.
  // built from the VISIBLE plan, so the split-view day map plots only the filtered person's
  // stops. `buildItineraryStops` takes DayPlan[] and is UNCHANGED — `lib/itinerary-map.ts` is held
  // by another lane; narrowing the plan we hand it needs no edit there.
  const dayStops = useMemo(() => buildItineraryStops([visiblePlan]), [visiblePlan]);
  // Per-item matched marker id — the same stopMarkerFor join buildItineraryStops uses (pin
  // BEATS name/sourceId match,), so a row and its map stop always agree. Drives the
  // row ring + the "show on map" affordance.
  const markerIdFor = (item: ItineraryItem) =>
    stopMarkerFor(item, legLabel(currentPlan.country))?.id ?? null;

  // Per-date meta for the mobile day-strip. Precomputed here so the strip stays a
  // pure presentational consumer — same country + item-count source the month grid uses.
  // The Today marker date comes from the single trip-clock.
  // memoized — this walks all 32 trip days and calls the accessor on each, and it ran on
  // EVERY render (a keystroke in the composer, a hover, a highlight change).
  // reads `getVisibleDayPlan`, so a filtered strip counts only that person's items. That
  // accessor's identity is `getDayPlan`'s (the itinerary version tick) PLUS the filter selection,
  // so the scan still re-runs exactly when one of those changes and not once more.
  const dayStripMeta: DayStripDateMeta[] = useMemo(
    () =>
      TRIP_DATES.map((date) => ({
        date,
        country: getCountryForDate(date),
        count: getVisibleDayPlan(date).items?.length ?? 0,
      })),
    [getVisibleDayPlan],
  );
  const todayStripDate = getTodayInTrip()?.date ?? null;

  // ONE PlanDayMap instance, placed either in the desktop inline pane or the
  // mobile bottom-sheet by `isDesktop` — never both, so there is a single GL context.
  //
  // /: wrapped, because this is one of the 3 call sites gen-sw.mjs reports
  // as maplibre-reduced ("gen-sw: maplibre withheld from N call site(s)") — the
  // chunk is deliberately not precached, so cold-offline React.lazy throws HERE, and
  // unwrapped that throw escapes to app/error.tsx and takes the whole /plan/ route
  // down (planner, timeline, budget and all) the moment someone toggles map view.
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
    <section id="itinerary" aria-labelledby="itinerary-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* The running head. STATIC here, not sticky, and that is a deliberate exception:
            /plan already pins two bands with measured offsets (the day strip at the navbar's 64px
            and the composer at navbar+strip), so a third sticky band would either collide with
            them or push both offsets, which are documented as must-never-drift. Every field is
            live: the day, its place, what is on it and how much of it is struck. */}
        <header className="head static mb-6 -mx-4 sm:-mx-6" data-leg={currentPlan.country}>
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

        <SectionHeading
          id="itinerary-heading"
          className="mb-8"
          title="Itinerary planner"
          subtitle="Plan every day of the journey. Drag items to reorder or move between days."
        />

        <PlanDensity meta={dayStripMeta} selectedDate={selectedDate} />

        {/* search-within-plan: read-only over titles/notes/categories across
            every day. A cross-day pick jumps `selectedDate` and highlights the row via
            `focusItem`. */}
        <PlanSearch plans={plans} onSelect={handleSearchSelect} />

        {/* ── ROW 1: the sticky date strip (`<lg`) ────────────────────────────────
            Lifted out of the left grid cell to get here. `position:sticky` only sticks
            within its own containing block, and the strip's block used to be the day-picker
            pane — a box exactly as tall as the strip, so `sticky` was a no-op there. As a
            direct child of the planner container it now stays pinned under the navbar for
            the whole scroll, which is the point: the day you are editing is always visible.
            `top-16` is the fixed navbar's height (h-16); `h-[76px]` is declared, not
            incidental, because the composer below parks at exactly navbar+strip (see its
            `top-[140px]`). Desktop keeps the month grid as its picker and never renders this. */}
        <div className="sticky top-16 z-20 -mx-4 mb-4 flex h-[76px] items-center gap-2 border-b-2 border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] px-4 sm:-mx-6 sm:px-6 lg:hidden">
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

        {/* ── ROW 2: the one planner toolbar ──────────────────────────────────────
            Before this change the planner stacked its controls as separate full-width
            strata: a Calendar/Agenda switch, the author filter, the map toggle, the month-
            view expander, and — inside the day card, a third of the way down the page — the
            Select / Clear-day pair. Five bands of chrome between the heading and the plan.
            They are now ONE 44px row (`min-h-[44px]`, the project's touch-target floor),
            with the day-scoped actions sitting beside the view-scoped ones because from the
            user's side they are all "things I do to this day".
            Under `sm` (640px) everything but the map toggle folds into an overflow
            disclosure. The controls are declared ONCE and the SAME nodes are either laid
            out inline (`sm:`) or dropped into the panel — duplicating them per breakpoint
            would double every testid and break Playwright's strict mode. */}
        <div
          role="group"
          aria-label="Plan tools"
          data-testid="calendar-toolbar"
          className="relative mb-6 flex min-h-tap flex-wrap items-center justify-center gap-2"
        >
          {/* split map/list toggle. OFF by default → the maplibre island stays
              interaction-lazy. On → the selected day's stops + polyline render on
              <TripMap> beside the list (lg+) or in a bottom-sheet peek (`<lg`). Kept out of
              the overflow at every width: it is the toolbar's primary action and the one
              the pin picker arms. */}
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
            {showMap ? 'Hide map' : 'Show map'}
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
            More
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

            {/* Author filter: presentational, read-only. Self-hides when no item is
                attributed (dormant/portfolio build unchanged). Narrows the day-detail list
                below AND the rest of this day's chrome (shared selection via
                lib/author-filter). (#94: the timeline it also used to drive is deleted — this
                is the only mount site now.) */}
            <AuthorFilterControl plans={plans} />

            {/* Clear day + Select — moved out of the day card into this row. Both
                still appear only when the day has items, and Select still toggles the
                multi-select mode (OFF by default, no change to the single-item flow).
                🔴: DELIBERATELY `dayItems` (unfiltered). These are DESTRUCTIVE day-level
                actions — "Clear day" removes the items the filter is hiding too, so it must stay
                offered on a day whose visible list is empty. Do not "finish the job" here. */}
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
          <div className="min-w-0 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] p-4 sm:p-6" data-leg={currentPlan.country}>
            {/* Day Header */}
            <div className="flex items-center justify-between gap-1 mb-5">
              <button onClick={goToPrev} disabled={currentIdx <= 0} aria-label="Previous day" data-testid="calendar-prev-day" className="shrink-0 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 hover:bg-white/5 text-ink-mid disabled:text-ink-lo disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><ChevronLeft className="w-5 h-5" /></button>
              <div className="text-center min-w-0 px-1">
                <h3 className="num text-n-sm uppercase text-ink-hi sm:text-n-md">{formatDateLong(selectedDate)}</h3>
                <p className="pr pr--lo mt-0.5">
                  Day {currentIdx + 1} · {dayPlaceLabel(currentPlan)}
                </p>
                {/* day-at-a-glance pill row — composes the existing spend pill +
                    weather pill (unchanged testids/markup below) alongside two new pills (item
                    count, first-start time). A flex-wrap row so it degrades gracefully on narrow
                    viewports; renders nothing when the day has none of the four facts. */}
                <div
                  data-testid="calendar-day-glance"
                  className="mt-1 flex flex-wrap justify-center items-center gap-1.5"
                >
                  {/* the VISIBLE count. This pill sitting at "7 items" above a list showing
                      2 was the headline symptom of INTAKE-07. */}
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
                  {/* quiet contextual weather tag — pure derivation over whatever the
                      Open-Meteo cache (already fetched elsewhere, e.g. the Today/Essentials
                      panel) happens to cover for this exact city/date. No cache hit → nothing
                      rendered, no layout shift. */}
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

            {/* — the composer. Moved out from under the list to directly under the day
                header and made STICKY, so on a long day the primary add path never scrolls away.
                `top-16` is the fixed navbar's exact height (h-16), so it parks just below it;
                `z-10` keeps it inside this card's stacking context, far under the editor portal
                (z-50) and the map sheet (z-40). Full-bleed via -mx to cover the card's padding
                gutters while rows scroll behind it.
                Type a title → Enter → the item lands on the selected day through the same
                addItem → commit() choke-point as every other write. A leading or
                trailing time token ("7pm dinner", "dinner 19:00") is peeled by
                `extractQuickAddTime` and dual-written as time + startMinutes, exactly
                the pair the editor writes. "Details" opens the FULL editor for anything one
                line can't say — it is the same trigger the dashed "Add Activity" button was,
                relocated, not removed (it is the ONLY path to a blank editor). */}
            {/* parks at navbar (64px) + sticky day strip (76px) below `lg`, where both
                bands are pinned; at `lg+` there is no strip so it returns to the navbar. */}
            <div className="sticky top-[140px] lg:top-16 z-10 -mx-4 sm:-mx-6 mb-3 border-b-2 border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] px-4 py-2 sm:px-6">
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
                  className="chip chip--hollow shrink-0 min-h-tap px-3 transition-colors hover:border-[color:var(--accent)] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Details
                </button>
              </div>
              {/* — the visible affordance for the time syntax. had to cut the hint
                  from the placeholder because at 390px the input shares its row with the submit
                  and Details buttons and anything past ~20 characters truncated MID-WORD, and it
                  moved the hint into the accessible name — which left the feature's whole value
                  invisible to everyone not using a screen reader.
                  On its own line the constraint disappears: the hint owns the full row width, and
                  it WRAPS rather than truncates (no `truncate`/`text-ellipsis`/`whitespace-nowrap`
                  here, deliberately) so no width can ever clip it mid-word. */}
              <p
                data-testid="calendar-quick-add-hint"
                className="mt-1 text-t-sm leading-snug text-ink-mid"
              >
                Tip: start with a time — “7pm dinner”
              </p>
            </div>

            {/* the Select / Clear-day pair that used to sit here is now in the one
                planner toolbar above (Row 2), beside the map and filter controls. */}

            {/* bulk-action bar — extracted to CalendarBulkToolbar (pure move). Visible
                only in select mode; the parent still owns the selection + the delete confirm. */}
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
                  {/* 🔴: `dayItems` (unfiltered) ON PURPOSE — this warns about what will
                      ACTUALLY be deleted, which is the whole stored day including anything the
                      active filter is hiding. Filtering this number would understate a
                      destructive action. */}
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

            {/* multi-day span bands — the view-layer expansion of spanning items across the
                days they cover. Rendered ABOVE the timed list on every covered day (including the
                start day, where the item ALSO appears as an editable row below). On non-start days
                this band is the ONLY trace of the item — it is never re-inserted into the list, so
                the item stays owned by its single start-day doc. Each band carries an accessible
                label describing the span. */}
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
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <DroppableDay dateStr={selectedDate}>
                <SortableContext items={allItemIds} strategy={verticalListSortingStrategy}>
                  <div className="list" ref={listRef}>
                    {visibleItems.length === 0 ? (
                      /* 9.8 — the empty state renders the SHAPE of the day at the size it will
                         be: three ruled, hollow slots plus the condition in words at --t-body /
                         --text-mid. The two condition strings are LOAD-BEARING and neither may
                         drift into the other (e2e/author-filter-propagation.spec.ts asserts both). */
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
                        {/* 🔴: `dayItems` (unfiltered) is LOAD-BEARING here — it is the only
                            thing that tells these two states apart. Route it through the filtered
                            set and both branches collapse into "no activities planned", which
                            would tell a traveller their day is empty when it is not. */}
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
                        // The explicit unplanned rule between this row and the one above it. A
                        // FACT about the pair, not a spacer — see `unplannedGapMinutes`.
                        const gapMin = unplannedGapMinutes(phaseGroups[idx - 1]?.item, item);
                        return (
                        <div key={item.id}>
                          {/* phase-of-day header — subtle, non-interactive, shown only at a
                              phase boundary in the rendered order (: timed items keep their
                              exact stored order; only untimed items move to the trailing "Anytime"
                              run — see lib/phase-of-day.ts). Not a sortable/draggable node. */}
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
                            clashes={dayClashIds.has(item.id)}
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
                        </div>
                        );
                      })
                    )}
                  </div>
                </SortableContext>
              </DroppableDay>

              <DragOverlay>
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
              className="hidden lg:block sticky top-24 h-[480px] xl:h-[560px] overflow-hidden border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]"
            >
              {mapEl}
            </aside>
          )}
          </div>
        </div>
      </div>

      {/* mobile map bottom-sheet peek (`<lg`). Reuses the rounded-t-2xl glass sheet
          idiom: a non-modal peek fixed to the bottom that the
          page scrolls behind, expandable to near-full height. Rendered only when the map is
          on AND we're on a phone — so exactly one PlanDayMap instance exists (see mapEl).
          Tab-bar clearance is PADDING, not a `bottom` offset: the box stays flush to
          `bottom-0`, so both height states keep the top edge they had and the expanded 85vh
          can't be pushed off the top of a short viewport. Only the canvas shrinks, which is
          what has to move — maplibre docks the tile attribution bottom-right of it, and
          that's a licence condition. `md:pb-0` because the tab bar is `md:hidden` while this
          sheet renders up to `lg`. */}
      {showMap && !isDesktop && (
        <div
          data-testid="plan-map-sheet"
          data-expanded={mapExpanded ? 'true' : 'false'}
          className={`lg:hidden fixed inset-x-0 bottom-0 z-40 flex flex-col bg-[rgb(var(--surface-low))] border-t-2 border-[color:hsl(var(--border))] pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))] transition-[height] duration-300 motion-reduce:transition-none md:pb-0 ${mapExpanded ? 'h-[85vh]' : 'h-[42vh]'}`}
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

      {/* Item Editor Modal.
          Focus returns to the trigger via onExitComplete — i.e. only after the
          editor has fully animated out and unmounted. Doing it earlier (in the
          editor's own effect cleanup) raced framer-motion's exit and left the
          dialog stuck open when close was initiated from inside the panel. */}
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
