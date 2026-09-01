'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import { toast } from 'sonner';
import {
  MapPin, X, Check, Trash2, Plus,
  ExternalLink,
} from 'lucide-react';
import {
  TRIP_DATES, formatDate, getCountryForDate,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS,
} from '@/lib/trip-data';
import { ALL_CATEGORIES } from '@/lib/itinerary-category';
import { CATEGORY_ICON_MAP } from '@/components/category-icon';
import { placeLabelForDate } from '@/lib/leg-label';
import { generateItemId } from '@/lib/item-id';
import { useItineraryContext } from '@/components/itinerary-provider';
import { showUndoToast } from '@/lib/undo-toast';
import { flyChip } from '@/lib/fly-chip';
import type { ItineraryDraft } from '@/lib/itinerary-adapter';
import { buildMapsSearchUrl, buildMapsPlaceUrl } from '@/lib/maps-link';
import { effectiveStartMinutes, offsetForCountry } from '@/core/dates';
import { describeClash, firstClashWith, timeFootprintChanged } from '@/lib/sort-items-by-time';
import { minutesToHHMM, formatDurationText } from '@/lib/time-picker-format';
import { describeItemTime } from '@/lib/item-time-display';
import TimePicker, { DurationField } from '@/components/time-picker';
import { overlayPanelMotion } from '@/lib/motion';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';

// Back-compat re-export: `buildMapsSearchUrl`/`buildMapsPlaceUrl` were hoisted to the pure,
// React-free `@/lib/maps-link` module (so eager consumers like the calendar can use them without
// dragging this component + framer-motion into their first-load bundle). Re-exported here so
// existing importers (e.g. place-detail-sheet) keep resolving them from this module unchanged.
// This module's own JSX below still calls buildMapsPlaceUrl via the import above.
export { buildMapsSearchUrl, buildMapsPlaceUrl };

/**
 * Shared "Add to plan" dialog — a NEW, lightweight, source-aware dialog,
 * deliberately separate from the calendar's `ItemEditor`. It is invoked from any
 * place card (via `add-to-plan-button.tsx`) with a prefilled `ItineraryDraft`
 * and the place's current `existingPlacements` (from `findPlacements`).
 *
 * It reads/writes the itinerary THROUGH the store —
 * no add/remove callbacks per call site. The CustomEvent fan-out makes the
 * calendar / dashboard / card reflect every change immediately.
 *
 * A11y / focus reuses the EXACT contract that `ItemEditor` uses:
 * - role="dialog" aria-modal aria-labelledby
 * - document-level Esc via an `onCloseRef` (latest-closure, bound once)
 * - a lightweight Tab-trap inside the panel
 * - autofocus the first field on open
 * - parent-owned focus-return: the invoking button captures the trigger and
 * refocuses it on `<AnimatePresence onExitComplete>` — NOT in this dialog's
 * effect cleanup.
 * Reduced-motion is respected by framer-motion via the global reduced-motion CSS
 *; Tailwind classes are static literals.
 *
 * RENDERING: the overlay is rendered through a React PORTAL to
 * `document.body`. Every trigger surface (recommendations, photography, map popup,
 * featured) sits inside a place card whose root is a framer `m.div` with an active
 * `whileHover` transform AND `overflow-hidden`. A `position: fixed` element whose
 * ancestor is transformed is positioned relative to that ancestor (CSS
 * containing-block rule), not the viewport — so rendered inline, the backdrop covered
 * only the card (neighbours stayed bright) and the panel overflowed and was clipped by
 * the card's `overflow-hidden`, hiding the pinned footer. The portal moves ONLY the DOM
 * node out to `<body>`; the React tree (and the parent `AnimatePresence`) is unchanged,
 * so the focus contract — document-level Esc, the `panelRef` Tab-trap, first-field
 * autofocus, and parent-owned focus-return on `onExitComplete` — all keep working. The
 * portal is mount-guarded (`mounted` state) so it never touches `document` during the
 * static-export prerender (`output: 'export'`); the dialog only mounts on a user click,
 * post-hydration, so this is always satisfied in practice.
 */

