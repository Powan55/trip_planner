// @vitest-environment jsdom
//
// #547 — copy/copyToken swallowed a rejected clipboard write and left the user with no feedback
// and nothing to copy by hand. When the write rejects, the row must show an alert plus the raw
// value in a selectable field.

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
import { joinTrip } from '@/core/trips/registry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRIP_TOKEN = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

let container: HTMLDivElement;
let root: Root;

const at = <T extends HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-testid="${id}"]`);

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TripsHub />);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('tripPlannerToken', 'Uttam');
  window.localStorage.setItem('tripPlannerUserName', 'Uttam');
  window.localStorage.setItem('tripPlannerSyncCode', 'already-has-one');
  joinTrip(TRIP_TOKEN, 'Shared trip');
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('trips-hub — clipboard write failure', () => {
  it('shows an alert and the raw Trip Token when copyToken fails', async () => {
    await mount();
    await act(async () => {
      at<HTMLButtonElement>('trips-hub-copy-token-1')!.click();
    });
    expect(at('trips-hub-copy-error-1')).not.toBeNull();
    expect(at<HTMLInputElement>('trips-hub-copy-fallback-1')!.value).toBe(TRIP_TOKEN);
  });

  it('shows an alert and the raw link when copyLink fails', async () => {
    await mount();
    await act(async () => {
      at<HTMLButtonElement>('trips-hub-copy-1')!.click();
    });
    expect(at('trips-hub-copy-error-1')).not.toBeNull();
    expect(at<HTMLInputElement>('trips-hub-copy-fallback-1')!.value).toContain(TRIP_TOKEN);
  });
});
