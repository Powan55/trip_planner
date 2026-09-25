// #596: the /map hero subtitle must come from the active trip, the same way #617 derives the
// footer wordmark. The default pack must still produce the exact literal its visual baseline
// pins (e2e/visual.spec.ts "map page hero").

import { describe, it, expect } from 'vitest';
import { mapSubtitleFor } from '../sections';
import { NEPAL_JAPAN_2026 } from '@/core/trips/packs/nepal-japan-2026';

describe('mapSubtitleFor', () => {
  it('renders the default trip byte-identical to the old literal', () => {
    expect(mapSubtitleFor(NEPAL_JAPAN_2026.legs, true)).toBe(
      'Attractions, food, photo spots, and hotels across Kathmandu and Japan — filter by category or overlay your own itinerary.',
    );
  });

  it('names a custom trip\'s own places', () => {
    expect(mapSubtitleFor([{ countryLabel: 'Bali' }], false)).toBe(
      'Attractions, food, photo spots, and hotels across Bali — filter by category or overlay your own itinerary.',
    );
  });

  it('joins a multi-destination custom trip', () => {
    expect(mapSubtitleFor([{ countryLabel: 'Bali' }, { countryLabel: 'Lombok' }], false)).toBe(
      'Attractions, food, photo spots, and hotels across Bali and Lombok — filter by category or overlay your own itinerary.',
    );
  });
});
