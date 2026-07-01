'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import { toast } from 'sonner';
import {
  MapPin, UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Plane, Hotel, Coffee, Music, X, Check, Trash2, Plus,
} from 'lucide-react';
import {
  TRIP_DATES, getCountryForDate, formatDate,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS,
} from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { useItineraryContext } from '@/components/itinerary-provider';
import type { ItineraryDraft } from '@/lib/itinerary-adapter';

/**
 * Shared "Add to plan" dialog — a NEW, lightweight, source-aware dialog
 * deliberately separate from the calendar's `ItemEditor`. It is invoked from any
 * place card (via `add-to-plan-button.tsx`) with a prefilled `ItineraryDraft`
 * and the place's current `existingPlacements` (from `findPlacements`).
 *
 * It reads/writes the itinerary THROUGH the store (`useItineraryContext`, )
 * no add/remove callbacks per call site. The CustomEvent fan-out makes the
 * calendar / dashboard / card reflect every change immediately.
 *
 * A11y / focus reuses the EXACT contract that `ItemEditor` uses
 * role="dialog" aria-modal aria-labelledby
 * document-level Esc via an `onCloseRef` (latest-closure, bound once)
 * a lightweight Tab-trap inside the panel
 * autofocus the first field on open
 * parent-owned focus-return: the invoking button captures the trigger and
 * refocuses it on `<AnimatePresence onExitComplete>` — NOT in this dialog's
 * effect cleanup (the bug).
 * Reduced-motion is respected by framer-motion via the global reduced-motion CSS
 *Tailwind classes are static literals.
 *
 * RENDERING: the overlay is rendered through a React PORTAL to `document.body`.
 * Every trigger surface (recommendations, photography, map popup, featured) sits
 * inside a place card whose root is a framer `m.div` with an active `whileHover`
 * transform AND `overflow-hidden`. A `position: fixed` element whose ancestor is
 * transformed is positioned relative to that ancestor (the CSS containing-block rule),
 * not the viewport — so rendered inline, the backdrop covered only the card (neighbours
 * stayed bright) and the panel overflowed and was clipped by the card's `overflow-hidden`,
 * hiding the pinned footer. The portal moves ONLY the DOM node out to `<body>`; the React
 * tree (and the parent `AnimatePresence`) is unchanged, so the focus contract —
 * document-level Esc, the `panelRef` Tab-trap, first-field autofocus, and parent-owned
 * focus-return on `onExitComplete` — all keep working. The portal is mount-guarded
 * (`mounted` state) so it never touches `document` during the static-export prerender
 * (`output: 'export'`); the dialog only mounts on a user click, post-hydration, so this
 * is always satisfied in practice.
 */

const CATEGORY_ICON_MAP: Record<ItineraryCategory, React.ReactNode> = {
  sightseeing: <MapPin className="w-3.5 h-3.5" />,
  food: <UtensilsCrossed className="w-3.5 h-3.5" />,
  photography: <Camera className="w-3.5 h-3.5" />,
  shopping: <ShoppingBag className="w-3.5 h-3.5" />,
  nature: <Trees className="w-3.5 h-3.5" />,
  cultural: <Landmark className="w-3.5 h-3.5" />,
  transportation: <Plane className="w-3.5 h-3.5" />,
  hotel: <Hotel className="w-3.5 h-3.5" />,
  free: <Coffee className="w-3.5 h-3.5" />,
  nightlife: <Music className="w-3.5 h-3.5" />,
};

const ALL_CATEGORIES: ItineraryCategory[] = ['sightseeing', 'food', 'photography', 'shopping', 'nature', 'cultural', 'transportation', 'hotel', 'free', 'nightlife'];

// Build the date-select option label: "Tue, Dec 12 · Kathmandu, Nepal".
function dateOptionLabel(dateStr: string): string {
  const country = getCountryForDate(dateStr);
  const city = country === 'nepal' ? 'Kathmandu' : 'Tokyo';
  const countryName = country === 'nepal' ? 'Nepal' : 'Japan';
  return `${formatDate(dateStr)} · ${city}, ${countryName}`;
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
}

