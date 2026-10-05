import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { DayPlan } from '@/lib/trip-data';
import { useCalendarDnd } from '@/hooks/use-calendar-dnd';

it('clears the active drag without moving or reordering items on cancel', async () => {
  const plans = [{ date: '2026-12-20', items: [{ id: 'ramen', title: 'Ramen' }] }] as DayPlan[];
  const moveItem = vi.fn();
  const reorderItems = vi.fn();
  let dnd!: ReturnType<typeof useCalendarDnd>;
  function Harness() {
    dnd = useCalendarDnd({ plans, getDayPlan: () => plans[0], moveItem, reorderItems });
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => dnd.handleDragStart({ active: { id: 'ramen' } } as never));
    expect(dnd.activeId).toBe('ramen');
    expect(dnd.activeItem?.title).toBe('Ramen');
    await act(async () => dnd.handleDragCancel());
    expect(dnd.activeId).toBeNull();
    expect(dnd.activeItem).toBeNull();
    expect(moveItem).not.toHaveBeenCalled();
    expect(reorderItems).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
