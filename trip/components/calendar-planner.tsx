'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Plus, Trash2, Edit3, GripVertical, Save,
  MapPin, UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Plane, Hotel, Coffee, Music, X, Check, ChevronLeft, ChevronRight
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragOverEvent,
  DragStartEvent, DragOverlay, useDroppable,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  TRIP_DATES, getCountryForDate, formatDate, formatDateLong,
  ItineraryItem, ItineraryCategory, CATEGORY_COLORS,
} from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { useItineraryContext } from '@/components/itinerary-provider';
import { formatRelativeTime } from '@/lib/relative-time';

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
function SortableItem({ item, onEdit, onDelete }: { item: ItineraryItem; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };
  const colors = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.free;

  return (
    <div ref={setNodeRef} style={style} className={`flex items-start gap-2 p-3 rounded-xl ${colors.bg} border ${colors.border} group hover:scale-[1.01] transition-transform`}>
      <button {...attributes} {...listeners} aria-label={`Reorder ${item.title}`} className="mt-1 cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 touch-none outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded">
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={colors.text}>{CATEGORY_ICON_MAP[item.category]}</span>
          <span className="text-sm font-medium text-white truncate">{item.title}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-white/40">
          {item.time && <span>{item.time}</span>}
          {item.duration && <span>• {item.duration}</span>}
          {item.location && <span>• {item.location}</span>}
        </div>
        {item.notes && <p className="text-xs text-white/30 mt-1 line-clamp-1">{item.notes}</p>}
        <AttributionLine item={item} />
      </div>
      <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} aria-label={`Edit ${item.title}`} className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><Edit3 className="w-3.5 h-3.5" /></button>
        <button onClick={onDelete} aria-label={`Delete ${item.title}`} className="p-1.5 rounded hover:bg-red-500/20 text-white/40 hover:text-red-400 outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

// Droppable Day Column
function DroppableDay({ dateStr, children }: { dateStr: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateStr}` });
  return (
    <div ref={setNodeRef} className={`min-h-[60px] rounded-xl p-2 transition-colors ${isOver ? 'bg-gold-400/10 ring-1 ring-gold-400/30' : ''}`}>
      {children}
    </div>
  );
}

// Item Editor Modal
function ItemEditor({ item, onSave, onClose }: { item?: ItineraryItem; onSave: (item: ItineraryItem) => void; onClose: () => void }) {
  // Live ref to the latest onClose so the once-registered Esc listener always
  // calls the current closure without re-binding on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [title, setTitle] = useState(item?.title ?? '');
  const [category, setCategory] = useState<ItineraryCategory>(item?.category ?? 'sightseeing');
  const [time, setTime] = useState(item?.time ?? '');
  const [duration, setDuration] = useState(item?.duration ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');

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

  // Refs for focus management: the panel (focus-trap boundary) and the first
  // field (focused on open). Returning focus to the trigger is the parent's job
  // via AnimatePresence onExitComplete — doing it here in an effect cleanup
  // raced framer-motion's exit animation and grabbed the wrong element.
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      // Spread the original item first so additive source-linkage fields
      // (sourceId/sourceType) survive an edit of a card-created item.
      ...item,
      id: item?.id ?? generateItemId(),
      title: title.trim(),
      category,
      time: time || undefined,
      duration: duration || undefined,
      location: location || undefined,
      notes: notes || undefined,
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full max-w-md glass-card-dark rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-hide"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 id={titleId} className="font-display text-lg font-bold text-white">{item ? 'Edit Item' : 'Add Item'}</h3>
          <button type="button" onClick={onClose} aria-label="Close editor" className="p-1 rounded-lg hover:bg-white/10 text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor={titleFieldId} className="text-xs text-white/50 mb-1 block">Title *</label>
            <input id={titleFieldId} ref={titleInputRef} autoFocus value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., Visit Boudhanath Stupa" />
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
              <input id={timeFieldId} value={time} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTime(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., 09:00" />
            </div>
            <div>
              <label htmlFor={durationFieldId} className="text-xs text-white/50 mb-1 block">Duration</label>
              <input id={durationFieldId} value={duration} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDuration(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., 2 hours" />
            </div>
          </div>
          <div>
            <label htmlFor={locationFieldId} className="text-xs text-white/50 mb-1 block">Location</label>
            <input id={locationFieldId} value={location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2" placeholder="e.g., Thamel, Kathmandu" />
          </div>
          <div>
            <label htmlFor={notesFieldId} className="text-xs text-white/50 mb-1 block">Notes</label>
            <textarea id={notesFieldId} value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 resize-none" placeholder="Additional notes..." />
          </div>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none"
          >
            <Check className="w-4 h-4" />
            {item ? 'Update Item' : 'Add Item'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function CalendarPlanner() {
  // The itinerary now lives in the shared reactive store instead of
  // component-local state. `plans`/`hydrated` and the mutators come from the one
  // app-root instance, so a same-tab calendar edit propagates to the dashboard live.
  const {
    plans,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    reorderItems,
    getDayPlan,
  } = useItineraryContext();
  const [selectedDate, setSelectedDate] = useState<string>(TRIP_DATES[0]);
  const [editingItem, setEditingItem] = useState<ItineraryItem | undefined>(undefined);
  const [showEditor, setShowEditor] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'agenda'>('calendar');

  // The element focused when the editor opened (the "Add Activity" / edit
  // button), captured before the modal autofocuses, so focus returns to it once
  // the exit animation completes. See AnimatePresence onExitComplete below.
  const triggerRef = useRef<HTMLElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Load/save effects and the local getDayPlan/updateDayPlan are gone — the store
  // owns load-on-mount, the savePlans-on-write + CustomEvent fan-out, and
  // the existing-or-synthesized getDayPlan. The calendar is now a pure consumer.

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
  };

  const handleDeleteItem = (itemId: string) => {
    removeItem(selectedDate, itemId);
  };

  // Find which day an item belongs to
  const findDayForItem = (itemId: string): string | null => {
    for (const plan of plans) {
      if ((plan.items ?? []).some((i: ItineraryItem) => i.id === itemId)) {
        return plan.date;
      }
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event?.active?.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event ?? {};
    if (!over || !active) return;
    const overId = String(over.id ?? '');
    const activeId = String(active.id ?? '');

    // If dropping over a day container
    if (overId.startsWith('day-')) {
      const targetDate = overId.replace('day-', '');
      const sourceDate = findDayForItem(activeId);
      if (sourceDate && sourceDate !== targetDate) {
        // Move item between days (remove from source, append to target) — the store
        // moveItem reproduces the former two-updateDayPlan sequence atomically.
        moveItem(activeId, sourceDate, targetDate);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event ?? {};
    setActiveId(null);
    if (!over || !active) return;

    const activeIdStr = String(active.id ?? '');
    const overIdStr = String(over.id ?? '');

    if (activeIdStr === overIdStr) return;

    // Reorder within same day
    if (!overIdStr.startsWith('day-')) {
      const activeDate = findDayForItem(activeIdStr);
      const overDate = findDayForItem(overIdStr);

      if (activeDate && overDate && activeDate === overDate) {
        // Reorder within the same day: compute the new id order with arrayMove
        // (identical to the former in-place splice) and apply via reorderItems.
        const items = [...(getDayPlan(activeDate).items ?? [])];
        const oldIdx = items.findIndex((i: ItineraryItem) => i.id === activeIdStr);
        const newIdx = items.findIndex((i: ItineraryItem) => i.id === overIdStr);
        if (oldIdx >= 0 && newIdx >= 0) {
          const orderedIds = arrayMove(items, oldIdx, newIdx).map((i) => i.id);
          reorderItems(activeDate, orderedIds);
        }
      } else if (activeDate && overDate && activeDate !== overDate) {
        // Move between days, inserting at the hovered item's index (as before).
        // Compute the target's intended final id order from the current snapshot,
        // then move (append) + reorder; the store reads the freshest persisted state
        // on each commit, so these two ops compose without a stale-snapshot clobber.
        const sourcePlan = getDayPlan(activeDate);
        const item = (sourcePlan.items ?? []).find((i: ItineraryItem) => i.id === activeIdStr);
        if (item) {
          const targetItems = [...(getDayPlan(overDate).items ?? [])];
          const targetIdx = targetItems.findIndex((i: ItineraryItem) => i.id === overIdStr);
          const insertAt = targetIdx >= 0 ? targetIdx : targetItems.length;
          const orderedIds = targetItems.map((i) => i.id);
          orderedIds.splice(insertAt, 0, item.id);
          moveItem(activeIdStr, activeDate, overDate);
          reorderItems(overDate, orderedIds);
        }
      }
    }
  };

  const activeItem = activeId ? plans.flatMap((p) => p.items ?? []).find((i: ItineraryItem) => i.id === activeId) : null;

  const currentPlan = getDayPlan(selectedDate);
  const currentIdx = TRIP_DATES.indexOf(selectedDate);

  const goToPrev = () => {
    if (currentIdx > 0) setSelectedDate(TRIP_DATES[currentIdx - 1] ?? selectedDate);
  };
  const goToNext = () => {
    if (currentIdx < TRIP_DATES.length - 1) setSelectedDate(TRIP_DATES[currentIdx + 1] ?? selectedDate);
  };

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
            <div key={d} className="min-w-0 text-center text-[10px] sm:text-xs text-white/30 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="min-w-0 aspect-square" />;
            const country = getCountryForDate(date);
            const dayPlan = getDayPlan(date);
            const hasItems = (dayPlan.items?.length ?? 0) > 0;
            const isSelected = date === selectedDate;

            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                aria-pressed={isSelected}
                aria-label={`${formatDateLong(date)}${hasItems ? `, ${dayPlan.items?.length ?? 0} activities planned` : ', no activities planned'}`}
                className={`min-w-0 aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all relative outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                  isSelected
                    ? 'bg-gold-500/20 ring-2 ring-gold-400 text-white font-bold scale-105'
                    : hasItems
                      ? country === 'nepal'
                        ? 'bg-himalaya-500/10 text-himalaya-400 hover:bg-himalaya-500/20'
                        : 'bg-sakura-400/10 text-sakura-400 hover:bg-sakura-400/20'
                      : 'text-white/40 hover:bg-white/5'
                }`}
              >
                {new Date(date + 'T12:00:00').getDate()}
                {hasItems && (
                  <div className="absolute bottom-1 flex gap-0.5">
                    {(dayPlan.items ?? []).slice(0, 3).map((_: any, j: number) => (
                      <div key={j} className={`w-1 h-1 rounded-full ${country === 'nepal' ? 'bg-himalaya-400' : 'bg-sakura-400'}`} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // All items across all visible days for DnD
  const allItemIds = (currentPlan.items ?? []).map((i: ItineraryItem) => i.id);

  return (
    <section id="itinerary" aria-labelledby="itinerary-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="itinerary-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Itinerary <span className="text-gradient-gold">Planner</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">
            Plan every day of the journey. Drag items to reorder or move between days.
          </p>
        </motion.div>

        {/* View Toggle */}
        <div className="flex flex-wrap justify-center gap-2 mb-6">
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

        <div className="grid lg:grid-cols-[340px_1fr] gap-6">
          {/* Left: Calendar or Date list */}
          <div className="min-w-0">
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
                      onClick={() => setSelectedDate(date)}
                      aria-pressed={isSelected}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                        isSelected ? 'bg-gold-500/20 ring-1 ring-gold-400/30 text-white' : 'text-white/60 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${country === 'nepal' ? 'bg-himalaya-400' : 'bg-sakura-400'}`} />
                        <span>{formatDate(date)}</span>
                      </div>
                      {hasItems && <span className="text-xs text-white/30">{dayPlan.items?.length ?? 0} items</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Day Detail with DnD */}
          <div className="min-w-0 glass-card rounded-2xl p-4 sm:p-6">
            {/* Day Header */}
            <div className="flex items-center justify-between gap-1 mb-5">
              <button onClick={goToPrev} disabled={currentIdx <= 0} aria-label="Previous day" className="shrink-0 p-2 rounded-lg hover:bg-white/5 text-white/50 disabled:opacity-20 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><ChevronLeft className="w-5 h-5" /></button>
              <div className="text-center min-w-0 px-1">
                <h3 className="font-display text-base sm:text-lg font-bold text-white leading-snug">{formatDateLong(selectedDate)}</h3>
                <p className="text-xs text-white/40">
                  Day {currentIdx + 1} • {currentPlan.city}, {currentPlan.country === 'nepal' ? 'Nepal' : 'Japan'}
                </p>
              </div>
              <button onClick={goToNext} disabled={currentIdx >= TRIP_DATES.length - 1} aria-label="Next day" className="shrink-0 p-2 rounded-lg hover:bg-white/5 text-white/50 disabled:opacity-20 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"><ChevronRight className="w-5 h-5" /></button>
            </div>

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
                  <div className="space-y-2">
                    {(currentPlan.items ?? []).length === 0 ? (
                      <div className="text-center py-12">
                        <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
                        <p className="text-white/30 text-sm">No activities planned for this day</p>
                        <p className="text-white/20 text-xs mt-1">Click the button below to start planning</p>
                      </div>
                    ) : (
                      (currentPlan.items ?? []).map((item: ItineraryItem) => (
                        <SortableItem
                          key={item.id}
                          item={item}
                          onEdit={() => handleEditItem(item)}
                          onDelete={() => handleDeleteItem(item.id)}
                        />
                      ))
                    )}
                  </div>
                </SortableContext>
              </DroppableDay>

              <DragOverlay>
                {activeItem ? (
                  <div className="drag-overlay glass-card rounded-xl p-3">
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

            {/* Add Button */}
            <button
              onClick={handleAddItem}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/10 text-white/40 hover:text-gold-400 hover:border-gold-400/30 hover:bg-gold-400/5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              <Plus className="w-4 h-4" />
              Add Activity
            </button>
          </div>
        </div>
      </div>

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
            onSave={handleSaveItem}
            onClose={() => { setShowEditor(false); setEditingItem(undefined); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
