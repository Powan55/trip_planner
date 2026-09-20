// @vitest-environment jsdom
//
// The grandfathered "Finish setting up your account" mint, driven for real (createRoot + act,
// the packing-checklist harness) with `@/lib/trips-remote` faked so the seed call is observable.
//
// It used to mint a key and push ONLY `profile/tripList`. The front door validates a pasted key
// by reading `profile/identity`, so every key minted here was rejected on every other device,
// permanently — and the minting device never noticed, because it holds the key and the door skips
// the probe for a device that already has one. This pins the call site, not the helper:
// `lib/__tests__/trips-remote.test.ts` proves what `seedAccountDocs` writes, and a call site that
// quietly reverts to `pushTripList` would sail past that suite.
//
// Settings' "Create my key" (`SyncGroup.reveal`) is the same two lines against the same helper;
// it is covered end-to-end by `e2e/sync-code.spec.ts` rather than mounted here, because the
// settings panel needs the whole provider stack to render.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const seedAccountDocs = vi.fn(async (_code: string, _name?: string | null) => {});
const pushTripList = vi.fn(async (_code: string) => {});
vi.mock('@/lib/trips-remote', () => ({
  seedAccountDocs: (code: string, name?: string | null) => seedAccountDocs(code, name),
  pushTripList: (code: string) => pushTripList(code),
  pushTripMeta: async () => {},
  fetchTripMeta: async () => undefined,
  subscribeTripList: () => () => {},
}));

import TripsHub from '@/components/trips-hub';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SYNC_KEY = 'tripPlannerSyncCode';

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
  // A grandfathered traveller: an identity, and no User Token at all.
  window.localStorage.setItem('tripPlannerToken', 'Uttam');
  window.localStorage.setItem('tripPlannerUserName', 'Uttam');
  seedAccountDocs.mockClear();
  pushTripList.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('trips-hub — finishing a grandfathered account seeds BOTH docs', () => {
  it('offers the upgrade only when there is no key yet', async () => {
    await mount();
    expect(at('trips-hub-finish-account')).not.toBeNull();

    await act(async () => root.unmount());
    window.localStorage.setItem(SYNC_KEY, 'already-has-one');
    await mount();
    expect(at('trips-hub-finish-account')).toBeNull();
  });

  it('minting calls seedAccountDocs with the new key and this device’s name', async () => {
    await mount();
    await act(async () => {
      at<HTMLButtonElement>('trips-hub-finish-account-mint')!.click();
    });

    const stored = window.localStorage.getItem(SYNC_KEY);
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    expect(seedAccountDocs).toHaveBeenCalledWith(stored, 'Uttam');
    // The regression: seeding the trip list alone is what orphaned the account.
    expect(pushTripList).not.toHaveBeenCalled();
  });

  it('shows the key once, with the copy control, before anything navigates', async () => {
    await mount();
    await act(async () => {
      at<HTMLButtonElement>('trips-hub-finish-account-mint')!.click();
    });
    expect(at('trips-hub-finish-account-show-once-value')!.textContent).toBe(
      window.localStorage.getItem(SYNC_KEY),
    );
    expect(at('trips-hub-finish-account-show-once-copy')).not.toBeNull();
  });
});

// KNOWN CEILING: a source read, not a mount. `SyncGroup` is private to a panel that needs the
// itinerary/budget/expenses/docs/journal/photos providers to render, so driving its button costs
// more than the regression it guards. This pins the one line that matters — the minting branch
// must reach `seedAccountDocs`, never `pushTripList` alone. Upgrade path: export `SyncGroup`, or
// mount the panel behind the provider stack, and drive the button for real.
describe('settings-panel — "Create my key" mints through the same helper', () => {
  it('SyncGroup.reveal seeds both docs, not the trip list alone', () => {
    const src = readFileSync(resolve(__dirname, '../settings-panel.tsx'), 'utf8');
    const reveal = src.slice(src.indexOf('const reveal = ()'), src.indexOf('const copy = async ()'));
    expect(reveal).toContain('seedAccountDocs(minted, who)');
    expect(reveal).not.toContain('pushTripList');
  });
});
