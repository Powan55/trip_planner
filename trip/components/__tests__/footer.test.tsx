// The footer wordmark (#596) — must come from the active trip's legs, and the DEFAULT trip
// must still produce the exact literal it used to hardcode, since the footer's visual
// baselines (4 viewports) pin that text. Renders the real `FooterWordmark` the footer uses,
// not a parallel string-only copy of its logic.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { FooterWordmark } from '@/components/footer';
import { NEPAL_JAPAN_2026 } from '@/core/trips/packs/nepal-japan-2026';

function wordmarkText(legs: { countryLabel: string }[]): string {
  const html = renderToString(createElement(FooterWordmark, { legs }));
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.textContent ?? '';
}

describe('FooterWordmark', () => {
  it('renders the default two-leg trip byte-identical to the old literal', () => {
    expect(wordmarkText(NEPAL_JAPAN_2026.legs)).toBe('Nepal × Japan Journey');
  });

  it('renders a single-destination custom trip with no dangling separator', () => {
    expect(wordmarkText([{ countryLabel: 'Bali' }])).toBe('Bali Journey');
  });

  it('renders a multi-destination custom trip with its own labels', () => {
    expect(wordmarkText([{ countryLabel: 'Bali' }, { countryLabel: 'Lombok' }])).toBe(
      'Bali × Lombok Journey',
    );
  });

  it('does not collide keys when a custom trip repeats a country label', () => {
    expect(wordmarkText([{ countryLabel: 'Bali' }, { countryLabel: 'Bali' }])).toBe(
      'Bali × Bali Journey',
    );
  });
});
