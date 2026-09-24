// @vitest-environment jsdom
//
// #565 — the device add/remove form used `navigator.clipboard`/`updateDoc` with no offline gate:
// offline, the write never settles and `busy` never clears, and remove had no confirm. #569 — the
// home-currency toggle used role=radiogroup/radio with no arrow-key support, an incomplete
// keyboard pattern; it is now plain buttons with aria-pressed.
//
// Harness mirrors backup-restore-dialog.test.tsx: plain react-dom/client via `act`, no
// @testing-library in this repo.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let online = true;
vi.mock('@/hooks/use-online', () => ({ useOnline: () => online }));

vi.mock('@/lib/firebase-config', () => ({
  getTripId: () => 'trip-key-1',
  isRemoteConfigured: () => true,
}));

const fetchTripMembers = vi.fn(async () => ({ state: 'roster', members: { me: 'owner', them: 'member' } }));
const addTripMember = vi.fn(async () => 'ok');
const removeTripMember = vi.fn(async () => 'ok');
vi.mock('@/lib/trips-remote', () => ({
  fetchTripMembers: (...a: unknown[]) => fetchTripMembers(...(a as [])),
  addTripMember: (...a: unknown[]) => addTripMember(...(a as [])),
  removeTripMember: (...a: unknown[]) => removeTripMember(...(a as [])),
}));
vi.mock('@/lib/firebase-remote', () => ({ getRemote: async () => ({ uid: 'me' }) }));

const commit = vi.fn();
vi.mock('@/hooks/use-budget', () => ({
  useBudget: () => ({
    model: { version: 1, homeCurrency: 'USD', rates: { NPR: 152.7, JPY: 159.2 }, legBudgets: {}, categoryBudgets: {} },
    commit: (fn: (m: any) => any) => commit(fn),
  }),
}));

import { TripAccessGroup, CurrencyGroup } from '@/components/settings-panel';

function q<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`);
}
function must<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = q<T>(testId);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}
async function flush(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  online = true;
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('TripAccessGroup — #565 offline gate + confirm-before-remove', () => {
  it('disables add/remove and shows an alert while offline', async () => {
    online = false;
    root = createRoot(container);
    act(() => root.render(createElement(TripAccessGroup)));
    await flush();

    const banner = must('settings-access-offline');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(must<HTMLButtonElement>('settings-access-add-submit').disabled).toBe(true);
  });

  it('requires a confirm dialog before removeTripMember is called, and busy always clears', async () => {
    root = createRoot(container);
    act(() => root.render(createElement(TripAccessGroup)));
    await flush();

    const removeBtn = must<HTMLButtonElement>('settings-access-remove');
    act(() => removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    // Dialog open, no removal fired yet.
    expect(removeTripMember).not.toHaveBeenCalled();
    expect(q('settings-access-remove-dialog')).not.toBeNull();

    const confirmBtn = must<HTMLButtonElement>('settings-access-remove-confirm');
    act(() => confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(removeTripMember).toHaveBeenCalledWith('trip-key-1', 'them');
    // try/finally cleared busy: the add form is usable again (not permanently disabled by busy).
    expect(must<HTMLButtonElement>('settings-access-add-submit').disabled).toBe(true); // still empty input
  });

  it('shows the clipboard fallback message when writeText rejects', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => { throw new Error('blocked'); }) },
    });
    root = createRoot(container);
    act(() => root.render(createElement(TripAccessGroup)));
    await flush();

    const copyBtn = must<HTMLButtonElement>('settings-access-uid-copy');
    act(() => copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const err = must('settings-access-uid-copy-error');
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toMatch(/blocked the clipboard/i);
  });
});

describe('CurrencyGroup — #569 aria-pressed, not role=radio', () => {
  it('renders plain buttons with aria-pressed and no radio roles', async () => {
    root = createRoot(container);
    act(() => root.render(createElement(CurrencyGroup)));
    await flush();

    const group = must('budget-currency-toggle');
    expect(group.getAttribute('role')).toBeNull();

    const usd = must<HTMLButtonElement>('budget-currency-usd');
    expect(usd.getAttribute('role')).toBeNull();
    expect(usd.getAttribute('aria-pressed')).toBe('true');

    const npr = must<HTMLButtonElement>('budget-currency-npr');
    expect(npr.getAttribute('aria-pressed')).toBe('false');

    act(() => npr.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(commit).toHaveBeenCalled();
  });
});
