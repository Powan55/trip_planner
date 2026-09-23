// `core/itinerary/model` as the FIRST module in the graph.
//
// It and `core/vault/schema` used to import each other, and nothing loaded the model side first —
// every path reached it through `lib/itinerary-remote.ts`, which pulls the schema in earlier. The
// cycle was benign only because neither side dereferenced the other at module-eval time, which is
// an invisible property `tsc` is green on either way: lifting the schema into a module-level const
// would have thrown a TDZ ReferenceError on exactly this import order, at runtime, on read.
//
// `itineraryItemSchema` now lives in the leaf `core/vault/item-schema.ts`, so there is no cycle to
// be careful about. This file pins that by loading the model side first and using it. Keep the
// import below FIRST — that is the whole point of the file.
import { sanitizeItineraryItem, sanitizeItineraryItems } from '@/core/itinerary/model';
import { describe, it, expect } from 'vitest';

describe('core/itinerary/model loaded as the entry module', () => {
  it('sanitizes a row without touching a half-initialized schema', () => {
    const item = sanitizeItineraryItem({ id: 'a', title: 'Momos', category: 'food' });
    expect(item).toEqual({ id: 'a', title: 'Momos', category: 'food' });
  });

  it('applies the vault contract it wraps — bad rows dropped, bad coordinates degraded', () => {
    const rows = sanitizeItineraryItems([
      null,
      { id: '   ', title: 'blank id', category: 'food' },
      { id: 'ok', title: 'Rooftop', category: 'food', lat: 500, lng: 85.3 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['ok']);
    // The row survives its out-of-range pin; only the coordinate is dropped.
    expect(rows[0].lat).toBeUndefined();
    expect(rows[0].lng).toBe(85.3);
  });
});
