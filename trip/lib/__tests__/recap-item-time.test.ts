// @vitest-environment jsdom
//
// #154 — the recap row renders its time through the shared display rule (`describeItemTime`),
// the same helper `trip-agenda.tsx` / `today-panel.tsx` / `calendar-sortable-item.tsx` use.
// It used to print `item.time` raw, which showed 24h text where the rest of the app shows
// 12h + a zone badge, and showed NOTHING for a `startMinutes`-only item (every item the
// concierge writes).
//
// Rendered rather than asserted on the helper (`item-time-display.test.ts` already covers the
// helper): a helper-level test stays green while the component keeps its own second path.
// createElement + createRoot + act, no JSX — the `story-photos.test.ts` convention, since the
// standalone vitest config globs this root for `*.test.ts` too.

import { describe, it, expect } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { RecapItem } from '@/components/trip-recap';
import type { ItineraryItem } from '@/lib/trip-data';

const NEPAL_DAY = '2026-12-10';
const JAPAN_DAY = '2026-12-20';

function mk(fields: Partial<ItineraryItem>): ItineraryItem {
  return { id: 'x', title: 'Boudhanath walk', category: 'sightseeing', ...fields };
}

/** Renders one row inside a `ul` (its real parent) and returns the row's text. */
function rowText(item: ItineraryItem, date: string): { text: string; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const el: ReactElement = createElement('ul', null, createElement(RecapItem, { item, date }));
  act(() => root.render(el));
  const row = container.querySelector('[data-testid="recap-plan-item"]');
  expect(row).not.toBeNull();
  return {
    text: row!.textContent ?? '',
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('#154 — the recap row routes its time through describeItemTime', () => {
  it('a startMinutes-only item (no `time`) renders a visible time — it used to render none', () => {
    const r = rowText(mk({ startMinutes: 855 }), NEPAL_DAY);
    expect(r.text).toContain('2:15 PM');
    expect(r.text).toContain('NPT');
    r.unmount();
  });

  it('a legacy 24h `time` renders in the same 12h + zone form the rest of the app uses', () => {
    const r = rowText(mk({ time: '14:15' }), NEPAL_DAY);
    expect(r.text).toContain('2:15 PM');
    expect(r.text).toContain('NPT');
    // The defect itself: the raw field printed verbatim.
    expect(r.text).not.toContain('14:15');
    r.unmount();
  });

  it('the badge comes from the ROW’s date, so a Japan day reads JST (the date arg is really used)', () => {
    const r = rowText(mk({ startMinutes: 855 }), JAPAN_DAY);
    expect(r.text).toContain('2:15 PM');
    expect(r.text).toContain('JST');
    expect(r.text).not.toContain('NPT');
    r.unmount();
  });

  it('an unparseable legacy `time` still renders verbatim, unbadged (nothing was over-broadened)', () => {
    const r = rowText(mk({ time: '2pm-ish' }), NEPAL_DAY);
    expect(r.text).toContain('2pm-ish');
    expect(r.text).not.toContain('NPT');
    r.unmount();
  });

  it('an untimed item renders no time, and keeps its category chip', () => {
    const r = rowText(mk({}), NEPAL_DAY);
    expect(r.text).not.toContain('PM');
    expect(r.text).not.toContain('AM');
    expect(r.text).toContain('sightseeing');
    r.unmount();
  });
});
