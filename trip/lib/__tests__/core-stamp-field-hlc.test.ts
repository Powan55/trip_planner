import { describe, it, expect } from 'vitest';
import { stampFieldHlc, stampSyncUpdated } from '@/core/sync/stamp';
import type { ItineraryItem } from '@/lib/trip-data';

/** #847, D-705 — an edit claims only the field groups whose value actually changed. */
describe('stampFieldHlc — stamps changed groups only', () => {
  const prev: ItineraryItem = {
    id: 'x',
    title: 'Dinner',
    category: 'food',
    time: '19:00',
    startMinutes: 1140,
    notes: 'old',
    rev: 1,
    hlc: '0000000000100-0000-A',
  };
  const edit = (patch: Partial<ItineraryItem>) =>
    stampSyncUpdated({ ...prev, ...patch }, 200, 'B');

  it('a notes-only edit claims notes and leaves every other group at its pre-edit key', () => {
    const next = edit({ notes: 'new' });
    const fh = stampFieldHlc(prev, next);
    expect(fh.notes).toBe(next.hlc);
    for (const g of ['title', 'time', 'duration', 'location']) expect(fh[g]).toBe(prev.hlc);
  });

  it('a whole-form save with unchanged values claims nothing', () => {
    const next = edit({ title: prev.title, time: prev.time, startMinutes: prev.startMinutes, notes: prev.notes });
    const fh = stampFieldHlc(prev, next);
    for (const g of ['title', 'time', 'duration', 'notes', 'location']) expect(fh[g]).toBe(prev.hlc);
  });

  it('a time edit claims the time group via either of its keys', () => {
    const next = edit({ startMinutes: 1200 });
    expect(stampFieldHlc(prev, next).time).toBe(next.hlc);
  });

  it('keeps an already-stamped group untouched by the edit', () => {
    const stamped = { ...prev, fieldHlc: { notes: '0000000000150-0000-A' } };
    const next = stampSyncUpdated({ ...stamped, title: 'Lunch' }, 200, 'B');
    const fh = stampFieldHlc(stamped, next);
    expect(fh.title).toBe(next.hlc);
    expect(fh.notes).toBe('0000000000150-0000-A');
  });
});
