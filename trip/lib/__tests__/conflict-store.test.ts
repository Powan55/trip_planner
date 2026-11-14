// @vitest-environment jsdom
// D-801: values a sync merge drops are kept on this device and restorable as an ordinary edit.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firebaseConfigMock } from './firebase-config-mock';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

vi.mock('@/lib/firebase-config', (io) => firebaseConfigMock(io, () => true, 'nepal-japan-2026'));
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return { ...orig, itinerarySyncPort: { push: async () => {}, subscribe: () => () => {}, isConfigured: () => true } };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { mergeDays } from '@/core/sync/merge-day';
import { serialize } from '@/core/sync/hlc';
import {
  detectLosses,
  listConflicts,
  recordConflicts,
  dismissConflict,
  MAX_CONFLICTS,
} from '@/core/sync/conflict-store';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { useItinerary } from '@/hooks/use-itinerary';
import { savePlans, loadPlans } from '@/lib/itinerary-storage';

const DATE = '2027-01-05';
const stamp = (pt: number, actor: string) => serialize({ pt, ct: 0, actor });

function item(id: string, title: string, pt: number, actor: string, extra: Partial<ItineraryItem> = {}): ItineraryItem {
  const hlc = stamp(pt, actor);
  return { id, title, category: 'cultural', rev: 1, hlc, deleted: false, fieldHlc: { title: hlc, time: hlc, duration: hlc, notes: hlc, location: hlc }, ...extra } as ItineraryItem;
}
const day = (items: ItineraryItem[]): DayPlan => ({ date: DATE, city: 'x', country: 'nepal', items }) as DayPlan;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
});

describe('detectLosses', () => {
  const mine = [day([item('a', 'Mine', 100, 'Powan')])];
  const theirs = [day([item('a', 'Theirs', 200, 'Uttam')])];

  it('records the same loss whichever way the merge was folded', () => {
    const ab = detectLosses(mine, mergeDays(mine, theirs), 'Powan', 't');
    const ba = detectLosses(mine, mergeDays(theirs, mine), 'Powan', 't');
    expect(ab).toEqual(ba);
    expect(ab).toEqual([{ itemId: 'a', date: DATE, loserFields: { title: 'Mine' }, winnerActor: 'Uttam', at: 't' }]);
  });

  it('records nothing when my own edit wins, or when the other side lost', () => {
    expect(detectLosses(theirs, mergeDays(theirs, mine), 'Powan', 't')).toEqual([]);
    expect(detectLosses(mine, mergeDays(mine, [day([item('a', 'Old', 50, 'Uttam')])]), 'Powan', 't')).toEqual([]);
  });

  it('ignores a value stamped by someone else, even when a third person wins', () => {
    const uttam = [day([item('a', 'Uttam', 100, 'Uttam')])];
    const sushil = [day([item('a', 'Sushil', 200, 'Sushil')])];
    expect(detectLosses(uttam, mergeDays(uttam, sushil), 'Powan', 't')).toEqual([]);
  });

  it('stores the whole group, null for an absent key', () => {
    const t = (pt: number, actor: string, extra: Partial<ItineraryItem>) => [day([item('a', 'T', pt, actor, extra)])];
    const local = t(100, 'Powan', { time: '9am' });
    const merged = mergeDays(local, t(200, 'Uttam', { time: '10am', startMinutes: 600 }));
    expect(detectLosses(local, merged, 'Powan', 't')[0].loserFields).toEqual({ time: '9am', startMinutes: null });
  });

  it('does not count a win by my own name from another device as a conflict', () => {
    const other = [day([item('a', 'Phone', 300, 'Powan')])];
    expect(detectLosses(mine, mergeDays(mine, other), 'Powan', 't')).toEqual([]);
  });
});

describe('store', () => {
  it('returns [] on junk', () => {
    for (const raw of ['{not json', '{"a":1}', '[1,"x",null,{"itemId":1}]']) {
      localStorage.setItem(STORAGE_KEYS.conflicts, raw);
      expect(listConflicts()).toEqual([]);
    }
  });

  it('caps at the newest 50 and prunes entries whose item is gone', () => {
    const ids = Array.from({ length: MAX_CONFLICTS + 5 }, (_, i) => `i${i}`);
    const local = [day(ids.map((id) => item(id, 'Mine', 100, 'Powan')))];
    const merged = [day(ids.map((id) => item(id, 'Theirs', 200, 'Uttam')))];
    recordConflicts(local, merged, 'Powan');
    const list = listConflicts();
    expect(list).toHaveLength(MAX_CONFLICTS);
    expect(list[MAX_CONFLICTS - 1].itemId).toBe('i54');

    const gone = [day(ids.slice(5).map((id) => item(id, 'Theirs', 200, 'Uttam')).map((i) => (i.id === 'i54' ? { ...i, deleted: true } : i)))];
    recordConflicts(merged, gone, 'Powan');
    const after = listConflicts().map((e) => e.itemId);
    expect(after).not.toContain('i54');
    expect(after).toHaveLength(MAX_CONFLICTS - 1);
  });

  it('dismiss drops one entry', () => {
    recordConflicts([day([item('a', 'Mine', 1, 'Powan')])], [day([item('a', 'Theirs', 2, 'Uttam')])], 'Powan');
    dismissConflict('a');
    expect(listConflicts()).toEqual([]);
  });
});

async function restore(local: DayPlan[], remote: DayPlan[]) {
  const merged = mergeDays(local, remote);
  recordConflicts(local, merged, 'Powan');
  savePlans(merged);
  const ref: { current: ReturnType<typeof useItinerary> } = { current: null as never };
  const root = createRoot(document.createElement('div'));
  act(() => {
    root.render(createElement(() => ((ref.current = useItinerary()), null)));
  });
  let ok = false;
  await act(async () => {
    ok = ref.current.restoreConflict('a');
    await Promise.resolve();
  });
  act(() => root.unmount());
  return { ok, restored: loadPlans()[0].items.find((i) => i.id === 'a')! };
}

describe('restoreConflict', () => {
  it('applies the loser fields as a fresh edit and forgets the entry', async () => {
    const { ok, restored } = await restore(
      [day([item('a', 'Mine', 100, 'Powan')])],
      [day([item('a', 'Theirs', 200, 'Uttam')])],
    );
    expect(ok).toBe(true);
    expect(restored.title).toBe('Mine');
    expect(restored.hlc! > stamp(200, 'Uttam')).toBe(true);
    expect(listConflicts()).toEqual([]);
  });

  it('clears a key the lost group did not have', async () => {
    const { restored } = await restore(
      [day([item('a', 'T', 100, 'Powan', { time: '9am' })])],
      [day([item('a', 'T', 200, 'Uttam', { time: '10am', startMinutes: 600 })])],
    );
    expect(restored.time).toBe('9am');
    expect(restored.startMinutes).toBeUndefined();
  });
});
