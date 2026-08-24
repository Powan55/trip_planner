// @vitest-environment jsdom
//
// Issue #4 — `components/visited-places-panel.tsx` mounted for real (createRoot + act, the
// `preflight-checks.test.tsx` harness) and driven through its own form, asserted on the DOM and
// on the REAL store underneath it.
//
// What is asserted HERE rather than in `lib/__tests__/visited-manual-entry.test.ts`: that the
// screen is actually WIRED to the policy and to the store — a typed city reaches
// localStorage under the lifetime key, a refusal reaches the user in words, a removal reaches
// disk, and the focus that a removed row was holding lands somewhere usable instead of on
// <body>. The policy's own clauses are unit-tested next door and are not re-derived here.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import VisitedPlacesPanel from '@/components/visited-places-panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'tripPlannerLifetimeVisits';

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<VisitedPlacesPanel />);
  });
  // A second flush: the store read happens in an effect, so the first paint is the empty one.
  await act(async () => {});
  return container;
}

const at = <T extends HTMLElement>(id: string): T =>
  container.querySelector<T>(`[data-testid="${id}"]`) as T;

/** Set a controlled input's value the way a user would — through React's own value tracker. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

async function submit(formTestId: string): Promise<void> {
  await act(async () => {
    at<HTMLFormElement>(formTestId).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}

async function addCity(name: string): Promise<void> {
  await act(async () => setValue(at<HTMLInputElement>('visited-city-input'), name));
  await submit('visited-city-form');
}

const stored = (): { cities: string[]; countries: string[] } =>
  JSON.parse(window.localStorage.getItem(KEY) ?? '{"cities":[],"countries":[]}');

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('issue #4 · /profile — typing in the places you have already been', () => {
  it('starts empty, with both empty states and a live region already in the DOM', async () => {
    await mount();
    expect(at('visited-country-count').textContent).toContain('0 recorded');
    expect(at('visited-city-count').textContent).toContain('0 recorded');
    expect(at('visited-city-empty')).not.toBeNull();
    // The region must EXIST before it has anything to say, or the first message is not announced.
    const status = at('visited-status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
  });

  it('adds a typed city to the real store and says so out loud', async () => {
    await mount();
    await addCity('  kathmandu  ');

    expect(stored().cities).toEqual(['kathmandu']); // tidied, but the spelling is the user's
    expect(at('visited-city-list').textContent).toContain('kathmandu');
    expect(at('visited-city-count').textContent).toContain('1 recorded');
    expect(at('visited-status').textContent).toContain('Added kathmandu');
    // The field is cleared and ready for the next one.
    expect(at<HTMLInputElement>('visited-city-input').value).toBe('');
  });

  it('refuses a duplicate under the fold rule, and both SAYS and SHOWS why', async () => {
    await mount();
    await addCity('Kathmandu');
    await addCity('  KATHMANDU ');

    expect(stored().cities).toEqual(['Kathmandu']);
    expect(at('visited-status').textContent).toContain('already on your list');
    expect(at('visited-city-error').textContent).toContain('already on your list');
    const input = at<HTMLInputElement>('visited-city-input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('visited-city-error');
  });

  it('refuses an over-long paste and an unreadable one, storing neither', async () => {
    await mount();
    await addCity('x'.repeat(200));
    expect(stored().cities).toEqual([]);
    expect(at('visited-city-error').textContent).toContain('80 characters');

    await addCity('...');
    expect(stored().cities).toEqual([]);
    expect(at('visited-city-error').textContent).toContain("doesn't look like a place name");
  });

  it('refuses an empty submit with words rather than doing nothing', async () => {
    await mount();
    await submit('visited-city-form');
    expect(stored().cities).toEqual([]);
    expect(at('visited-status').textContent).toContain('Type a city name first');
  });

  it('removes a city from the DOM and from disk, announces it, and keeps focus usable', async () => {
    await mount();
    await addCity('Kathmandu');
    await addCity('Pokhara');

    await act(async () => {
      at('visited-city-remove-Kathmandu').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(stored().cities).toEqual(['Pokhara']);
    expect(at('visited-city-remove-Kathmandu')).toBeNull();
    expect(at('visited-city-list').textContent).toContain('Pokhara');
    // Kathmandu is a trip city, so the sentence continues "…for now — …" (issue #236, below). The
    // substring is deliberate: what this case is about is that a removal is announced at all.
    expect(at('visited-status').textContent).toContain('Removed Kathmandu');
    // The button that had focus has just been unmounted; it must not fall to <body>.
    expect(document.activeElement).toBe(at('visited-city-input'));
  });

  // Issue #236 — `lib/visit-autocount.ts` re-credits every place the active trip names, so a
  // removal there is real but temporary. Kathmandu is a default-pack trip city and Pokhara is not,
  // which is what makes the pair below a contrast rather than two spellings of the same case.
  it('marks a place the trip itself counts, and announces its removal as temporary', async () => {
    await mount();
    await addCity('Kathmandu');

    const claimed = () =>
      container.querySelector('[data-testid="visited-city-list"] li[data-trip-claimed]');
    expect(claimed()).not.toBeNull();
    // "In your trip", not "From your trip": the badge marks that the itinerary names this
    // place, which is not a claim about where the row came from. The user may well have typed
    // it themselves years ago and the trip happens to go there too.
    expect(claimed()?.textContent).toContain('In your trip');
    // The caveat is in the button's own accessible name, for a screen reader moving button to button.
    expect(at('visited-city-remove-Kathmandu').textContent).toContain('will count it again');

    await act(async () => {
      at('visited-city-remove-Kathmandu').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The removal is not cosmetic — it really reaches disk. What changed is only what is CLAIMED.
    expect(stored().cities).toEqual([]);
    expect(at('visited-status').textContent).toContain('Removed Kathmandu for now');
    expect(at('visited-status').textContent).toContain('counted again');
    expect(document.activeElement).toBe(at('visited-city-input'));
  });

  it('leaves a place the trip does not name unmarked, and announces it flatly', async () => {
    await mount();
    await addCity('Pokhara');
    expect(
      container.querySelector('[data-testid="visited-city-list"] li[data-trip-claimed]'),
    ).toBeNull();
    expect(at('visited-city-remove-Pokhara').textContent).toContain('Remove Pokhara');
    expect(at('visited-city-remove-Pokhara').textContent).not.toContain('count it again');

    await act(async () => {
      at('visited-city-remove-Pokhara').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(at('visited-status').textContent).toContain('Removed Pokhara.');
    expect(at('visited-status').textContent).not.toContain('for now');
  });

  it('the empty state comes back when the last entry is removed', async () => {
    await mount();
    await addCity('Kathmandu');
    expect(at('visited-city-empty')).toBeNull();

    await act(async () => {
      at('visited-city-remove-Kathmandu').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(at('visited-city-empty')).not.toBeNull();
    expect(at('visited-city-count').textContent).toContain('0 recorded');
  });

  it('a country is picked from the ISO list, and drops out of the list once recorded', async () => {
    await mount();
    const select = at<HTMLSelectElement>('visited-country-select');
    const optionNames = () => Array.from(select.options).map((o) => o.value);
    expect(optionNames()).toContain('Nepal');
    expect(optionNames().length).toBeGreaterThan(200); // the whole ISO set, plus the placeholder

    await act(async () => setValue(select, 'Nepal'));
    await submit('visited-country-form');

    expect(stored().countries).toEqual(['Nepal']);
    expect(at('visited-country-list').textContent).toContain('Nepal');
    expect(at('visited-status').textContent).toContain('Added Nepal');
    // Unreachable-by-construction beats an error message: it cannot be added twice.
    expect(optionNames()).not.toContain('Nepal');
  });

  it('reads what is already on disk, including a visit the trip counted for you', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ cities: ['Tokyo'], countries: ['Japan'] }),
    );
    await mount();
    expect(at('visited-city-list').textContent).toContain('Tokyo');
    expect(at('visited-country-list').textContent).toContain('Japan');
    expect(at('visited-country-count').textContent).toContain('1 recorded');
    expect(
      Array.from(at<HTMLSelectElement>('visited-country-select').options).map((o) => o.value),
    ).not.toContain('Japan');
  });
});
