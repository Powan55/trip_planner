import { describe, it, expect } from 'vitest';
import { freshCopyOf } from '@/hooks/use-itinerary';
import type { ItineraryItem } from '@/lib/trip-data';

/**
 * S128 duplicate-item relies on the EXPORTED `freshCopyOf` (the S127/D-032 stripper) to build
 * a "same content, another day" copy that is handed to `addItem`. These checks pin the two
 * properties the duplicate correctness depends on:
 *   1. the copy carries the source's CONTENT (title/category/location/notes/sourceId/time…);
 *   2. it gets a FRESH id and drops the sync ordering fields (deleted/rev/hlc/ord), so it can
 *      never reuse the source id, inherit a tombstone, nor land on the source's position.
 */
describe('freshCopyOf — S128 duplicate fresh-id copy', () => {
  const source: ItineraryItem = {
    id: 'src-id-123',
    title: 'Ramen at Ichiran',
    category: 'food',
    location: 'Shibuya',
    notes: 'window seat',
    time: '19:00',
    startMinutes: 1140,
    sourceId: 'rec-ramen',
    sourceType: 'recommendation',
    // sync ordering fields that MUST be stripped:
    deleted: true,
    rev: 7,
    hlc: '2026-12-20T10:00:00.000Z-0001-abc',
    ord: '001700000009000:000000:abc',
  } as ItineraryItem;

  it('mints a fresh id — never reuses the source id', () => {
    const copy = freshCopyOf(source);
    expect(copy.id).toBeTruthy();
    expect(copy.id).not.toBe(source.id);
  });

  it('two copies of the same source get distinct ids', () => {
    expect(freshCopyOf(source).id).not.toBe(freshCopyOf(source).id);
  });

  it('keeps the content fields verbatim', () => {
    const copy = freshCopyOf(source);
    expect(copy.title).toBe('Ramen at Ichiran');
    expect(copy.category).toBe('food');
    expect(copy.location).toBe('Shibuya');
    expect(copy.notes).toBe('window seat');
    expect(copy.time).toBe('19:00');
    expect(copy.startMinutes).toBe(1140);
    expect(copy.sourceId).toBe('rec-ramen');
    expect(copy.sourceType).toBe('recommendation');
  });

  it('drops the sync ordering fields (deleted/rev/hlc/ord) so no tombstone or position is inherited', () => {
    const copy = freshCopyOf(source);
    expect(copy.deleted).toBeUndefined();
    expect(copy.rev).toBeUndefined();
    expect(copy.hlc).toBeUndefined();
    // Without this the copy sorts where the SOURCE sat instead of appending to its new day.
    expect(copy.ord).toBeUndefined();
  });
});
