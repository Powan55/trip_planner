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

  it('and the copy stops promising a key that is not there', async () => {
    await mount();
    const copy = at('t-dialog')!.textContent ?? '';
    expect(copy).toContain('There is no key stored here');
    expect(copy).not.toContain('Your key gets you back');
  });
});
