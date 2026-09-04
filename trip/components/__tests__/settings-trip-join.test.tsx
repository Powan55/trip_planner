// @vitest-environment jsdom
//
// Settings' "Add a trip by Trip Token" is the second door onto the same registry primitive as
// /trips. Both must refuse the account key, both must SAY so, and both must say the same thing —
// the copy is one exported constant precisely so they cannot drift. This file covers the Settings
// half; `trips-hub-join.test.tsx` covers the other, and the shared literal is asserted in both.
//
// Harness mirrors `backup-restore-dialog.test.tsx`: plain react-dom/client via `act`. The data
// hooks are mocked to their inert shapes — none of them are what is under test here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));
vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ plans: [], claimAuthorship: vi.fn(), clearAll: vi.fn() }),
}));
vi.mock('@/hooks/use-expenses', () => ({
  useExpenses: () => ({
    expenses: [],
    claimAuthorship: vi.fn(),
    clearAll: vi.fn(),
    restoreExpenses: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-docs', () => ({
  useDocs: () => ({ items: [], claimAuthorship: vi.fn(), restoreDocsChecklist: vi.fn() }),
}));
vi.mock('@/hooks/use-journal', () => ({ useJournal: () => ({ clearAll: vi.fn() }) }));
vi.mock('@/hooks/use-photos', () => ({ usePhotos: () => ({ photos: [], removePhoto: vi.fn() }) }));
// The real seeded model, not a stub — `CurrencyGroup` reads `model.homeCurrency` unguarded, and a
// null here fails the whole render for a reason that has nothing to do with this file.
vi.mock('@/hooks/use-budget', async () => {
  const { DEFAULT_BUDGET } = await import('@/core/budget/model');
  return { useBudget: () => ({ model: DEFAULT_BUDGET, commit: vi.fn(), reset: vi.fn() }) };
});
vi.mock('@/lib/firebase-config', () => ({
  getTripId: () => 'the-active-trip',
  isRemoteConfigured: () => false,
  isTripRemoteConfigured: () => false,
}));

import SettingsPanel from '@/components/settings-panel';
import { JOIN_REFUSAL_COPY } from '@/core/trips/registry';
import { setSyncCode, getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import { listKnownTrips } from '@/core/trips/registry';

const ACCOUNT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// jsdom has no navigation; this form reloads on the path that succeeds.
let restoreLocation: (() => void) | null = null;
function stubLocation() {
  const real = window.location;
  const stub = { reload: vi.fn(), assign: vi.fn(), replace: vi.fn(), href: '', origin: 'https://x.test', search: '' };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(SettingsPanel));
  });
}

const q = <T extends HTMLElement = HTMLElement>(testId: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testId}"]`);

function must<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = q<T>(testId);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

/** Type into a CONTROLLED input the way React hears it. */
function type(testId: string, value: string) {
  const input = must<HTMLInputElement>(testId);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submitJoin() {
  const button = must<HTMLButtonElement>('settings-trip-join-submit');
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('settings — pasting the account key into "Add a trip by Trip Token"', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    restoreLocation?.();
    restoreLocation = null;
    vi.restoreAllMocks();
  });

  it('is refused in place: an alert, no row, no reload', () => {
    setSyncCode(ACCOUNT);
    const location = stubLocation();
    render();

    type('settings-trip-join-input', ACCOUNT);
    submitJoin();

    const alert = must('settings-trip-join-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe(JOIN_REFUSAL_COPY['own-account-token']);

    expect(location.reload).not.toHaveBeenCalled();
    expect(listKnownTrips().map((t) => t.id)).toEqual([DEFAULT_TRIP_ID]);
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
  });

  it('the field is marked invalid and points at the message (a11y, not just colour)', () => {
    setSyncCode(ACCOUNT);
    stubLocation();
    render();

    const input = must<HTMLInputElement>('settings-trip-join-input');
    expect(input.getAttribute('aria-invalid')).toBeNull();

    type('settings-trip-join-input', ACCOUNT);
    submitJoin();

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('settings-trip-join-error');
    expect(document.getElementById('settings-trip-join-error')).not.toBeNull();
  });

  it('editing the field clears the refusal', () => {
    setSyncCode(ACCOUNT);
    stubLocation();
    render();

    type('settings-trip-join-input', ACCOUNT);
    submitJoin();
    expect(q('settings-trip-join-error')).not.toBeNull();

    type('settings-trip-join-input', 'someone-elses-trip');
    expect(q('settings-trip-join-error')).toBeNull();
  });

  it('a real Trip Token still joins and reloads — the guard is not a blanket refusal', () => {
    setSyncCode(ACCOUNT);
    const location = stubLocation();
    render();

    type('settings-trip-join-input', 'someone-elses-trip');
    submitJoin();

    expect(q('settings-trip-join-error')).toBeNull();
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(getActiveTripId()).toBe('someone-elses-trip');
  });

  it('the two doors cannot disagree — both render the one exported string', () => {
    // Not a style point. The /trips form and this one are the same refusal seen from two places;
    // if they diverge, one of them teaches the user something the other contradicts.
    expect(JOIN_REFUSAL_COPY['own-account-token']).toContain('your own key');
    expect(JOIN_REFUSAL_COPY['own-account-token']).toContain('Trip Token');
  });
});

describe('settings — "Forget this device" says what it actually clears', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    restoreLocation?.();
    restoreLocation = null;
    vi.restoreAllMocks();
  });

  // The button clears photos AND the three lifetime-scoped travel-history keys, which no other
  // surface clears and which no sync can restore. The confirm dialog says so; the entry point
  // used to name only the photos, so the destructive half was invisible until the dialog opened.
  it('the entry point names the travel history, not only the photos', () => {
    stubLocation();
    render();

    const button = must('settings-forget-device');
    const section = button.closest('div');
    const copy = section?.textContent ?? '';
    expect(copy).toContain('photo');
    expect(copy).toContain('travel history');
    expect(copy).toContain('cities and countries');
    expect(copy).toContain('passport stamps');
  });
});
