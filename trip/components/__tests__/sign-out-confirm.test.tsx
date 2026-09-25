// @vitest-environment jsdom
//
// The sign-out dialog's data-loss trap. `signOut()` -> `wipeAllTripData()` clears key 28, the
// User Token — this device's ONLY copy of the account credential, which nothing can re-issue —
// while the dialog's own copy promised "your key still gets you back into your account". That is
// the mechanism that locked travellers out of the live app.
//
// Mounted for real (createRoot + act, the packing-checklist harness) with the REAL `signOut` and
// the REAL storage gateway underneath, so the assertions are about bytes on disk, not a spy.
// Radix portals the dialog to `document.body`, so every query here is against `document`.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import SignOutConfirm from '@/components/sign-out-confirm';

// jsdom has no IndexedDB; "Forget this device" clears the blob store before anything else.
vi.mock('@/core/photos/blob-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/photos/blob-store')>();
  return { ...orig, defaultBlobStore: orig.makeInMemoryBlobStore() };
});

const clearRemoteCache = vi.hoisted(() => vi.fn(async (_opts?: { signOutAuth?: boolean }) => {}));
const remoteGate = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/firebase-remote', () => ({ clearRemoteCache }));
vi.mock('@/lib/firebase-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => remoteGate.on,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SYNC_KEY = 'tripPlannerSyncCode';
const NAME_KEY = 'tripPlannerUserName';
const TOKEN_KEY = 'tripPlannerToken';
const CODE = 'aaaa1111-bbbb-4222-8333-cccc4444dddd';

let container: HTMLDivElement;
let root: Root;

const at = <T extends HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-testid="${id}"]`);

async function mount(props: { forgetDevice?: boolean } = {}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SignOutConfirm testId="t" {...props}>
        <button data-testid="t">Sign out</button>
      </SignOutConfirm>,
    );
  });
  await act(async () => {
    at<HTMLButtonElement>('t')!.click();
  });
}

const click = async (id: string) => {
  await act(async () => {
    at<HTMLElement>(id)!.click();
  });
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(TOKEN_KEY, 'Uttam');
  window.localStorage.setItem(NAME_KEY, 'Uttam');
  // The dialog reloads after teardown (Ruling 3). jsdom's `location.reload` is non-configurable,
  // so it cannot be spied — it just logs "Not implemented: navigation" and returns, which is
  // harmless here. Silence that one line rather than fight the property descriptor.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('SignOutConfirm — a stored key is shown before the wipe destroys it', () => {
  beforeEach(() => window.localStorage.setItem(SYNC_KEY, CODE));

  it('the destructive button becomes "Show my key" and does NOT tear anything down yet', async () => {
    await mount();
    expect(at('t-confirm')!.textContent).toBe('Show my key');

    await click('t-confirm');

    // The key is on screen, in full, and still on disk — nothing has been wiped.
    expect(at('t-key-value')!.textContent).toBe(CODE);
    expect(window.localStorage.getItem(SYNC_KEY)).toBe(CODE);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('Uttam');
  });

  it('the show-once confirm stays DISABLED until "I\'ve saved my key" is ticked', async () => {
    await mount();
    await click('t-confirm');
    expect(at<HTMLButtonElement>('t-key-confirm')!.disabled).toBe(true);

    await act(async () => {
      at<HTMLInputElement>('t-key-ack')!.click();
    });
    expect(at<HTMLButtonElement>('t-key-confirm')!.disabled).toBe(false);
  });

  it('only the acknowledged confirm runs the teardown — and it clears the key', async () => {
    await mount();
    await click('t-confirm');
    await act(async () => {
      at<HTMLInputElement>('t-key-ack')!.click();
    });
    await click('t-key-confirm');

    expect(window.localStorage.getItem(SYNC_KEY)).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(NAME_KEY)).toBeNull();
  });

  it('the unsynced warning does not follow onto the key step', async () => {
    window.localStorage.setItem(
      'nepal_japan_sync_outbox',
      JSON.stringify({ version: 1, dirty: { budget: ['model'] } }),
    );
    await mount();
    expect(at('t-unsynced')).not.toBeNull();
    await click('t-confirm');
    expect(at('t-unsynced')).toBeNull();
  });

  it('cancelling from the key step leaves every byte intact', async () => {
    await mount();
    await click('t-confirm');
    await click('t-cancel');

    expect(window.localStorage.getItem(SYNC_KEY)).toBe(CODE);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('Uttam');
  });

  it('"Forget this device" takes the same detour — it wipes the key too', async () => {
    await mount({ forgetDevice: true });
    expect(at('t-confirm')!.textContent).toBe('Show my key');
    await click('t-confirm');
    expect(at('t-key-value')!.textContent).toBe(CODE);
    expect(at('t-key-confirm')!.textContent).toBe('Forget this device');
  });
});

describe('SignOutConfirm — no key stored', () => {
  it('signs out in one step, with no show-once screen to sit through', async () => {
    await mount();
    expect(at('t-confirm')!.textContent).toBe('Sign out');

    await click('t-confirm');

    expect(at('t-key-value')).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  // #401 / D-503 — the lifetime keys survive every teardown except this one.
  const LIFETIME = [
    'tripPlannerLifetimeVisits',
    'tripPlannerVisitConfirmations',
    'tripPlannerPassportStamps',
  ];

  it('"Forget this device" clears the three lifetime keys', async () => {
    for (const k of LIFETIME) window.localStorage.setItem(k, '[]');
    await mount({ forgetDevice: true });
    expect(at('t-dialog')!.textContent).toContain('travel history');
    await click('t-confirm');
    for (const k of LIFETIME) expect(window.localStorage.getItem(k)).toBeNull();
  });

  it('a plain sign-out leaves them alone', async () => {
    for (const k of LIFETIME) window.localStorage.setItem(k, '[]');
    await mount();
    await click('t-confirm');
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    for (const k of LIFETIME) expect(window.localStorage.getItem(k)).toBe('[]');
  });

  // #571 — the Firestore cache goes too; only Forget this device drops the anonymous session.
  it('clears the remote cache, signing auth out only for Forget this device', async () => {
    clearRemoteCache.mockClear();
    await mount();
    await click('t-confirm');
    expect(clearRemoteCache).toHaveBeenLastCalledWith({ signOutAuth: false });
    act(() => root.unmount());
    container.remove();

    await mount({ forgetDevice: true });
    await click('t-confirm');
    expect(clearRemoteCache).toHaveBeenLastCalledWith({ signOutAuth: true });
    expect(clearRemoteCache).toHaveBeenCalledTimes(2);
  });

  it('never loads the remote module when remote is not configured', async () => {
    clearRemoteCache.mockClear();
    remoteGate.on = false;
    try {
      await mount();
      await click('t-confirm');
      expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(clearRemoteCache).not.toHaveBeenCalled();
    } finally {
      remoteGate.on = true;
    }
  });

  it('stays busy while the clear runs and ignores a second click', async () => {
    clearRemoteCache.mockClear();
    let release!: () => void;
    clearRemoteCache.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await mount();
    await click('t-confirm');
    const btn = at<HTMLButtonElement>('t-confirm')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(clearRemoteCache).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('Uttam');
    await act(async () => release());
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('and the copy stops promising a key that is not there', async () => {
    await mount();
    const copy = at('t-dialog')!.textContent ?? '';
    expect(copy).toContain('There is no key stored here');
    expect(copy).not.toContain('Your key gets you back');
  });
});

// #623 — the wipe drops any queued-but-unsynced edit; the dialog must say so before it happens.
describe('SignOutConfirm — unsynced-edit warning', () => {
  const OUTBOX_KEY = 'nepal_japan_sync_outbox';

  it('a dirty outbox shows the count in the dialog description', async () => {
    window.localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-01-01', '2026-01-02'] } }),
    );
    await mount();
    expect(at(`t-unsynced`)!.textContent).toBe('2 changes on this device haven\'t synced yet and will be lost.');
  });

  it('a single dirty chunk uses the singular form', async () => {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, dirty: { budget: ['model'] } }));
    await mount();
    expect(at(`t-unsynced`)!.textContent).toBe('1 change on this device hasn\'t synced yet and will be lost.');
  });

  it('a clean outbox shows no warning', async () => {
    await mount();
    expect(at('t-unsynced')).toBeNull();
  });

  it('sums the default pack AND a known custom trip\'s outbox', async () => {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, dirty: { budget: ['model'] } }));
    window.localStorage.setItem(
      'tripPlannerKnownTrips',
      JSON.stringify([{ id: 'trip-x', name: 'Other trip', joinedAt: 1 }]),
    );
    window.localStorage.setItem(
      'trip:trip-x:syncOutbox',
      JSON.stringify({ version: 1, dirty: { expenses: ['leg-1'] } }),
    );
    await mount();
    expect(at('t-unsynced')!.textContent).toBe('2 changes on this device haven\'t synced yet and will be lost.');
  });
});
