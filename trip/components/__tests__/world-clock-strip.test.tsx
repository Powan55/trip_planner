// @vitest-environment jsdom
// #957 — dual clock strip: real zone math (Nepal's +5:45), default-pack gate, no live region.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const state = vi.hoisted(() => ({ isDefault: true }));

vi.mock('@/core/trips', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/trips')>();
  return { ...orig, isDefaultTrip: () => state.isDefault };
});

import WorldClockStrip from '@/components/world-clock-strip';
import { formatZoneClock } from '@/core/dates';

function render() {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(createElement(WorldClockStrip)));
  return { container, unmount: () => act(() => root.unmount()) };
}

// 2026-12-10 12:00Z: New York 7:00 AM, Kathmandu 5:45 PM, Tokyo 9:00 PM.
beforeEach(() => {
  state.isDefault = true;
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatZoneClock', () => {
  it('reads the :45 Nepal offset, not a rounded one', () => {
    expect(formatZoneClock(new Date('2026-12-10T12:00:00Z'), 'Asia/Kathmandu')).toBe('Thu 5:45 PM');
  });

  it('crosses the date line per zone', () => {
    const t = new Date('2026-12-10T20:00:00Z');
    expect(formatZoneClock(t, 'America/New_York')).toBe('Thu 3:00 PM');
    expect(formatZoneClock(t, 'Asia/Tokyo')).toBe('Fri 5:00 AM');
  });

  it('returns null for an unknown zone instead of throwing', () => {
    expect(formatZoneClock(new Date(), 'Not/AZone')).toBeNull();
  });
});

describe('WorldClockStrip', () => {
  it('shows home, Kathmandu and Tokyo, and is not a live region', () => {
    const r = render();
    const text = (id: string) => r.container.querySelector(`[data-testid="world-clock-${id}"]`)?.textContent;
    expect(text('home')).toContain('7:00 AM');
    expect(text('kathmandu')).toContain('5:45 PM');
    expect(text('tokyo')).toContain('9:00 PM');
    expect(r.container.querySelector('[aria-live]')).toBeNull();
    r.unmount();
  });

  it('reads the real clock under a ?today= override and keeps ticking', () => {
    sessionStorage.setItem('tripPlannerTodayOverride', '2026-12-25'); // frozen demo day
    const r = render();
    const kathmandu = () => r.container.querySelector('[data-testid="world-clock-kathmandu"]')?.textContent;
    expect(kathmandu()).toContain('Thu 5:45 PM');
    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(kathmandu()).toContain('Thu 6:45 PM');
    r.unmount();
  });

  it('renders nothing on a custom trip', () => {
    state.isDefault = false;
    const r = render();
    expect(r.container.querySelector('[data-testid="world-clock-strip"]')).toBeNull();
    r.unmount();
  });
});
