// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryItem } from '@/lib/trip-data';

const STAY: ItineraryItem = {
  id: 'h1',
  title: 'Check in to the Thamel hotel',
  category: 'hotel',
  startMinutes: 18 * 60,
  location: 'Thamel, Kathmandu',
};
let items: ItineraryItem[] = [STAY];

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({
    hydrated: true,
    getDayPlan: (date: string) => ({ date, items: date === '2026-12-09' ? items : [] }),
  }),
}));

import TonightsStay from '@/components/tonights-stay';

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(date: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<TonightsStay date={date} />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  items = [STAY];
});

describe('TonightsStay', () => {
  it('shows name, address, a maps link and a copy button', () => {
    const el = render('2026-12-11');
    expect(el.querySelector('[data-testid="tonights-stay"]')).not.toBeNull();
    expect(el.textContent).toContain('the Thamel hotel');
    expect(el.textContent).toContain('Thamel, Kathmandu');
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toContain('google.com/maps');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(el.querySelector('button')!.textContent).toBe('Copy address');
  });

  it('renders nothing with no hotel item on or before the date', () => {
    items = [];
    expect(render('2026-12-11').innerHTML).toBe('');
  });
});
