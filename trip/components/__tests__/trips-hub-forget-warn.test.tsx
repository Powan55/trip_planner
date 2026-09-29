// @vitest-environment jsdom
//
// #712 — forgetting a trip wipes its outbox, journal queue and photos, so the confirm must say so.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/lib/trips-remote', () => ({
  seedAccountDocs: async () => {},
  pushTripList: async () => {},
  pushTripMeta: async () => {},
  fetchTripMeta: async () => undefined,
  subscribeTripList: () => () => {},
  createTripDoc: async () => {},
}));

import TripsHub from '@/components/trips-hub';
import { joinTrip, unsyncedEditCountFor, localPhotoCountFor } from '@/core/trips/registry';
import { keyForTrip } from '@/core/storage/gateway';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRIP_TOKEN = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const OTHER_TOKEN = 'b1b2c3d4-e5f6-4789-a012-3456789abcde';

const photo = (id: string) => ({ id, owner: { kind: 'expense', expenseId: 'e1' }, w: 1, h: 1, bytes: 1 });

function seed(id: string, edits: number, photos: number): void {
  const dirty = edits > 0 ? { itinerary: Array.from({ length: edits - 1 }, (_, i) => `c${i}`) } : {};
  localStorage.setItem(keyForTrip(id, 'syncOutbox'), JSON.stringify({ version: 1, dirty }));
  if (edits > 0) localStorage.setItem(keyForTrip(id, 'journalSync'), JSON.stringify({ '2026-12-01': { dirty: true } }));
  if (photos > 0) {
    localStorage.setItem(keyForTrip(id, 'photos'), JSON.stringify(Array.from({ length: photos }, (_, i) => photo(`p${i}`))));
  }
}

let container: HTMLDivElement;
let root: Root;

const at = <T extends HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-testid="${id}"]`);

async function openForget(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TripsHub />);
  });
  await act(async () => {
    at<HTMLButtonElement>('trips-hub-forget-1')!.click();
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tripPlannerToken', 'Uttam');
  localStorage.setItem('tripPlannerUserName', 'Uttam');
  localStorage.setItem('tripPlannerSyncCode', 'already-has-one');
  joinTrip(TRIP_TOKEN, 'Shared trip');
  joinTrip(OTHER_TOKEN, 'Other trip');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined as unknown as Root;
});

describe('per-trip loss counts', () => {
  it('count only that trip: outbox chunks plus journal days, and stored photos', () => {
    seed(TRIP_TOKEN, 3, 2);
    seed(OTHER_TOKEN, 5, 4);
    expect(unsyncedEditCountFor(TRIP_TOKEN)).toBe(3); // 2 outbox chunks + 1 journal day
    expect(localPhotoCountFor(TRIP_TOKEN)).toBe(2);
    expect(unsyncedEditCountFor('never-seen')).toBe(0);
    expect(localPhotoCountFor('never-seen')).toBe(0);
  });
});

describe('trips-hub forget confirm', () => {
  it('names the unsynced edits and local photos', async () => {
    seed(TRIP_TOKEN, 3, 2);
    await openForget();
    const dialog = at('trips-hub-forget-confirm')!;
    expect(at('trips-hub-forget-unsynced')!.textContent).toBe("3 changes on this device haven't synced yet and will be lost.");
    expect(at('trips-hub-forget-photos')!.textContent).toBe('2 photos stored on this device will be deleted.');
    expect(dialog.textContent).not.toContain('add it back any time');
  });

  it('shows no counts when there is nothing to lose', async () => {
    await openForget();
    expect(at('trips-hub-forget-confirm')).not.toBeNull();
    expect(at('trips-hub-forget-unsynced')).toBeNull();
    expect(at('trips-hub-forget-photos')).toBeNull();
  });
});
