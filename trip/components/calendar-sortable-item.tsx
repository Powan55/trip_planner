'use client';

// pure-move extraction from calendar-planner.tsx: the drag-and-drop LIST subcomponents
// (the sortable row + its droppable day column) plus the local category-icon map they render.
// Zero behavior change — this is the same code, same props, same markup/testids, lifted out to
// shrink calendar-planner.tsx. The category-icon map is kept as a file-local copy to match the
// repo's existing idiom (add-to-itinerary-dialog / expense-dialog / trip-timeline each hold
// their own copy — there is no shared module), so this file has no import back into the parent.

import { useState, useRef, useId } from 'react';
import {
  Trash2, Edit3, GripVertical, Copy,
  MapPin, UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Plane, Hotel, Coffee, Music, AlertTriangle,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  TRIP_DATES, formatDate,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS,
} from '@/lib/trip-data';
import { formatRelativeTime } from '@/lib/relative-time';
import { describeItemTime } from '@/lib/item-time-display';

export const CATEGORY_ICON_MAP: Record<ItineraryCategory, React.ReactNode> = {
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

// Cross-friend attribution line: a small, muted
// "by {updatedBy} · {relative time}" under each item. Renders NOTHING when the item
// has no `updatedBy` — which is exactly the dormant / local-only-no-name case
// (attribution fields stay undefined there), so the portfolio build is unchanged.
// Static Tailwind classes; muted but contrast-safe on the card bg.
function AttributionLine({ item }: { item: ItineraryItem }) {
  if (!item.updatedBy) return null;
  const rel = formatRelativeTime(item.updatedAt);
  return (
    <p className="text-[11px] text-white/40 mt-1 truncate">
      by {item.updatedBy}
      {rel ? ` · ${rel}` : ''}
    </p>
  );
}

// Sortable Item
export function SortableItem({ item, date, clashes, selectMode, selected, highlighted, mapVisible, hasMarker, onToggleSelect, onEdit, onDelete, onDuplicate, onLocate }: { item: ItineraryItem; date: string; clashes: boolean; selectMode: boolean; selected: boolean; highlighted: boolean; mapVisible: boolean; hasMarker: boolean; onToggleSelect: () => void; onEdit: () => void; onDelete: () => void; onDuplicate: (targetDate: string) => void; onLocate: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  // duplicate-item ("same dinner, another day"): the Copy button reveals a native
  // <select> of trip days; picking one calls onDuplicate(targetDate) — a fresh-id copy of
  // this item's content lands on that day (defaults to "this day" for a one-off copy). Native
  // select = keyboard/SR-accessible with no portal or focus-trap to hand-build.
  const [dupOpen, setDupOpen] = useState(false);
  const dupSelectId = useId();

  // swipe-to-delete (touch/pen only). A horizontal left-swipe on the ROW BODY
  // (not the grip — dnd owns that, not the action buttons) past the threshold routes
  // to the SAME onDelete → delete-undo handler; the visible Delete button stays
  // as the non-gesture a11y/keyboard path. It coexists with dnd-kit + scroll cleanly:
  // • drag lives on the grip's dnd listeners only → a body swipe never starts a drag;
  // • touch-action:pan-y keeps native vertical scroll → we engage ONLY once the move
  // is horizontal-dominant (else we bail and let the browser scroll);
  // • mouse is ignored (the Delete button is the pointer path), so desktop is untouched.
  // Snap-back is an instant state reset (no transition) — reduced-motion safe by default.
  const [swipeX, setSwipeX] = useState(0);
  const swipe = useRef<{ x: number; y: number; active: boolean; dx: number } | null>(null);
  const SWIPE_DELETE_PX = 96;
  const onSwipeDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || selectMode) return;
    swipe.current = { x: e.clientX, y: e.clientY, active: false, dx: 0 };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.active) {
      // First real movement decides the gesture: vertical-dominant → release to the
      // browser (native scroll); horizontal-dominant → claim it as a swipe.
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      s.active = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort (dispatched events under test have no live pointer) */
      }
    }
    s.dx = dx;
    // Left swipe drives the delete; a right pull is resisted (×0.25) so the row barely moves.
    setSwipeX(dx < 0 ? dx : dx * 0.25);
  };
  const onSwipeEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (s && s.active && s.dx <= -SWIPE_DELETE_PX) onDelete();
    setSwipeX(0);
  };

  const dragTransform = CSS.Transform.toString(transform);
  const style = {
    transform: swipeX ? `${dragTransform ?? ''} translateX(${swipeX}px)`.trim() : (dragTransform ?? undefined),
    transition,
    opacity: isDragging ? 0.3 : swipeX < 0 ? Math.max(0.4, 1 + swipeX / 240) : 1,
  };
  const colors = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.free;
  // Display rule: effectiveStartMinutes -> AM/PM + day-country
  // badge; legacy-only `time` -> verbatim, unbadged; else nothing.
  const timeInfo = describeItemTime(item, date);

  return (
    <div ref={setNodeRef} style={style} data-testid={`calendar-item-${item.id}`} data-highlighted={highlighted ? 'true' : undefined} className={`flex items-start gap-2 p-3 rounded-xl ${colors.bg} border ${selected ? 'border-gold-400 ring-1 ring-gold-400/50' : highlighted ? 'border-gold-400/70 ring-2 ring-gold-400/70' : colors.border} group hover:scale-[1.01] transition-transform`}>
      {selectMode ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${item.title}`}
          data-testid={`calendar-item-select-${item.id}`}
          className="mt-1 h-4 w-4 shrink-0 accent-gold-500 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded"
        />
      ) : (
        <button {...attributes} {...listeners} aria-label={`Reorder ${item.title}`} className="mt-1 cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 touch-none outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded">
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <div
        className="flex-1 min-w-0"
        data-testid={`calendar-row-swipe-${item.id}`}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onSwipeDown}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeEnd}
        onPointerCancel={onSwipeEnd}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={colors.text}>{CATEGORY_ICON_MAP[item.category]}</span>
          <span className="text-sm font-medium text-white truncate">{item.title}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-white/40" data-testid={`calendar-item-time-${item.id}`}>
          {timeInfo && (
            <span>
              {timeInfo.label}
              {timeInfo.badge && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-white/55" data-testid={`calendar-item-time-badge-${item.id}`}>
                  {timeInfo.badge}
                </span>
              )}
            </span>
          )}
          {item.duration && <span>• {item.duration}</span>}
          {item.location && <span>• {item.location}</span>}
          {clashes && (
            <span
              title="Overlaps another timed item"
              aria-label="Overlaps another timed item"
              data-testid={`calendar-item-clash-${item.id}`}
              className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded-full px-1.5 py-0.5"
            >
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              Overlap
            </span>
          )}
        </div>
        {item.notes && <p className="text-xs text-white/30 mt-1 line-clamp-1">{item.notes}</p>}
        <AttributionLine item={item} />
        {dupOpen && (
          <div className="mt-2 flex items-center gap-2" data-testid={`calendar-item-duplicate-picker-${item.id}`}>
            <label htmlFor={dupSelectId} className="sr-only">{`Duplicate ${item.title} to a day`}</label>
            <select
              id={dupSelectId}
              defaultValue=""
              data-testid={`calendar-item-duplicate-select-${item.id}`}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const target = e.target.value;
                if (!target) return;
                onDuplicate(target);
                setDupOpen(false);
              }}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-surface border border-white/15 text-white text-xs outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              <option value="" disabled>Copy to day…</option>
              {TRIP_DATES.map((d) => (
                <option key={d} value={d}>{formatDate(d)}{d === date ? ' (this day)' : ''}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {/* "show on map" — a PERSISTENT (non-hover) affordance, shown only when the
          split map is open AND this item resolves to a curated marker. Sets the shared
          highlight so the map emphasizes the stop; keyboard-focusable + labelled. */}
      {mapVisible && hasMarker && (
        <button
          onClick={onLocate}
          aria-label={`Show ${item.title} on map`}
          aria-pressed={highlighted}
          data-testid={`calendar-item-locate-${item.id}`}
          className={`shrink-0 mt-0.5 p-1.5 rounded hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${highlighted ? 'text-gold-400' : 'text-white/40 hover:text-gold-400'}`}
        >
          <MapPin className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button onClick={() => setDupOpen((v) => !v)} aria-label={`Duplicate ${item.title}`} aria-expanded={dupOpen} data-testid={`calendar-item-duplicate-${item.id}`} className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><Copy className="w-3.5 h-3.5" /></button>
        <button onClick={onEdit} aria-label={`Edit ${item.title}`} data-testid={`calendar-item-edit-${item.id}`} className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><Edit3 className="w-3.5 h-3.5" /></button>
        <button onClick={onDelete} aria-label={`Delete ${item.title}`} data-testid={`calendar-item-delete-${item.id}`} className="p-1.5 rounded hover:bg-red-500/20 text-white/40 hover:text-red-400 outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

// Droppable Day Column
export function DroppableDay({ dateStr, children }: { dateStr: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateStr}` });
  return (
    <div ref={setNodeRef} className={`min-h-[60px] rounded-xl p-2 transition-colors ${isOver ? 'bg-gold-400/10 ring-1 ring-gold-400/30' : ''}`}>
      {children}
    </div>
  );
}
