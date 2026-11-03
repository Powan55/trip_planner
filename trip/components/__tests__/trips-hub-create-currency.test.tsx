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

async function createTrip(currency?: string): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TripsHub />);
  });
  await act(async () => {
    setValue(at<HTMLInputElement>('trips-hub-create-name'), 'Kerala 2027', 'input');
    setValue(at<HTMLInputElement>('trips-hub-create-destinations'), 'Kochi', 'input');
    if (currency) setValue(at<HTMLSelectElement>('trips-hub-create-currency'), currency, 'change');
  });
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
    expect(options).toEqual(['USD', 'NPR', 'JPY']);
    expect(created()?.config?.currency).toBe('USD');
  });

  it('writes the picked currency into the trip config', async () => {
    await createTrip('NPR');
    expect(created()?.config?.currency).toBe('NPR');
  });
});

describe('trips hub create: destinations hint (#970)', () => {
  it('ties the single-city hint to the destinations input', async () => {
    await createTrip();
    const input = at<HTMLInputElement>('trips-hub-create-destinations');
    const hint = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('The first destination is used as every day’s city.');
  });
});
