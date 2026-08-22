/**
 * D-167: Ensure itineraryItemSchema mirrors ItineraryItem interface.
 * Detects when fields are added to the interface but forgotten in the schema
 * (a previous bug that went unnoticed because passthrough() silently tolerated it).
 */
import { describe, it, expect } from 'vitest';
import { itineraryItemSchema } from '@/core/vault/schema';
import type { ItineraryItem } from '@/lib/trip-data';

describe('Vault schema drift guard', () => {
  it('itineraryItemSchema contains all keys from ItineraryItem interface', () => {
    // Compile-time check: this object MUST have every key from ItineraryItem, or TypeScript
    // fails to compile. If a new field is added to the interface and not included here,
    // the type error is immediate and unavoidable — no need to run tests to catch the drift.
    const allKeys: Record<keyof ItineraryItem, true> = {
      id: true,
      title: true,
      category: true,
      time: true,
      duration: true,
      startMinutes: true,
      durationMinutes: true,
      notes: true,
      location: true,
      sourceId: true,
      sourceType: true,
      createdBy: true,
      updatedBy: true,
      updatedAt: true,
      rev: true,
      hlc: true,
      deleted: true,
      done: true,
      doneBy: true,
      doneAt: true,
      lat: true,
      lng: true,
      endDate: true,
      tzOffsetMin: true,
    };

    // Runtime check: verify the schema shape contains all keys from allKeys.
    // Each interface key must be present in the schema so it is explicitly declared,
    // not just silently tolerated by passthrough(). This guarantees the next field that
    // drifts is surfaced instead of hidden under lenient reads.
    const schemaKeys = Object.keys(itineraryItemSchema.shape);
    const missing = Object.keys(allKeys).filter((key) => !schemaKeys.includes(key));
    if (missing.length > 0) {
      throw new Error(
        `Schema is missing interface fields: ${missing.join(', ')}. ` +
          `Add them to itineraryItemSchema in core/vault/schema.ts to avoid silent data loss.`,
      );
    }
    expect(missing).toEqual([]);
  });
});
