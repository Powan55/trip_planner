// @vitest-environment jsdom
//
// #970: the create form's local currency lands in the trip config instead of always USD.

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
vi.mock('@/lib/city-geocode', () => ({ resolveAndCacheCityCoords: async () => {} }));

import TripsHub from '@/components/trips-hub';
import { listKnownTrips } from '@/core/trips/registry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const at = <T extends HTMLElement>(id: string): T =>
  document.querySelector<T>(`[data-testid="${id}"]`)!;

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: 'input' | 'change'): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

async function createTrip(
  currency?: string,
  destinations = 'Kochi',
  dates?: [string, string],
  vibeClicks: string[] = [],
): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TripsHub />);
  });
  await act(async () => {
    setValue(at<HTMLInputElement>('trips-hub-create-name'), 'Kerala 2027', 'input');
    setValue(at<HTMLInputElement>('trips-hub-create-destinations'), destinations, 'input');
    if (dates) {
      setValue(at<HTMLInputElement>('trips-hub-create-start'), dates[0], 'input');
      setValue(at<HTMLInputElement>('trips-hub-create-end'), dates[1], 'input');
    }
    if (currency) setValue(at<HTMLSelectElement>('trips-hub-create-currency'), currency, 'change');
  });
  for (const v of vibeClicks) {
    await act(async () => at<HTMLButtonElement>(`trips-hub-create-vibe-${v}`).click());
  }
  await act(async () => {
    at<HTMLButtonElement>('trips-hub-create').click();
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tripPlannerToken', 'Uttam');
  localStorage.setItem('tripPlannerUserName', 'Uttam');
  localStorage.setItem('tripPlannerSyncCode', 'already-has-one');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

const created = () => listKnownTrips().find((t) => t.name === 'Kerala 2027');

describe('trips hub create: local currency (#970)', () => {
  it('offers the currencies the budget can convert, defaulting to USD', async () => {
    await createTrip();
    const options = [...at<HTMLSelectElement>('trips-hub-create-currency').options].map((o) => o.value);
    expect(options).toEqual(['USD', 'NPR', 'JPY', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'THB']);
    expect(created()?.config?.currency).toBe('USD');
  });

  it('stores an extra leg currency as picked', async () => {
    await createTrip('EUR');
    expect(created()?.config?.currency).toBe('EUR');
  });

  it('writes the picked currency into the trip config', async () => {
    await createTrip('NPR');
    expect(created()?.config?.currency).toBe('NPR');
  });
});

describe('trips hub create: optional vibe (#1121)', () => {
  const pressed = () =>
    [...document.querySelectorAll('[data-testid^="trips-hub-create-vibe-"][aria-pressed="true"]')].length;

  it('starts with no vibe and stores the no-vibe marker', async () => {
    await createTrip();
    expect(pressed()).toBe(0);
    expect(created()?.config?.vibe).toBe('none');
  });

  it('a picked vibe is stored', async () => {
    await createTrip(undefined, 'Kochi', undefined, ['beach']);
    expect(created()?.config?.vibe).toBe('beach');
  });

  it('tapping the picked vibe again clears it', async () => {
    await createTrip(undefined, 'Kochi', undefined, ['beach', 'beach']);
    expect(pressed()).toBe(0);
    expect(created()?.config?.vibe).toBe('none');
  });

  it('the trip name has a visible label', async () => {
    await createTrip();
    const label = document.querySelector('label[for="trips-hub-create-name"]');
    expect(label?.textContent?.trim()).toBe('Trip name');
    expect(label?.classList.contains('sr-only')).toBe(false);
  });
});

describe('trips hub create: destinations hint (#970)', () => {
  it('ties the single-city hint to the destinations input', async () => {
    await createTrip();
    const input = at<HTMLInputElement>('trips-hub-create-destinations');
    const hint = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('With several destinations, the trip dates are split evenly across them, in order.');
  });
});

describe('trips hub create: per-day city stops (#1052)', () => {
  it('splits the span evenly across several destinations', async () => {
    await createTrip(undefined, 'Kochi, Munnar, Alleppey', ['2027-02-01', '2027-02-09']);
    expect(created()?.config?.stops).toEqual([
      { date: '2027-02-01', city: 'Kochi' },
      { date: '2027-02-04', city: 'Munnar' },
      { date: '2027-02-07', city: 'Alleppey' },
    ]);
  });

  it('gives every city its own day when there are more cities than days', async () => {
    await createTrip(undefined, 'Kochi, Munnar, Alleppey', ['2027-02-01', '2027-02-02']);
    expect(created()?.config?.stops).toEqual([
      { date: '2027-02-01', city: 'Kochi' },
      { date: '2027-02-02', city: 'Munnar' },
    ]);
  });

  it('writes no stops for a single destination', async () => {
    await createTrip();
    expect(created()?.config).not.toHaveProperty('stops');
  });
});
