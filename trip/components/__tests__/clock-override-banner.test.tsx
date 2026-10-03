// @vitest-environment jsdom
// #790 — the demo-clock marker renders only under `?today=`, and write-default seeds ignore it.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const KEY = 'tripPlannerTodayOverride';

async function mount(search: string) {
  window.history.replaceState(null, '', '/' + search);
  vi.resetModules(); // trip-now caches the override per module load
  const { ClockOverrideBanner } = await import('@/components/clock-override-banner');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ClockOverrideBanner />);
  });
  return { container, root };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('ClockOverrideBanner (#790)', () => {
  it('renders nothing on the real clock', async () => {
    const { container } = await mount('');
    expect(container.querySelector('[data-testid="clock-override-banner"]')).toBeNull();
  });

  it('shows the simulated date under ?today=', async () => {
    const { container } = await mount('?today=2026-12-12');
    const el = container.querySelector('[data-testid="clock-override-banner"]');
    expect(el?.textContent).toContain('2026-12-12');
  });

  it('shows from the persisted session override with no URL param', async () => {
    sessionStorage.setItem(KEY, '2026-12-12');
    const { container } = await mount('');
    expect(container.querySelector('[data-testid="clock-override-banner"]')).not.toBeNull();
  });
});

describe('getTodayInTripForWrite (#790)', () => {
  it('is null under the override even when the faked day is in-trip', async () => {
    window.history.replaceState(null, '', '/?today=2026-12-12');
    vi.resetModules();
    const m = await import('@/lib/trip-now');
    expect(m.getTodayInTrip()).not.toBeNull();
    expect(m.getTodayInTripForWrite()).toBeNull();
  });
});
