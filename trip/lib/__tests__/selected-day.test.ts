import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The value is module state, so a case that cares about the initial read has to re-import.
const load = async () => {
  vi.resetModules();
  return import('../selected-day');
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('selected day', () => {
  it('reads back the most recent selection', async () => {
    const { getSelectedDay, setSelectedDay } = await load();

    expect(getSelectedDay()).toBeNull();
    setSelectedDay('2026-12-09');
    expect(getSelectedDay()).toBe('2026-12-09');
    setSelectedDay('2026-12-11');
    expect(getSelectedDay()).toBe('2026-12-11');
  });

  // The module's storage rule: this is a per-page-load hint, not persisted state. Writing it
  // to web storage would carry one load's focused day into the next one's add dialogs.
  it('holds the selection in memory only, never in web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { setSelectedDay } = await load();

    setSelectedDay('2026-12-09');

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('starts from null again on the next page load', async () => {
    const first = await load();
    first.setSelectedDay('2026-12-09');

    const second = await load();

    expect(second.getSelectedDay()).toBeNull();
  });
});
