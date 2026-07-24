'use client';

import { useState, useEffect, useRef, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { m, AnimatePresence } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import {
  Calendar, Plus, Trash2,
  MapPin, UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Plane, Hotel, Coffee, Music, X, Check, ChevronLeft, ChevronRight, ChevronDown,
  ExternalLink, Map as MapIcon,
} from 'lucide-react';
import { DndContext, closestCenter, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  TRIP_DATES, getCountryForDate, formatDate, formatDateLong,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS,
} from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { buildItineraryStops, stopMarkerFor } from '@/lib/itinerary-map';
import { showUndoToast } from '@/lib/undo-toast';
import { getTodayInTrip } from '@/lib/trip-now';
import { setSelectedDay } from '@/lib/selected-day';
import { DayStripDateMeta } from '@/components/day-strip';
import { SortableItem, DroppableDay, CATEGORY_ICON_MAP } from '@/components/calendar-sortable-item';
import { CalendarBulkToolbar } from '@/components/calendar-bulk-toolbar';
import { CalendarDayPicker } from '@/components/calendar-day-picker';
import { useCalendarDnd } from '@/hooks/use-calendar-dnd';
import { useItineraryContext } from '@/components/itinerary-provider';
import { freshCopyOf } from '@/hooks/use-itinerary';
import QuickAddInput from '@/components/quick-add-input';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { filterItemsByAuthor } from '@/lib/author-filter';
import { useAuthorFilter } from '@/hooks/use-author-filter';
import AuthorFilterControl from '@/components/author-filter';
import { buildMapsSearchUrl } from '@/lib/maps-link';
import { useExpenses } from '@/hooks/use-expenses';
import { expensesByDate } from '@/core/budget/burn-rate';
import { legCurrency, formatMoney } from '@/core/budget/model';
import { effectiveStartMinutes } from '@/core/dates';
import { minutesToHHMM, formatDurationText } from '@/lib/time-picker-format';
import { describeItemTime } from '@/lib/item-time-display';
import { clashingItemIds } from '@/lib/sort-items-by-time';
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
    <div className="grid h-full w-full place-items-center bg-surface text-white/45">
      <span className="text-xs">Loading map…</span>
    </div>
  ),
});

const ALL_CATEGORIES: ItineraryCategory[] = ['sightseeing', 'food', 'photography', 'shopping', 'nature', 'cultural', 'transportation', 'hotel', 'free', 'nightlife'];

