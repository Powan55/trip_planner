import { describe, it, expect } from 'vitest';
import type { DayPlan } from '@/lib/trip-data';
import { makeAnnouncements } from '@/hooks/use-calendar-dnd';

const plans = [
  { date: '2026-12-20', items: [{ id: 'a1b2-uuid', title: 'Ramen' }, { id: 'c3d4-uuid', title: 'Museum' }] },
] as unknown as DayPlan[];
const ev = (a: string, o?: string) => ({ active: { id: a }, over: o ? { id: o } : null }) as never;

describe('calendar drag announcements', () => {
  const a = makeAnnouncements(plans);

  it('reads item titles, never ids', () => {
    expect(a.onDragStart!(ev('a1b2-uuid'))).toBe('Picked up Ramen.');
    expect(a.onDragOver!(ev('a1b2-uuid', 'c3d4-uuid'))).toBe('Ramen is over Museum.');
    expect(a.onDragEnd!(ev('a1b2-uuid', 'c3d4-uuid'))).toBe('Ramen was dropped over Museum.');
    expect(a.onDragCancel!(ev('a1b2-uuid'))).not.toContain('uuid');
  });

  it('names a day droppable by its date, not day-<date>', () => {
    const msg = a.onDragOver!(ev('a1b2-uuid', 'day-2026-12-20')) as string;
    expect(msg).toContain('Ramen is over');
    expect(msg).not.toContain('day-');
    expect(msg).toContain('20');
  });
});
