'use client';

// pure-move extraction from calendar-planner.tsx: the drag-and-drop WIRING — sensors,
// the active-drag id, and the reorder / move-between-days handlers. Zero behavior change: the
// exact same logic, lifted verbatim behind a hook so the calendar component is a thin consumer.
// The DndContext / SortableContext / DragOverlay JSX stays in calendar-planner.tsx; this owns
// only the state + event handlers those wrappers are wired to.

import { useState } from 'react';
import {
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverEvent, DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { DayPlan, ItineraryItem } from '@/lib/trip-data';

interface CalendarDndDeps {
  plans: DayPlan[];
  getDayPlan(date: string): DayPlan;
  moveItem(itemId: string, fromDate: string, toDate: string): void;
  reorderItems(date: string, orderedIds: string[]): void;
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

  return { sensors, activeId, activeItem, handleDragStart, handleDragOver, handleDragEnd };
}