// Item Editor Modal
function ItemEditor({ item, startDate, onSave, onClose }: { item?: ItineraryItem; startDate: string; onSave: (item: ItineraryItem) => void; onClose: () => void }) {
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

  // Manual pin-drop. Free-text lat/lng strings so the field can hold an in-progress
  // or invalid value without fighting the input; parsed + range-validated only at render
  // (for the inline hint) and at save (handleSave below). The section starts open whenever
  // the item already carries a pin, closed otherwise.
  const [pinOpen, setPinOpen] = useState(item?.lat !== undefined && item?.lng !== undefined);
  const [latText, setLatText] = useState(item?.lat !== undefined ? String(item.lat) : '');
  const [lngText, setLngText] = useState(item?.lng !== undefined ? String(item.lng) : '');
  const parsedLat = latText.trim() === '' ? undefined : Number(latText);
  const parsedLng = lngText.trim() === '' ? undefined : Number(lngText);
  const latValid = parsedLat === undefined || (Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90);
  const lngValid = parsedLng === undefined || (Number.isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180);
  // A pin is only saved when BOTH fields resolve to a valid number — a lone value (or an
  // out-of-range one) never silently becomes a half-pin; the save button disables instead.
  const pinComplete = parsedLat !== undefined && parsedLng !== undefined;
  const pinReady = latValid && lngValid && (pinComplete || (parsedLat === undefined && parsedLng === undefined));
  const clearPin = () => {
    setLatText('');
    setLngText('');
  };

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

  const handleTimeChange = (minutes: number | undefined) => {
    setStartMinutes(minutes);
    setTimeTouched(true);
  };
  const handleDurationChange = (minutes: number | undefined) => {
    setDurationMinutesState(minutes);
    setDurationTouched(true);
  };

  // Portal mount guard ( / mirrored from add-to-itinerary-dialog.tsx /
  //). `createPortal(…, document.body)` must not run during the static-export
  // prerender, so we only portal after the component has mounted on the client. The
  // editor only ever mounts on a user click (post-hydration), so this is satisfied
  // immediately in practice; it exists purely to keep `document` untouched on the
  // server and to keep tsc/SSR honest.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  const mapsUrl = buildMapsSearchUrl(title, location);

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
  const latFieldId = `${baseId}-lat`;
  const lngFieldId = `${baseId}-lng`;
  const endDateFieldId = `${baseId}-enddate`;

  // Refs for focus management: the panel (focus-trap boundary) and the first
  // field (focused on open). Returning focus to the trigger is the parent's job
  // via AnimatePresence onExitComplete — doing it here in an effect cleanup
  // raced framer-motion's exit animation and grabbed the wrong element.
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!title.trim() || !pinReady) return;
    onSave({
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
      // Manual pin-drop: saved only when BOTH resolve (pinComplete); otherwise both
      // explicitly undefined (overriding the `...item` spread above) — clearing the fields
      // and saving removes a pin the item previously had.
      lat: pinComplete ? parsedLat : undefined,
      lng: pinComplete ? parsedLng : undefined,
      // Multi-day span: the resolved end day (strictly after the start day, in-range)
      // or undefined — overriding the `...item` spread so turning the toggle off / clearing the
      // select removes a span the item previously had. Written onto the START-day doc only.
      endDate: effectiveEndDate,
    });
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-4 bg-black/60 backdrop-blur-sm"
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
        className="w-full lg:max-w-md glass-card-dark rounded-t-2xl lg:rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-hide"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 id={titleId} className="font-display text-lg font-bold text-white">{item ? 'Edit Item' : 'Add Item'}</h3>
          <button type="button" onClick={onClose} aria-label="Close editor" data-testid="calendar-editor-cancel" className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg hover:bg-white/10 text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor={titleFieldId} className="text-xs text-white/50 mb-1 block">Title *</label>
            <input id={titleFieldId} ref={titleInputRef} autoFocus value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} data-testid="calendar-editor-title-input" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., Visit Boudhanath Stupa" />
          </div>
          <div>
            <span id={categoryLabelId} className="text-xs text-white/50 mb-1 block">Category</span>
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
                    className={`flex flex-col items-center justify-start gap-1 min-h-[3rem] px-1 py-2 rounded-lg text-xs transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                      isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.border}` : 'text-white/40 hover:bg-white/5'
                    }`}
                  >
                    {CATEGORY_ICON_MAP[cat]}
                    <span className="capitalize text-[10px] leading-tight text-center break-words w-full">{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={timeFieldId} className="text-xs text-white/50 mb-1 block">Time</label>
              <TimePicker id={timeFieldId} value={startMinutes} onChange={handleTimeChange} testId="calendar-editor-time-input" />
            </div>
            <div>
              <label htmlFor={durationFieldId} className="text-xs text-white/50 mb-1 block">Duration (min)</label>
              <DurationField id={durationFieldId} value={durationMinutes} onChange={handleDurationChange} testId="calendar-editor-duration-input" />
            </div>
          </div>
          <div>
            <label htmlFor={locationFieldId} className="text-xs text-white/50 mb-1 block">Location</label>
            <input id={locationFieldId} value={location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)} data-testid="calendar-editor-location-input" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., Thamel, Kathmandu" />
          </div>
          {/* Manual pin-drop — opt-in, collapsed unless the item already carries a
              pin. Two free-text numeric fields (inputMode="decimal", NOT type="number" —
              wheel-footgun lesson) so a pinned custom item plots on both maps even
              when its title doesn't match a curated marker. */}
          <div>
            <button
              type="button"
              onClick={() => setPinOpen((v) => !v)}
              aria-expanded={pinOpen}
              data-testid="calendar-editor-pin-toggle"
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/75 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 rounded-lg focus-visible:outline-none"
            >
              <MapPin className="w-3.5 h-3.5" />
              Pin exact location (optional)
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${pinOpen ? 'rotate-180' : ''}`} />
            </button>
            {pinOpen && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={latFieldId} className="text-xs text-white/50 mb-1 block">Latitude</label>
                    <input
                      id={latFieldId}
                      type="text"
                      inputMode="decimal"
                      value={latText}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLatText(e.target.value)}
                      data-testid="calendar-editor-lat-input"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
                      placeholder="e.g., 27.7215"
                    />
                  </div>
                  <div>
                    <label htmlFor={lngFieldId} className="text-xs text-white/50 mb-1 block">Longitude</label>
                    <input
                      id={lngFieldId}
                      type="text"
                      inputMode="decimal"
                      value={lngText}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLngText(e.target.value)}
                      data-testid="calendar-editor-lng-input"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
                      placeholder="e.g., 85.3620"
                    />
                  </div>
                </div>
                {!pinReady && (
                  <p data-testid="calendar-editor-pin-error" className="text-xs text-red-400">
                    Enter both latitude (-90 to 90) and longitude (-180 to 180), or clear both to remove the pin.
                  </p>
                )}
                {(latText || lngText) && (
                  <button
                    type="button"
                    onClick={clearPin}
                    data-testid="calendar-editor-pin-clear"
                    className="text-xs text-white/40 hover:text-white/60 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 rounded focus-visible:outline-none"
                  >
                    Clear pin
                  </button>
                )}
              </div>
            )}
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
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/75 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 rounded-lg focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Calendar className="w-3.5 h-3.5" />
              Spans multiple days (optional)
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${spanOpen ? 'rotate-180' : ''}`} />
            </button>
            {spanOpen && canSpan && (
              <div className="mt-2">
                <label htmlFor={endDateFieldId} className="text-xs text-white/50 mb-1 block">Ends on (inclusive last day)</label>
                <select
                  id={endDateFieldId}
                  value={endDate}
                  data-testid="calendar-editor-span-select"
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-white/10 text-white text-sm outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 focus-visible:outline-none"
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
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-gold-300 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              Search on Google Maps
            </a>
          ) : (
            <span
              aria-disabled="true"
              data-testid="calendar-editor-maps-link"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/25 cursor-not-allowed select-none"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              Search on Google Maps
            </span>
          )}
          <div>
            <label htmlFor={notesFieldId} className="text-xs text-white/50 mb-1 block">Notes</label>
            <textarea id={notesFieldId} value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} data-testid="calendar-editor-notes-input" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 resize-none" placeholder="Additional notes..." />
          </div>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !pinReady}
            data-testid="calendar-editor-save"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-surface font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <Check className="w-4 h-4" />
            {item ? 'Update Item' : 'Add Item'}
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
  const router = useRouter();

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

  // Presentational author filter: READ-ONLY. It only narrows which items
  // are SHOWN; it never touches `plans`/localStorage or any store mutator. CRUD, DnD and
  // persistence operate on the FULL stored set below, unaffected by the active filter.
  const { filter: authorFilter, myName } = useAuthorFilter();

  // cost overlay — READ-ONLY / DISPLAY-ONLY. A SEPARATE reactive read of the
  // expense store (NOT the itinerary store): the calendar's CRUD/DnD/select all still operate on
  // `plans` from `useItineraryContext()`, entirely untouched. This adds a per-day leg-local spend
  // figure to the single-day header and a subtle "has spend" marker on month-grid cells. The pure
  // `expensesByDate` buckets logged expenses by their 'YYYY-MM-DD' (undated ones are excluded from
  // per-day, matching the burn-rate view). Nothing here writes; it only decorates existing cells.
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
    setShowEditor(true);
  };

  const handleEditItem = (item: ItineraryItem) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setEditingItem(item);
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
    addItem(targetDate, freshCopyOf(item));
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
  useEffect(() => {
    const focusId = searchParams?.get('focus');
    if (!focusId) return;
    const day = plans.find((p) => (p.items ?? []).some((i: ItineraryItem) => i.id === focusId));
    if (day) focusItem(day.date, focusId);
    router.replace(window.location.pathname);
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

  // Bulk move the current selection to another day. Every selected id lives on selectedDate,
  // so each target is {itemId, fromDate: selectedDate}. moveItems is ONE commit (tombstone-
  // source + fresh-id-target under sync; physical under dormant). Same-day is guarded out.
  const handleBulkMove = (targetDate: string) => {
    if (!targetDate || targetDate === selectedDate || selectedIds.size === 0) return;
    const targets = [...selectedIds].map((id) => ({ itemId: id, fromDate: selectedDate }));
    moveItems(targets, targetDate);
    exitSelectMode();
  };

  // Copy the WHOLE current day onto another day (copyDay — fresh-id copies of every live item).
  // Independent of the selection (it is a day-level op living in the bulk bar for convenience).
  const handleCopyDay = (targetDate: string) => {
    if (!targetDate) return;
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

  // The selected day's full stored item set (unfiltered — this is the CRUD/DnD target).
  const dayItems = currentPlan.items ?? [];
  // The presentational view: narrowed by the active author filter (read-only). DnD reorder
  // still reads the full set from the store in handleDragEnd, so persistence is unaffected;
  // we only change what renders and which ids the SortableContext tracks (so a drag inside
  // a filtered view stays consistent with what's visible).
  const visibleItems = filterItemsByAuthor(dayItems, authorFilter, myName);
  // phase-of-day grouping: NEVER re-sorts
  // timed items — the calendar view's manual/stored order stays untouched (sort-clash.spec.ts's
  // regression net) — only moves untimed items to a trailing "Anytime" run. `isNewPhase` marks
  // where the render layer inserts a subtle phase header. SortableContext's `items` below is
  // this GROUPED order so dnd-kit's index math matches the actual DOM order.
  const phaseGroups = useMemo(() => groupItemsByPhase(visibleItems), [visibleItems]);
  const allItemIds = phaseGroups.map((g) => g.item.id);
  // day-at-a-glance pill row: item count + first-start time (composed alongside the
  // existing spend/weather pills at the day header, below). Derived from the FULL stored set
  // (dayItems), matching the spend/weather pills' day-level (not author-filtered) scope.
  const firstTimedItem = useMemo(() => earliestTimedItem(dayItems), [dayItems]);
  const firstStartInfo = firstTimedItem ? describeItemTime(firstTimedItem, selectedDate) : null;
  // warn-only clash badge, computed at the day-render level off the full
  // stored set (order-independent) — presentation-only, never touches the manual
  // drag-order (`handleDragEnd`/`arrayMove`/`SortableContext` are all untouched below).
  const dayClashIds = useMemo(() => clashingItemIds(dayItems), [dayItems]);

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
        if (plan.date <= selectedDate && selectedDate <= item.endDate) {
          bands.push({ item, spanStart: plan.date, spanEnd: item.endDate, isStartDay: plan.date === selectedDate });
        }
      }
    }
    return bands;
  }, [plans, selectedDate]);

  // day-scoped map data: the selected day's coordinate stops (marker-matched),
  // re-derived from the live plan so a reorder yields a new ordered array → PlanDayMap
  // re-passes it → TripMap redraws the polyline.
  const dayStops = useMemo(() => buildItineraryStops([currentPlan]), [currentPlan]);
  // Per-item matched marker id — the same stopMarkerFor join buildItineraryStops uses (pin
  // BEATS name/sourceId match,), so a row and its map stop always agree. Drives the
  // row ring + the "show on map" affordance.
  const markerIdFor = (item: ItineraryItem) =>
    stopMarkerFor(item, currentPlan.country === 'nepal' ? 'Nepal' : 'Japan')?.id ?? null;

  // Per-date meta for the mobile day-strip. Precomputed here so the strip stays a
  // pure presentational consumer — same country + item-count source the month grid uses
  // (full stored set, unaffected by the read-only author filter). The Today marker date
  // comes from the single trip-clock.
  const dayStripMeta: DayStripDateMeta[] = TRIP_DATES.map((date) => ({
    date,
    country: getCountryForDate(date),
    count: getDayPlan(date).items?.length ?? 0,
  }));
  const todayStripDate = getTodayInTrip()?.date ?? null;

  // ONE PlanDayMap instance, placed either in the desktop inline pane or the
  // mobile bottom-sheet by `isDesktop` — never both, so there is a single GL context.
  const mapEl = (
    <PlanDayMap
      dayStops={dayStops}
      totalItems={dayItems.length}
      highlightId={highlightId}
      onMarkerClick={handleMarkerClick}
    />
  );

  return (
    <section id="itinerary" aria-labelledby="itinerary-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="itinerary-heading"
          className="mb-10"
          title={<>Itinerary <span className="text-gradient-gold">Planner</span></>}
          subtitle="Plan every day of the journey. Drag items to reorder or move between days."
        />

        {/* search-within-plan: read-only over titles/notes/categories across
            every day. A cross-day pick jumps `selectedDate` and highlights the row via
            `focusItem`. */}
        <PlanSearch plans={plans} onSelect={handleSearchSelect} />

        {/* View Toggle — desktop only (`lg+`). On phones the day-strip + collapsible
            month view replace this Calendar/Agenda switch, so it is hidden below `lg`. */}
        <div className="hidden lg:flex flex-wrap justify-center gap-2 mb-6">
          <button
            onClick={() => setViewMode('calendar')}
            aria-pressed={viewMode === 'calendar'}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${viewMode === 'calendar' ? 'bg-gold-500/20 text-gold-400 ring-1 ring-gold-400/30' : 'text-white/50 hover:bg-white/5'}`}
          >
            <Calendar className="w-4 h-4 inline mr-1.5" />
            Calendar View
          </button>
          <button
            onClick={() => setViewMode('agenda')}
            aria-pressed={viewMode === 'agenda'}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${viewMode === 'agenda' ? 'bg-gold-500/20 text-gold-400 ring-1 ring-gold-400/30' : 'text-white/50 hover:bg-white/5'}`}
          >
            <MapPin className="w-4 h-4 inline mr-1.5" />
            Agenda View
          </button>
        </div>

        {/* Author filter: presentational, read-only. Self-hides when no item is
            attributed (dormant/portfolio build unchanged). Narrows the day-detail list
            below AND the timeline (shared selection via lib/author-filter). */}
        <AuthorFilterControl plans={plans} className="mb-6" />

        {/* split map/list toggle. OFF by default → the maplibre island stays
            interaction-lazy. On → the selected day's stops + polyline render on
            <TripMap> beside the list (lg+) or in a bottom-sheet peek (`<lg`). */}
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            aria-pressed={showMap}
            data-testid="plan-map-toggle"
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
              showMap
                ? 'bg-gold-500/20 text-gold-300 border-gold-500/40'
                : 'text-white/50 border-white/10 hover:bg-white/5 hover:text-white/80'
            }`}
          >
            <MapIcon className="w-4 h-4" />
            {showMap ? 'Hide map' : 'Show map'}
          </button>
        </div>

        <div className="grid lg:grid-cols-[340px_1fr] gap-6">
          {/* Left: the day selector — extracted the mobile day-strip block + desktop
              month-grid / agenda-list into CalendarDayPicker (pure move, same markup). */}
          <CalendarDayPicker
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            viewMode={viewMode}
            getDayPlan={getDayPlan}
            spendByDate={spendByDate}
            todayStripDate={todayStripDate}
            dayStripMeta={dayStripMeta}
          />

          {/* Right region: the day detail + the optional inline map pane. When the
              map is open on lg+ they sit side-by-side at xl and stack at lg. */}
          <div className={`min-w-0 ${showMap && isDesktop ? 'grid grid-cols-1 xl:grid-cols-[1fr_minmax(300px,360px)] gap-6 items-start' : ''}`}>
          {/* Right: Day Detail with DnD */}
          <div className="min-w-0 glass-card rounded-2xl p-4 sm:p-6">
            {/* Day Header */}
            <div className="flex items-center justify-between gap-1 mb-5">
              <button onClick={goToPrev} disabled={currentIdx <= 0} aria-label="Previous day" data-testid="calendar-prev-day" className="shrink-0 p-2 rounded-lg hover:bg-white/5 text-white/50 disabled:opacity-20 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><ChevronLeft className="w-5 h-5" /></button>
              <div className="text-center min-w-0 px-1">
                <h3 className="font-display text-base sm:text-lg font-bold text-white leading-snug">{formatDateLong(selectedDate)}</h3>
                <p className="text-xs text-white/40">
                  Day {currentIdx + 1} • {currentPlan.city}, {currentPlan.country === 'nepal' ? 'Nepal' : 'Japan'}
                </p>
                {/* day-at-a-glance pill row — composes the existing spend pill +
                    weather pill (unchanged testids/markup below) alongside two new pills (item
                    count, first-start time). A flex-wrap row so it degrades gracefully on narrow
                    viewports; renders nothing when the day has none of the four facts. */}
                <div
                  data-testid="calendar-day-glance"
                  className="mt-1 flex flex-wrap justify-center items-center gap-1.5"
                >
                  {dayItems.length > 0 && (
                    <span
                      data-testid="calendar-day-glance-count"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-white/70"
                    >
                      {dayItems.length} item{dayItems.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {firstStartInfo && (
                    <span
                      data-testid="calendar-day-glance-first-start"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-white/70"
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/30 bg-gold-400/10 px-2.5 py-0.5 text-xs font-medium text-gold-300"
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-white/70"
                    >
                      <span aria-hidden="true">{dayWeatherTag.icon}</span>
                      <span>{dayWeatherTag.label}</span>
                    </span>
                  )}
                </div>
              </div>
              <button onClick={goToNext} disabled={currentIdx >= TRIP_DATES.length - 1} aria-label="Next day" data-testid="calendar-next-day" className="shrink-0 p-2 rounded-lg hover:bg-white/5 text-white/50 disabled:opacity-20 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><ChevronRight className="w-5 h-5" /></button>
            </div>

            {/* Day toolbar. Both appear only when the day has
                items. Select toggles the multi-select mode (OFF by default — no change to the
                normal single-item flow when off). */}
            {dayItems.length > 0 && (
              <div className="flex justify-between items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  aria-pressed={selectMode}
                  data-testid="calendar-select-toggle"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                    selectMode
                      ? 'bg-gold-500/20 text-gold-300 ring-1 ring-gold-400/30'
                      : 'text-white/40 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  {selectMode ? 'Done' : 'Select'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  data-testid="calendar-clear-day"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-white/40 hover:text-rose-300 hover:bg-rose-400/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear day
                </button>
              </div>
            )}

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
              <AlertDialogContent className="glass-card-dark border-white/10 text-white" data-testid="calendar-bulk-delete-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete selected items?</AlertDialogTitle>
                  <AlertDialogDescription className="text-white/60">
                    This removes the {selectedIds.size} selected item{selectedIds.size === 1 ? '' : 's'} from {formatDateLong(selectedDate)}. You can undo it right after.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="calendar-bulk-delete-cancel">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="calendar-bulk-delete-action"
                    onClick={handleBulkDelete}
                    className="bg-rose-500 text-white hover:bg-rose-400"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
              <AlertDialogContent className="glass-card-dark border-white/10 text-white" data-testid="calendar-clear-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear this day?</AlertDialogTitle>
                  <AlertDialogDescription className="text-white/60">
                    This removes all {dayItems.length} item{dayItems.length === 1 ? '' : 's'} planned for {formatDateLong(selectedDate)}. You can undo it right after.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="calendar-clear-cancel">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="calendar-clear-confirm-action"
                    onClick={handleClearDay}
                    className="bg-rose-500 text-white hover:bg-rose-400"
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
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed ${colors.bg} ${colors.border}`}
                    >
                      <span className={colors.text} aria-hidden="true">{CATEGORY_ICON_MAP[item.category]}</span>
                      <span className="text-sm font-medium text-white truncate">{item.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-white/55" aria-hidden="true">
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
                  <div className="space-y-2" ref={listRef}>
                    {visibleItems.length === 0 ? (
                      <div className="text-center py-12" data-testid="calendar-empty-state">
                        <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
                        {dayItems.length === 0 ? (
                          <>
                            <p className="text-white/30 text-sm">No activities planned for this day</p>
                            <p className="text-white/20 text-xs mt-1">Click the button below to start planning</p>
                          </>
                        ) : (
                          /* Day HAS items, but none match the active author filter (read-only
                             view filter,) — the stored items are untouched. */
                          <>
                            <p className="text-white/30 text-sm">No activities match this filter</p>
                            <p className="text-white/20 text-xs mt-1">Switch the author filter to “All” to see every item</p>
                          </>
                        )}
                      </div>
                    ) : (
                      phaseGroups.map(({ item, phase, isNewPhase }) => {
                        const markerId = markerIdFor(item);
                        return (
                        <div key={item.id}>
                          {/* phase-of-day header — subtle, non-interactive, shown only at a
                              phase boundary in the rendered order (: timed items keep their
                              exact stored order; only untimed items move to the trailing "Anytime"
                              run — see lib/phase-of-day.ts). Not a sortable/draggable node. */}
                          {isNewPhase && (
                            <p
                              data-testid={`calendar-phase-header-${phase}-${item.id}`}
                              className="mt-3 mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-white/35 first:mt-0"
                            >
                              {PHASE_LABELS[phase]}
                            </p>
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
                  <div className="drag-overlay glass-card-dark rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <span className={CATEGORY_COLORS[activeItem.category]?.text ?? 'text-white'}>
                        {CATEGORY_ICON_MAP[activeItem.category]}
                      </span>
                      <span className="text-sm font-medium text-white">{activeItem.title}</span>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            {/* Inline quick-add — title → Enter → addItem on
                the selected day. This is the single FAST, title-only affordance; the "Add
                Activity" button below (and the phone quick-add FAB) open the FULL editor for
                detailed adds, so the surface has one fast path + one detailed path, not two
                competing quick adds. Writes through the same commit() choke-point → holds. */}
            <div className="mt-4">
              <QuickAddInput
                label={`Quick-add a plan for ${formatDateLong(selectedDate)}`}
                testId="calendar-quick-add"
                onAdd={(title) => addItem(selectedDate, { id: generateItemId(), title, category: 'sightseeing' })}
              />
            </div>

            {/* Add Button — the DETAILED path (full editor: time, category, location, notes). */}
            <button
              onClick={handleAddItem}
              data-testid="calendar-add-item"
              className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/10 text-white/40 hover:text-gold-400 hover:border-gold-400/30 hover:bg-gold-400/5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              <Plus className="w-4 h-4" />
              Add Activity
            </button>
          </div>

          {/* desktop inline map pane (lg+). Sticky + tall; stacks under the day
              detail at lg, sits beside it at xl. Mobile (`<lg`) uses the sheet below. */}
          {showMap && isDesktop && (
            <aside
              aria-label={`Map of stops for ${formatDateLong(selectedDate)}`}
              className="hidden lg:block sticky top-24 h-[480px] xl:h-[560px] rounded-2xl overflow-hidden border border-white/10 glass-card"
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
          on AND we're on a phone — so exactly one PlanDayMap instance exists (see mapEl). */}
      {showMap && !isDesktop && (
        <div
          data-testid="plan-map-sheet"
          data-expanded={mapExpanded ? 'true' : 'false'}
          className={`lg:hidden fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl glass-card-dark border-t border-white/10 shadow-2xl transition-[height] duration-300 motion-reduce:transition-none ${mapExpanded ? 'h-[85vh]' : 'h-[42vh]'}`}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-white/70">
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
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${mapExpanded ? '' : 'rotate-180'}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowMap(false)}
                aria-label="Hide map"
                data-testid="plan-map-sheet-close"
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
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
            onSave={handleSaveItem}
            onClose={() => { setShowEditor(false); setEditingItem(undefined); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
