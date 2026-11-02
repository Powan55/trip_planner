// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import DayStrip from '@/components/day-strip';

const DATES = ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12'];

function Harness({ start }: { start: string }) {
  const [sel, setSel] = useState(start);
  return createElement(DayStrip, { dates: DATES, selectedDate: sel, onSelect: setSel, meta: [], todayDate: null });
}

function mount(start: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(createElement(Harness, { start })));
  const chips = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
  const key = (k: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
  return { chips, key };
}

beforeAll(() => {
  // jsdom has no layout scrolling or matchMedia; the strip only needs these to exist.
  Element.prototype.scrollTo = () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
});

describe('DayStrip roving tabindex', () => {
  it('exposes exactly one tab stop: the selected chip', () => {
    const { chips } = mount('2026-12-11');
    expect(chips().filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(chips()[2].tabIndex).toBe(0);
    expect(chips().every((c) => c.hasAttribute('aria-pressed'))).toBe(true);
  });

  it('arrows, Home and End move focus and selection; edges clamp', () => {
    const { chips, key } = mount('2026-12-10');
    act(() => chips()[1].focus());
    key('ArrowRight');
    expect(document.activeElement).toBe(chips()[2]);
    expect(chips()[2].getAttribute('aria-pressed')).toBe('true');
    expect(chips()[2].tabIndex).toBe(0);
    expect(chips()[1].tabIndex).toBe(-1);
    key('End');
    expect(document.activeElement).toBe(chips()[3]);
    key('ArrowRight');
    expect(document.activeElement).toBe(chips()[3]);
    key('Home');
    expect(document.activeElement).toBe(chips()[0]);
    key('ArrowLeft');
    expect(document.activeElement).toBe(chips()[0]);
    expect(chips().filter((c) => c.tabIndex === 0)).toHaveLength(1);
  });

  it('falls back to the first chip when the selection is outside the strip', () => {
    const { chips } = mount('2027-01-01');
    expect(chips().map((c) => c.tabIndex)).toEqual([0, -1, -1, -1]);
  });
});