// Build the date-select option label: "Tue, Dec 12 · Kathmandu, Nepal".: the city
// was hardcoded to Kathmandu/Tokyo and the country to a nepal/japan ternary — both now come from
// the one shared place-label helper, so Dec 9 reads "New York, USA" and a custom trip reads its
// own city with no country appended.
function dateOptionLabel(dateStr: string): string {
  return `${formatDate(dateStr)} · ${placeLabelForDate(dateStr)}`;
}

export interface ExistingPlacement {
  date: string;
  item: ItineraryItem;
}

export interface AddToItineraryDialogProps {
  open: boolean;
  draft: ItineraryDraft;
  existingPlacements: ExistingPlacement[];
  onClose(): void;
  /**
   * custom-add mode. Default 'source' keeps today's byte-compatible
   * source behavior (Title/Location fixed, sourceId/sourceType stamped). In 'custom'
   * mode Title + Location become editable text inputs, the confirm is blocked until
   * Title is non-empty, and the created item is a PLAIN ItineraryItem with NO
   * sourceId/sourceType — so it can never trip a false "Added" badge.
   */
  mode?: 'source' | 'custom';
  /** Custom mode only: preset the date select to this date (e.g. the FAB's day). */
  presetDate?: string;
}

export default function AddToItineraryDialog({
  open,
  draft,
  existingPlacements,
  onClose,
  mode = 'source',
  presetDate,
}: AddToItineraryDialogProps) {
  // D-316: `getDayPlan` is the overlap guard's comparison set — zero new props, the store
  // this dialog already reads and writes through.
  const { addItem, updateItem, removeItem, restoreItem, getDayPlan } = useItineraryContext();
  const isCustom = mode === 'custom';

  // The date the form initializes to. Custom mode honors `presetDate` (the FAB's
  // day) when it's a valid trip date; otherwise both modes fall back to TRIP_DATES[0].
  const initialDate =
    presetDate && TRIP_DATES.includes(presetDate) ? presetDate : TRIP_DATES[0];

  // Portal mount guard. `createPortal(…, document.body)` must not run
  // during the static-export prerender, so we only portal after the component has
  // mounted on the client. The dialog only ever mounts on a user click (post-hydration),
  // so this is satisfied immediately on open; it exists purely to keep `document`
  // untouched on the server and to keep tsc/SSR honest.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Live ref to the latest onClose so the once-registered Esc listener always
  // calls the current closure without re-binding every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Form state. Default the date to the first placement (modify mode) else the
  // preset/first trip date (add mode). Category/time/duration/notes prefill from the
  // draft, then from the placement being modified if one is selected.
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  // Time/duration picker state. `timeTouched`/`durationTouched` gate the
  // dual-write on confirm: untouched fields pass the ORIGINAL time/duration through
  // unchanged (from `originalTimeRef`, reset alongside every form reset below) instead
  // of being silently clobbered — mirrors ItemEditor's identical rule.
  const [startMinutes, setStartMinutesState] = useState<number | undefined>(undefined);
  const [timeTouched, setTimeTouched] = useState(false);
  const [durationMinutes, setDurationMinutesState] = useState<number | undefined>(undefined);
  const [durationTouched, setDurationTouched] = useState(false);
  const originalTimeRef = useRef<{
    time?: string; startMinutes?: number; duration?: string; durationMinutes?: number;
  }>({});
  const [category, setCategory] = useState<ItineraryCategory>(draft.category);
  const [notes, setNotes] = useState<string>(draft.notes ?? '');
  // Custom mode only: editable Title + Location. In source mode these are unused
  // (Title/Location come fixed from the draft), so source behavior is unchanged.
  const [customTitle, setCustomTitle] = useState<string>(draft.title ?? '');
  const [customLocation, setCustomLocation] = useState<string>(draft.location ?? '');

  // In modify mode the user works on one existing placement at a time. Its
  // {date,itemId} is the modify target; null = "add a new placement".
  const [editingPlacementId, setEditingPlacementId] = useState<string | null>(null);

  const handleTimeChange = (minutes: number | undefined) => {
    setStartMinutesState(minutes);
    setTimeTouched(true);
  };
  const handleDurationChange = (minutes: number | undefined) => {
    setDurationMinutesState(minutes);
    setDurationTouched(true);
  };

  // Re-seed the form whenever the dialog (re)opens or its draft changes, so a
  // reused dialog instance never shows stale values from a prior open. Time is left
  // untimed by default (draft.time is deliberately never prefilled, pre-existing
  // behavior); duration.text is
  // carried as the ORIGINAL fallback so an untouched confirm still writes it, unchanged.
  useEffect(() => {
    if (!open) return;
    setSelectedDate(initialDate);
    setStartMinutesState(undefined);
    setTimeTouched(false);
    setDurationMinutesState(undefined);
    setDurationTouched(false);
    originalTimeRef.current = { duration: draft.duration };
    setCategory(draft.category);
    setNotes(draft.notes ?? '');
    setCustomTitle(draft.title ?? '');
    setCustomLocation(draft.location ?? '');
    setEditingPlacementId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.sourceId, initialDate]);

  // Stable, collision-free ids for label/aria wiring.
  const baseId = useId();
  const titleId = `${baseId}-modal-title`;
  const dateFieldId = `${baseId}-date`;
  const timeFieldId = `${baseId}-time`;
  const durationFieldId = `${baseId}-duration`;
  const notesFieldId = `${baseId}-notes`;
  const categoryLabelId = `${baseId}-category-label`;
  const titleFieldId = `${baseId}-title`;
  const locationFieldId = `${baseId}-location`;

  const panelRef = useRef<HTMLDivElement>(null);
  // In custom mode the first focusable field is the editable Title input; in source
  // mode it's the date select.
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // flying chip: measure the confirm button as the chip's launch point.
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Launch the "added to plan" flying chip from the confirm button toward the plan
  // target. Presentational only + reduced-motion-gated inside flyChip; fire BEFORE
  // onClose (the dialog unmounts on close, but the chip lives outside React).
  const launchChip = (label: string) => {
    const btn = confirmRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    flyChip(
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { label, colorClass: CATEGORY_COLORS[category]?.text },
    );
  };

  // custom mode with an EMPTY sourceId never has
  // existing placements — the caller always passes `[]` since no sourceId can ever
  // match `findPlacements` — so isModifyMode is false there. Custom mode with a
  // NON-EMPTY sourceId (a namespaced nightlife id) behaves like source mode: the
  // caller passes real `findPlacements(draft.sourceId)` results.
  const isModifyMode = existingPlacements.length > 0;

  // The effective title/location the confirm + Maps link use. Custom mode reads the
  // editable fields; source mode reads the fixed draft (unchanged behavior).
  const effectiveTitle = isCustom ? customTitle : draft.title;
  const effectiveLocation = isCustom ? (customLocation || undefined) : draft.location;
  // coordinate-first when a pin is known. Neither `draft: ItineraryDraft` nor the custom-add
  // fields carry lat/lng today, so this is currently always the buildMapsSearchUrl(title, location)
  // fallback — swapped for consistency with the other two link-out sites and so a future draft that
  // does carry a pin gets the more reliable link with no further change here.
  const mapsUrl = buildMapsPlaceUrl(effectiveTitle, undefined, undefined, effectiveLocation);
  // Confirm is blocked in custom mode until a non-empty title.
  const confirmDisabled = isCustom && effectiveTitle.trim().length === 0;

  // Load a placement's values into the form so the user can change its date/time
  // (and category/duration/notes). Selecting a placement switches the confirm
  // action to "update in place".
  const startEditingPlacement = (placement: ExistingPlacement) => {
    setEditingPlacementId(placement.item.id);
    setSelectedDate(placement.date);
    setStartMinutesState(effectiveStartMinutes(placement.item));
    setTimeTouched(false);
    setDurationMinutesState(placement.item.durationMinutes);
    setDurationTouched(false);
    originalTimeRef.current = {
      time: placement.item.time,
      startMinutes: placement.item.startMinutes,
      duration: placement.item.duration,
      durationMinutes: placement.item.durationMinutes,
    };
    setCategory(placement.item.category);
    setNotes(placement.item.notes ?? '');
  };

  // Reset the form back to "add a new placement" (clears the modify target).
  const startAddingNew = () => {
    setEditingPlacementId(null);
    setSelectedDate(initialDate);
    setStartMinutesState(undefined);
    setTimeTouched(false);
    setDurationMinutesState(undefined);
    setDurationTouched(false);
    originalTimeRef.current = { duration: draft.duration };
    setCategory(draft.category);
    setNotes(draft.notes ?? '');
  };

  // dual-write, gated on whether the user actually touched the picker/field —
  // otherwise the ORIGINAL time/duration (from whichever target is active) passes
  // through unchanged, so an unparseable legacy string is never silently clobbered.
  const effectiveTime = timeTouched
    ? (startMinutes !== undefined ? minutesToHHMM(startMinutes) : undefined)
    : originalTimeRef.current.time;
  const effectiveStart = timeTouched ? startMinutes : originalTimeRef.current.startMinutes;
  const effectiveDuration = durationTouched
    ? (durationMinutes !== undefined ? formatDurationText(durationMinutes) : undefined)
    : originalTimeRef.current.duration;
  const effectiveDurationMinutes = durationTouched ? durationMinutes : originalTimeRef.current.durationMinutes;

  // D-316 — the refusal message for the last blocked confirm, or null. Cleared as soon as
  // the user moves the time, the duration or the day it is about.
  const [clashError, setClashError] = useState<string | null>(null);
  useEffect(() => setClashError(null), [startMinutes, durationMinutes, selectedDate]);

  /**
   * D-316 — the overlap guard, covering BOTH branches this dialog can write through: adding
   * a new placement, and modifying an existing one (in place OR moved to another day).
   * Returns the blocking item, or `undefined` when the write is clear.
   *
   * DELTA-SCOPED: an existing placement is only guarded when this confirm actually moves
   * its time footprint, so an already-overlapping placement can still have its category or
   * notes changed. A new placement, and a move to another day, are guarded always.
   */
  const findBlockingClash = (): ItineraryItem | undefined => {
    const original = editingPlacementId
      ? existingPlacements.find((p) => p.item.id === editingPlacementId)
      : undefined;
    const candidate: ItineraryItem = {
      // The id decides self-exclusion: an update-in-place must not clash with its own
      // stored row, while a new placement (or one moved to another day) has no row here.
      id: original && original.date === selectedDate ? original.item.id : 'd316-candidate',
      title: effectiveTitle,
      category,
      time: effectiveTime,
      startMinutes: effectiveStart,
      duration: effectiveDuration,
      durationMinutes: effectiveDurationMinutes,
      // This dialog never edits `endDate`, but it must be carried: a multi-day span is
      // EXEMPT from the clash predicate, and a candidate built without it would judge a
      // span as a plain interval and refuse a time edit that is legal.
      endDate: original?.item.endDate,
    };
    if (original && !timeFootprintChanged(original.item, original.date, candidate, selectedDate)) {
      return undefined;
    }
    return firstClashWith(
      candidate,
      getDayPlan(selectedDate).items ?? [],
      selectedDate,
      offsetForCountry(getCountryForDate(selectedDate)),
    );
  };

  const handleConfirm = () => {
    // D-316 — hard refuse, no override. Runs before either mode's branches so add,
    // update-in-place and move-to-another-day are all covered by one call. On refusal:
    // nothing is written, the dialog stays open, the alert in the footer announces.
    const clash = findBlockingClash();
    if (clash) {
      setClashError(
        `Overlaps ${describeClash(clash)}. Pick another time, or clear the duration to leave this open-ended.`,
      );
      return;
    }

    // Custom mode: editable title/location. amends — the empty-sourceId
    // (FAB / free-form) path stays a PLAIN ItineraryItem with NO sourceId/sourceType
    // (byte-identical, never trips a card "Added" badge, never has a placement to
    // modify). A NON-EMPTY sourceId (a namespaced nightlife id) stamps it and supports
    // modify/move/remove exactly like source mode. Blocked on empty title either way.
    if (isCustom) {
      const title = customTitle.trim();
      if (!title) return; // guard (the button is also disabled)
      const hasSourceId = draft.sourceId.length > 0;
      const patch = {
        title,
        location: customLocation.trim() || undefined,
        category,
        time: effectiveTime,
        startMinutes: effectiveStart,
        duration: effectiveDuration,
        durationMinutes: effectiveDurationMinutes,
        notes: notes || undefined,
        ...(hasSourceId ? { sourceId: draft.sourceId, sourceType: draft.sourceType } : {}),
      };

      if (hasSourceId && editingPlacementId) {
        const original = existingPlacements.find((p) => p.item.id === editingPlacementId);
        if (original && original.date !== selectedDate) {
          removeItem(original.date, editingPlacementId);
          addItem(selectedDate, { ...patch, id: generateItemId() });
          toast.success(`Moved “${title}” to ${formatDate(selectedDate)}`);
        } else {
          updateItem(selectedDate, editingPlacementId, patch);
          toast.success(`Updated “${title}” on ${formatDate(selectedDate)}`);
        }
      } else {
        addItem(selectedDate, { ...patch, id: generateItemId() });
        toast.success(`Added “${title}” to ${formatDate(selectedDate)}`);
        launchChip(title);
      }
      onClose();
      return;
    }

    const patch = {
      title: draft.title,
      location: draft.location,
      category,
      time: effectiveTime,
      startMinutes: effectiveStart,
      duration: effectiveDuration,
      durationMinutes: effectiveDurationMinutes,
      notes: notes || undefined,
      sourceId: draft.sourceId,
      sourceType: draft.sourceType,
    };

    if (editingPlacementId) {
      // Modify an existing placement. If the date is unchanged, update in place;
      // if the user moved it to another day, remove from the old day and re-add on
      // the new one (an item lives inside a single DayPlan, keyed by date).
      const original = existingPlacements.find((p) => p.item.id === editingPlacementId);
      if (original && original.date !== selectedDate) {
        removeItem(original.date, editingPlacementId);
        addItem(selectedDate, { ...patch, id: generateItemId() });
        toast.success(`Moved “${draft.title}” to ${formatDate(selectedDate)}`);
      } else {
        updateItem(selectedDate, editingPlacementId, patch);
        toast.success(`Updated “${draft.title}” on ${formatDate(selectedDate)}`);
      }
    } else {
      // Add a brand-new placement.
      addItem(selectedDate, { ...patch, id: generateItemId() });
      toast.success(`Added “${draft.title}” to ${formatDate(selectedDate)}`);
      launchChip(draft.title);
    }
    onClose();
  };

  // On open: focus the first field — the Title input in custom mode, the date select
  // in source mode. The native control's focus re-asserts shortly after, in case the
  // open animation steals it.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        if (isCustom) titleInputRef.current?.focus();
        else firstFieldRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isCustom]);

  // body[data-dialog-open] flag (cross-lane seam): the quick-add FAB hides while it is set, so the
  // FAB never floats over an open dialog's scrim. The shared hook ref-counts it, so this dialog
  // opening on top of a sheet — and closing again — leaves the sheet's own hold intact.
  useDialogOpenFlag();

  // Esc closes at the document level so it fires wherever focus sits. onClose only
  // flips parent state; the parent returns focus once the exit animation completes.
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

  // Lightweight Tab-trap inside the panel (no new deps), identical to ItemEditor.
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
  // portal target (`document.body`) doesn't exist on the server. Returning null here is
  // safe for the parent `AnimatePresence`: this only short-circuits for the single
  // synchronous render before `useEffect` flips `mounted`, which never coincides with a
  // user-driven open in the static-export client.
  if (!mounted) return null;

  return createPortal(
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <m.div
        ref={panelRef}
        data-testid="add-item-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        // D-292: a dialog is Tier 3 whatever route opened it (issue #24) — same gated calm
        // entrance as every other modal, from `components/ui/sheet-dark.tsx`.
        {...overlayPanelMotion()}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full max-w-md bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] rounded-r2 max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Non-scrolling header — stays pinned at the top of the panel. */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 shrink-0">
          <div className="min-w-0">
            <h3 id={titleId} className="pr pr--l text-ink-hi">
              {isCustom ? 'Add your own plan' : isModifyMode ? 'Update plan' : 'Add to plan'}
            </h3>
            {isCustom ? (
              <p className="text-t-sm text-ink-mid mt-1 truncate">A dinner spot, a place a friend mentioned…</p>
            ) : (
              <>
                <p className="text-t-body text-ink-hi mt-1 truncate">{draft.title}</p>
                {draft.location && (
                  <p className="text-t-sm text-ink-mid mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{draft.location}</span>
                  </p>
                )}
              </>
            )}
          </div>
          <button type="button" data-testid="add-item-cancel" onClick={onClose} aria-label="Close dialog" className="shrink-0 inline-flex items-center justify-center min-h-tap min-w-tap rounded-r1 text-ink-mid hover:bg-white/5 hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body — the only scroll region. `min-h-0` lets it shrink inside
            the flex column so the pinned footer is never pushed off-screen on short
            viewports. A native scrollbar (no `scrollbar-hide`) makes the
            overflow discoverable when the content is taller than the viewport. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6">
        {/* Existing placements (modify/remove mode) */}
        {isModifyMode && (
          <div className="mb-5 space-y-2">
            <span className="pr pr--lo block">Already planned</span>
            {existingPlacements.map((p) => {
              const isEditing = p.item.id === editingPlacementId;
              return (
                <div
                  key={p.item.id}
                  className={`flex items-center gap-2 p-2.5 rounded-r1 border-hair transition-colors ${
                    isEditing
                      ? 'bg-[rgb(62_216_255_/_0.10)] border-[color:hsl(var(--accent))]'
                      : 'bg-[rgb(var(--surface-raised))] border-[color:hsl(var(--border))]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-t-body text-ink-hi truncate">{formatDate(p.date)}</p>
                    <p className="text-t-sm text-ink-mid truncate">
                      {placeLabelForDate(p.date)}
                      {(() => {
                        const timeInfo = describeItemTime(p.item, p.date);
                        if (!timeInfo) return '';
                        return ` · ${timeInfo.label}${timeInfo.badge ? ` ${timeInfo.badge}` : ''}`;
                      })()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEditingPlacement(p)}
                    aria-pressed={isEditing}
                    className={`chip shrink-0 min-h-tap px-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      isEditing ? 'chip--struck bg-white/5' : 'hover:bg-white/5 hover:text-ink-hi'
                    }`}
                  >
                    Modify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Capture the placement for undo before removing it.
                      const removed = p.item;
                      const removedDate = p.date;
                      removeItem(removedDate, removed.id);
                      showUndoToast(
                        `Removed “${draft.title}” from ${formatDate(removedDate)}`,
                        () => restoreItem(removedDate, removed),
                      );
                      // If the placement we were editing is the one removed, reset
                      // the form to "add new" so it doesn't target a gone item.
                      if (editingPlacementId === p.item.id) startAddingNew();
                    }}
                    aria-label={`Remove from ${formatDate(p.date)}`}
                    className="shrink-0 inline-flex items-center justify-center min-h-tap min-w-tap rounded-r1 text-ink-mid hover:text-[color:hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.08)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={startAddingNew}
              aria-pressed={editingPlacementId === null}
              className={`chip w-full min-h-tap justify-center gap-1.5 px-3 border-dashed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                editingPlacementId === null
                  ? 'border-[color:hsl(var(--accent))] text-ink-hi bg-[rgb(62_216_255_/_0.10)]'
                  : 'text-ink-lo hover:bg-white/5 hover:text-ink-hi'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add to another day
            </button>
          </div>
        )}

        <div className="space-y-4">
          {/* Custom mode: editable Title + Location. Source mode keeps these
              fixed in the header, so this block is only rendered for custom mode. */}
          {isCustom && (
            <>
              <div>
                <label htmlFor={titleFieldId} className="pr pr--lo mb-1 block">Title *</label>
                <input
                  id={titleFieldId}
                  ref={titleInputRef}
                  data-testid="add-item-title-input"
                  value={customTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomTitle(e.target.value)}
                  className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  placeholder="e.g., Ramen Nagi"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor={locationFieldId} className="pr pr--lo mb-1 block">Location</label>
                <input
                  id={locationFieldId}
                  data-testid="add-item-location-input"
                  value={customLocation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomLocation(e.target.value)}
                  className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  placeholder="e.g., Shinjuku"
                  autoComplete="off"
                />
              </div>
              {/* Google Maps research link-out. Disabled until Title is
                  non-empty; a URL, not an API — no key, no quota. */}
              {mapsUrl ? (
                <a
                  href={mapsUrl}
                  data-testid="add-item-maps-link"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chip min-h-tap w-full justify-center gap-2 px-3 text-[color:hsl(var(--accent))] border-[color:hsl(var(--accent))] transition-colors hover:bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  Search on Google Maps
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  data-testid="add-item-maps-link"
                  className="chip chip--hollow min-h-tap w-full justify-center gap-2 px-3 cursor-not-allowed select-none"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  Search on Google Maps
                  <span className="sr-only"> — add a title first</span>
                </span>
              )}
            </>
          )}

          {/* Date select */}
          <div>
            <label htmlFor={dateFieldId} className="pr pr--lo mb-1 block">Date *</label>
            <select
              id={dateFieldId}
              ref={firstFieldRef}
              data-testid="add-item-day-select"
              value={selectedDate}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedDate(e.target.value)}
              className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {TRIP_DATES.map((d) => (
                <option key={d} value={d} className="bg-surface text-ink-hi">
                  {dateOptionLabel(d)}
                </option>
              ))}
            </select>
          </div>

          {/* Category grid (same pattern as ItemEditor) */}
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

          {/* Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={timeFieldId} className="pr pr--lo mb-1 block">Time</label>
              <TimePicker id={timeFieldId} value={startMinutes} onChange={handleTimeChange} testId="add-item-time-input" />
            </div>
            <div>
              <label htmlFor={durationFieldId} className="pr pr--lo mb-1 block">Duration (min)</label>
              <DurationField id={durationFieldId} value={durationMinutes} onChange={handleDurationChange} testId="add-item-duration-input" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor={notesFieldId} className="pr pr--lo mb-1 block">Notes</label>
            <textarea id={notesFieldId} value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} className="w-full min-h-tap px-3 py-2 rounded-r1 bg-[rgb(var(--surface))] border-hair border-[color:var(--border-ui)] text-t-body text-ink-hi placeholder:text-ink-lo outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none resize-none" placeholder="Additional notes..." />
          </div>
        </div>
        </div>

        {/* Pinned action footer — OUTSIDE the scroll area, so the confirm button is
            ALWAYS visible and clickable at any viewport height. The top
            border + panel bg give a clean divider so scrolled content doesn't bleed
            under it. */}
        <div className="shrink-0 px-5 sm:px-6 pt-4 pb-5 sm:pb-6 border-t-2 border-[color:hsl(var(--border))]">
          {/* D-316 — the refusal, INSIDE the pinned footer so it is visible without
              scrolling on a short viewport. A blocked user action → `role="alert"`
              (assertive), never `role="status"`. Height reserved so the footer never
              jumps; focus is not moved (it is already on the confirm button). */}
          <p
            role="alert"
            data-testid="add-item-clash-error"
            className="err mb-3 min-h-[1rem] text-t-sm"
          >
            {clashError}
          </p>
          <button
            ref={confirmRef}
            onClick={handleConfirm}
            data-testid="add-item-confirm"
            disabled={confirmDisabled}
            className="btn w-full px-4 focus-visible:outline-none"
          >
            <Check className="w-4 h-4" />
            {editingPlacementId ? 'Update plan' : 'Add to plan'}
          </button>
        </div>
      </m.div>
    </m.div>,
    document.body,
  );
}
