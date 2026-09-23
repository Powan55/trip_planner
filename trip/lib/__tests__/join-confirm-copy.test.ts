// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { REPLACE_LOCAL_PLAN_COPY, replaceLocalPlanCopy } from '@/core/trips/registry';

// #526 — the join-replaces-plan confirm names how many unsynced edits the default pack's
// outbox is about to drop.
describe('replaceLocalPlanCopy (#526)', () => {
  beforeEach(() => localStorage.clear());

  it('is the base copy when the default pack has no queued edits', () => {
    expect(replaceLocalPlanCopy()).toBe(REPLACE_LOCAL_PLAN_COPY);
  });

  it('names the count, singular and plural, across every dirty domain', () => {
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-10'] } }),
    );
    expect(replaceLocalPlanCopy()).toBe(`${REPLACE_LOCAL_PLAN_COPY} 1 unsynced edit on this device will be lost.`);

    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-10'], expenses: ['nepal'] } }),
    );
    expect(replaceLocalPlanCopy()).toBe(`${REPLACE_LOCAL_PLAN_COPY} 2 unsynced edits on this device will be lost.`);
  });
});