export default function AddToItineraryDialog({
  open,
  draft,
  existingPlacements,
  onClose,
}: AddToItineraryDialogProps) {
  const { addItem, updateItem, removeItem } = useItineraryContext();

  // Portal mount guard. `createPortal(…, document.body)` must not run during the
  // static-export prerender, so we only portal after the component has mounted on the
  // client. The dialog only ever mounts on a user click (post-hydration), so this is
  // satisfied immediately on open; it exists purely to keep `document` untouched on the
  // server and to keep tsc/SSR honest.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Live ref to the latest onClose so the once-registered Esc listener always
  // calls the current closure without re-binding every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Form state. Default the date to the first placement (modify mode) else the
  // first trip date (add mode). Category/time/duration/notes prefill from the
  // draft, then from the placement being modified if one is selected.
  const [selectedDate, setSelectedDate] = useState<string>(TRIP_DATES[0]);
  const [time, setTime] = useState<string>('');
  const [category, setCategory] = useState<ItineraryCategory>(draft.category);
  const [duration, setDuration] = useState<string>(draft.duration ?? '');
  const [notes, setNotes] = useState<string>(draft.notes ?? '');

  // In modify mode the user works on one existing placement at a time. Its
  // {date,itemId} is the modify target; null = "add a new placement".
  const [editingPlacementId, setEditingPlacementId] = useState<string | null>(null);

  // Re-seed the form whenever the dialog (re)opens or its draft changes, so a
  // reused dialog instance never shows stale values from a prior open.
  useEffect(() => {
    if (!open) return;
    setSelectedDate(TRIP_DATES[0]);
    setTime('');
    setCategory(draft.category);
    setDuration(draft.duration ?? '');
    setNotes(draft.notes ?? '');
    setEditingPlacementId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.sourceId]);

  // Stable, collision-free ids for label/aria wiring.
  const baseId = useId();
  const titleId = `${baseId}-modal-title`;
  const dateFieldId = `${baseId}-date`;
  const timeFieldId = `${baseId}-time`;
  const durationFieldId = `${baseId}-duration`;
  const notesFieldId = `${baseId}-notes`;
  const categoryLabelId = `${baseId}-category-label`;

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const isModifyMode = existingPlacements.length > 0;

  // Load a placement's values into the form so the user can change its date/time
  // (and category/duration/notes). Selecting a placement switches the confirm
  // action to "update in place".
  const startEditingPlacement = (placement: ExistingPlacement) => {
    setEditingPlacementId(placement.item.id);
    setSelectedDate(placement.date);
    setTime(placement.item.time ?? '');
    setCategory(placement.item.category);
    setDuration(placement.item.duration ?? '');
    setNotes(placement.item.notes ?? '');
  };

  // Reset the form back to "add a new placement" (clears the modify target).
  const startAddingNew = () => {
    setEditingPlacementId(null);
    setSelectedDate(TRIP_DATES[0]);
    setTime('');
    setCategory(draft.category);
    setDuration(draft.duration ?? '');
    setNotes(draft.notes ?? '');
  };

  const handleConfirm = () => {
    const patch = {
      title: draft.title,
      location: draft.location,
      category,
      time: time || undefined,
      duration: duration || undefined,
      notes: notes || undefined,
      sourceId: draft.sourceId,
      sourceType: draft.sourceType,
    };

    if (editingPlacementId) {
      // Modify an existing placement. If the date is unchanged, update in place
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
      // Add a brand-new placement (fresh per-placement id; shared sourceId, ).
      addItem(selectedDate, { ...patch, id: generateItemId() });
      toast.success(`Added “${draft.title}” to ${formatDate(selectedDate)}`);
    }
    onClose();
  };

  // On open: focus the first field (the date select). The native control's focus
  // re-asserts shortly after, in case the open animation steals it.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        firstFieldRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full max-w-md glass-card-dark rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Non-scrolling header — stays pinned at the top of the panel. */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 shrink-0">
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-lg font-bold text-white leading-tight">
              {isModifyMode ? 'Update plan' : 'Add to plan'}
            </h3>
            <p className="text-sm text-white/60 mt-0.5 truncate">{draft.title}</p>
            {draft.location && (
              <p className="text-xs text-white/30 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{draft.location}</span>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body — the only scroll region. `min-h-0` lets it shrink inside
            the flex column so the pinned footer is never pushed off-screen on short
            viewports (fix). A native scrollbar (no `scrollbar-hide`) makes the
            overflow discoverable when the content is taller than the viewport. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6">
        {/* Existing placements (modify/remove mode) */}
        {isModifyMode && (
          <div className="mb-5 space-y-2">
            <span className="text-xs text-white/50 block">Already planned</span>
            {existingPlacements.map((p) => {
              const isEditing = p.item.id === editingPlacementId;
              return (
                <div
                  key={p.item.id}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border transition-colors ${
                    isEditing ? 'bg-gold-500/15 border-gold-400/40' : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/90 truncate">{formatDate(p.date)}</p>
                    <p className="text-xs text-white/40 truncate">
                      {getCountryForDate(p.date) === 'nepal' ? 'Kathmandu, Nepal' : 'Tokyo, Japan'}
                      {p.item.time ? ` · ${p.item.time}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEditingPlacement(p)}
                    aria-pressed={isEditing}
                    className="shrink-0 px-2.5 py-1 rounded-lg text-xs text-white/70 bg-white/5 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                  >
                    Modify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeItem(p.date, p.item.id);
                      toast.success(`Removed “${draft.title}” from ${formatDate(p.date)}`);
                      // If the placement we were editing is the one removed, reset
                      // the form to "add new" so it doesn't target a gone item.
                      if (editingPlacementId === p.item.id) startAddingNew();
                    }}
                    aria-label={`Remove from ${formatDate(p.date)}`}
                    className="shrink-0 p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/20 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
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
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                editingPlacementId === null
                  ? 'border-gold-400/40 text-gold-400 bg-gold-400/5'
                  : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add to another day
            </button>
          </div>
        )}

        <div className="space-y-4">
          {/* Date select */}
          <div>
            <label htmlFor={dateFieldId} className="text-xs text-white/50 mb-1 block">Date *</label>
            <select
              id={dateFieldId}
              ref={firstFieldRef}
              value={selectedDate}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
            >
              {TRIP_DATES.map((d) => (
                <option key={d} value={d} className="bg-navy-900 text-white">
                  {dateOptionLabel(d)}
                </option>
              ))}
            </select>
          </div>

          {/* Category grid (same pattern as ItemEditor) */}
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

          {/* Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={timeFieldId} className="text-xs text-white/50 mb-1 block">Time</label>
              <input id={timeFieldId} value={time} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTime(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., 09:00" />
            </div>
            <div>
              <label htmlFor={durationFieldId} className="text-xs text-white/50 mb-1 block">Duration</label>
              <input id={durationFieldId} value={duration} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDuration(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., 2 hours" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor={notesFieldId} className="text-xs text-white/50 mb-1 block">Notes</label>
            <textarea id={notesFieldId} value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 resize-none" placeholder="Additional notes..." />
          </div>
        </div>
        </div>

        {/* Pinned action footer — OUTSIDE the scroll area, so the confirm button is
            ALWAYS visible and clickable at any viewport height (fix). The top
            border + panel bg give a clean divider so scrolled content doesn't bleed
            under it. */}
        <div className="shrink-0 px-5 sm:px-6 pt-4 pb-5 sm:pb-6 border-t border-white/10 bg-navy-900/40">
          <button
            onClick={handleConfirm}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none"
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
