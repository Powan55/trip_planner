// @vitest-environment jsdom
//
// Issue #247 — proves the safety phrase card (`components/travel-safety-kit.tsx`, rendered on
// `/safety`) acquires the Screen Wake Lock on mount and releases it on unmount, the same
// always-on contract `lib/__tests__/use-wake-lock.test.ts` already proves for the hook itself and
// `TravelEssentialsCard` already uses on `/travel`. `navigator.wakeLock` isn't real in jsdom, so
// it's mocked the same way use-wake-lock.test.ts mocks it. Render harness mirrors
// travel-essentials-card.test.tsx: plain `react-dom/client` + `act`, no `@testing-library/react`
// in this repo.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import TravelSafetyKit from '@/components/travel-safety-kit';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    writable: true,
    configurable: true,
  });
}

function makeFakeWakeLock() {
  const sentinels: Array<{ release: ReturnType<typeof vi.fn> }> = [];
  const request = vi.fn(async () => {
    const sentinel = {
      addEventListener: () => {},
      removeEventListener: () => {},
      release: vi.fn(async () => {}),
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  return { request, sentinels };
}

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(createElement(TravelSafetyKit)));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('TravelSafetyKit — screen wake lock (#247)', () => {
  let fake: ReturnType<typeof makeFakeWakeLock>;

  beforeEach(() => {
    setVisibility('visible');
    fake = makeFakeWakeLock();
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: fake.request },
      writable: true,
      configurable: true,
    });
  });

  it('acquires a wake lock on mount, always-on (mirrors TravelEssentialsCard on /travel)', async () => {
    const r = render();
    // The acquire is async inside the hook's effect — flush it.
    await act(async () => {});
    expect(fake.request).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('releases the wake lock on unmount', async () => {
    const r = render();
    await act(async () => {});
    expect(fake.sentinels).toHaveLength(1);
    r.unmount();
    expect(fake.sentinels[0].release).toHaveBeenCalledTimes(1);
  });
});
