// #596: the /flights hero subtitle must come from the active trip, same pattern as
// app/map/sections.tsx's mapSubtitleFor. The default pack must stay byte-identical to the
// old literal, since the flights hero has its own visual baseline.

import { describe, it, expect } from 'vitest';
import { flightsSubtitleFor } from '../sections';
import { NEPAL_JAPAN_2026 } from '@/core/trips/packs/nepal-japan-2026';

describe('flightsSubtitleFor', () => {
  it('renders the default trip byte-identical to the old literal', () => {
    expect(flightsSubtitleFor(NEPAL_JAPAN_2026.legs, true)).toBe(
      'Every leg of the journey — flights, layovers, and hotel stays across Nepal and Japan.',
    );
  });

  it('names a custom trip\'s own places', () => {
    expect(flightsSubtitleFor([{ countryLabel: 'Bali' }], false)).toBe(
      'Every leg of the journey — flights, layovers, and hotel stays across Bali.',
    );
  });

  it('joins a multi-destination custom trip', () => {
    expect(flightsSubtitleFor([{ countryLabel: 'Bali' }, { countryLabel: 'Lombok' }], false)).toBe(
      'Every leg of the journey — flights, layovers, and hotel stays across Bali and Lombok.',
    );
  });
});
