// @vitest-environment jsdom
//
// The sign-out dialog. `signOut()` -> `wipeAllTripData()` clears key 28 (the account id); since
// D-660 the username and password restore it, so the teardown runs in one step and the Firebase
// Auth session goes with it.
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
const session = vi.hoisted(() => ({ password: true }));
vi.mock('@/lib/firebase-remote', () => ({
  clearRemoteCache,
  isPasswordSession: async () => session.password,
}));
const flushAllDomains = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/hooks/use-domain-sync', () => ({ flushAllDomains }));
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0)); // the session check
  });
}

const click = async (id: string) => {
  await act(async () => {
    at<HTMLElement>(id)!.click();
  });
};

beforeEach(() => {
  session.password = true;
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

describe('SignOutConfirm — an anonymous session keeps the key step (D-660)', () => {
  beforeEach(() => {
    window.localStorage.setItem(SYNC_KEY, CODE);
    session.password = false;
  });

  it('shows the key first, and the sign-out keeps the anonymous uid', async () => {
    clearRemoteCache.mockClear();
    await mount();
    expect(at('t-confirm')!.textContent).toBe('Show my key');
    expect(at('t-dialog')!.textContent).not.toContain('username and password still');

    await click('t-confirm');
    expect(at('t-key-value')!.textContent).toBe(CODE);
    expect(window.localStorage.getItem(SYNC_KEY)).toBe(CODE); // nothing wiped yet
    expect(at<HTMLButtonElement>('t-key-confirm')!.disabled).toBe(true);

    await act(async () => {
      at<HTMLInputElement>('t-key-ack')!.click();
    });
    await click('t-key-confirm');
    expect(clearRemoteCache).toHaveBeenLastCalledWith({ signOutAuth: false });
    expect(window.localStorage.getItem(SYNC_KEY)).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('"Forget this device" still drops the anonymous session', async () => {
    clearRemoteCache.mockClear();
    await mount({ forgetDevice: true });
    await click('t-confirm');
    await act(async () => {
      at<HTMLInputElement>('t-key-ack')!.click();
    });
    await click('t-key-confirm');
    expect(clearRemoteCache).toHaveBeenLastCalledWith({ signOutAuth: true });
  });

  it('a dormant build has no account server, so no key step', async () => {
    remoteGate.on = false;
    try {
      await mount();
      expect(at('t-confirm')!.textContent).toBe('Sign out');
    } finally {
      remoteGate.on = true;
    }
  });
});

describe('SignOutConfirm — password session (D-660)', () => {
  beforeEach(() => window.localStorage.setItem(SYNC_KEY, CODE));

  it('signs out in one step: the password gets back in, so there is no key to show first', async () => {
    clearRemoteCache.mockClear();
    await mount();
    expect(at('t-confirm')!.textContent).toBe('Sign out');
    await click('t-confirm');

    expect(at('t-key-value')).toBeNull();
    expect(clearRemoteCache).toHaveBeenLastCalledWith({ signOutAuth: true });
    expect(window.localStorage.getItem(SYNC_KEY)).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(NAME_KEY)).toBeNull();
  });

  it('cancelling leaves every byte intact', async () => {
    await mount();
    await click('t-cancel');
    expect(window.localStorage.getItem(SYNC_KEY)).toBe(CODE);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('Uttam');
  });
});

describe('SignOutConfirm — teardown', () => {
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

  // #571 — the Firestore cache goes too. D-660: both sign-outs end the Firebase Auth session, or
  // the next person on the device would inherit a password account.
  it('clears the remote cache AND signs out of Firebase Auth, for both sign-outs', async () => {
    clearRemoteCache.mockClear();
    await mount();
    await click('t-confirm');
    expect(clearRemoteCache).toHaveBeenLastCalledWith({ signOutAuth: true });
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

  // #748: queued edits get a chance to land before the wipe, but a hung network can't hold it.
  it('waits for the outbox flush before clearing anything, and says so', async () => {
    clearRemoteCache.mockClear();
    let release!: () => void;
    flushAllDomains.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await mount();
    await click('t-confirm');
    expect(at('t-flushing')!.textContent).toContain('Syncing');
    expect(clearRemoteCache).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('Uttam');
    await act(async () => release());
    expect(clearRemoteCache).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('gives up on a flush that never settles after 8s', async () => {
    flushAllDomains.mockImplementationOnce(() => new Promise<void>(() => {}));
    await mount();
    vi.useFakeTimers();
    try {
      await click('t-confirm');
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe('Uttam');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
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

  it('the copy points back to the username and password, not to a key', async () => {
    await mount();
    const copy = at('t-dialog')!.textContent ?? '';
    expect(copy).toContain('username and password');
    expect(copy).not.toMatch(/key/);
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

  it('counts a journal day waiting to push (#631)', async () => {
    window.localStorage.setItem(
      'nepal_japan_journal_sync',
      JSON.stringify({ '2026-12-11': { hlc: 'a', dirty: true }, '2026-12-12': { hlc: 'b' } }),
    );
    await mount();
    expect(at(`t-unsynced`)!.textContent).toBe('1 change on this device hasn\'t synced yet and will be lost.');
  });

  it('counts a person pref not yet on the account (#672)', async () => {
    window.localStorage.setItem(
      'nepal_japan_person_prefs',
      JSON.stringify({ homeCurrency: { v: 'EUR', hlc: 'a', dirty: true }, units: { v: 'metric', hlc: 'b' } }),
    );
    await mount();
    expect(at('t-unsynced')!.textContent).toBe('1 change on this device hasn\'t synced yet and will be lost.');
  });

  it('sums journal days across the default pack and a known custom trip', async () => {
    window.localStorage.setItem('nepal_japan_journal_sync', JSON.stringify({ '2026-12-11': { hlc: 'a', dirty: true } }));
    window.localStorage.setItem(
      'tripPlannerKnownTrips',
      JSON.stringify([{ id: 'trip-x', name: 'Other trip', joinedAt: 1 }]),
    );
    window.localStorage.setItem(
      'trip:trip-x:journalSync',
      JSON.stringify({ '2026-12-01': { hlc: 'b', dirty: true }, '2026-12-02': { hlc: 'c', dirty: true } }),
    );
    await mount();
    expect(at('t-unsynced')!.textContent).toBe('3 changes on this device haven\'t synced yet and will be lost.');
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
