'use client';

// pure-move extraction from calendar-planner.tsx: the drag-and-drop WIRING — sensors,
// the active-drag id, and the reorder / move-between-days handlers. Zero behavior change: the
// exact same logic, lifted verbatim behind a hook so the calendar component is a thin consumer.
// The DndContext / SortableContext / DragOverlay JSX stays in calendar-planner.tsx; this owns
// only the state + event handlers those wrappers are wired to.

import { useState } from 'react';
import {
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  Announcements, DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { DayPlan, ItineraryItem, formatDateLong } from '@/lib/trip-data';

interface CalendarDndDeps {
  plans: DayPlan[];
  getDayPlan(date: string): DayPlan;
  moveItem(itemId: string, fromDate: string, toDate: string): void;
  reorderItems(date: string, orderedIds: string[]): void;
}

// Screen-reader text for keyboard drags. dnd-kit's default reads the raw ids (item UUIDs, and
// `day-<date>` for the day droppable); resolve both to something a person can hear.
export function makeAnnouncements(plans: DayPlan[]): Announcements {
  const name = (id: UniqueIdentifier | undefined): string => {
    const s = String(id ?? '');
    if (s.startsWith('day-')) return formatDateLong(s.slice(4));
    const hit = plans.flatMap((p) => p.items ?? []).find((i) => i.id === s);
    return hit?.title || 'item';
  };
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${name(active.id)} is over ${name(over.id)}.` : `${name(active.id)} is no longer over a drop area.`,
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} was dropped over ${name(over.id)}.` : `${name(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Dragging was cancelled. ${name(active.id)} was returned to its place.`,
  };
}

export function useCalendarDnd({ plans, getDayPlan, moveItem, reorderItems }: CalendarDndDeps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  // No-op today: one DroppableDay + one SortableContext (both at selectedDate) means overId can
  // only ever be the active day, so there is no cross-day case for onDragOver to handle. See the
  // UNREACHABLE note on handleDragEnd's cross-day branch below if a second day container ships.
  const handleDragOver = (_event: DragOverEvent) => {};

  const handleDragCancel = () => setActiveId(null);

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
          // UNREACHABLE: one SortableContext + one DroppableDay, both at selectedDate,
          // so active and over always resolve to the SAME day. Kept for shape only. If a multi-day
          // drop target ever ships, splice the id moveItem RETURNS — under sync it mints a fresh one
          // and reorderItems drops any id not listed.
          orderedIds.splice(insertAt, 0, item.id);
          moveItem(activeIdStr, activeDate, overDate);
          reorderItems(overDate, orderedIds);
        }
      }
    }
  };

  const activeItem = activeId ? plans.flatMap((p) => p.items ?? []).find((i: ItineraryItem) => i.id === activeId) : null;

  return { sensors, announcements: makeAnnouncements(plans), activeId, activeItem, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel };
}
