'use client';

import { useCallback } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import {
  bookingOverridesPort,
  upsertOverride,
  removeOverride,
  type BookingOverride,
  type BookingOverrideMap,
} from '@/core/bookings/override';
import { BOOKING_OVERRIDES_CHANGED_EVENT } from '@/core/storage/events';

export { BOOKING_OVERRIDES_CHANGED_EVENT };

/**
 * Reactive booking-overrides store (issue #228). A THIN React adapter over
 * `core/bookings/override.ts`'s gateway-key-40 `bookingOverridesPort`, wired through the shared
 * `createReactiveStore` skeleton exactly like `hooks/use-favorites.ts` — local-only, no sync fan-out.
 * SSR-safe + hydrated-gated: `overrides` starts `{}` (matching the server render), hydrates from
 * storage in a mount effect, and `commit()` reads the FRESHEST persisted state as its base.
 */
const useBookingOverridesStore = createReactiveStore<BookingOverrideMap>({
  eventName: BOOKING_OVERRIDES_CHANGED_EVENT,
  storageKeys: () => [keyFor('bookingOverrides')],
  storage: bookingOverridesPort,
});

export interface BookingOverridesApi {
  overrides: BookingOverrideMap;
  hydrated: boolean;
  setOverride(id: string, patch: Omit<BookingOverride, 'updatedAt'>): void;
  clearOverride(id: string): void;
}

export function useBookingOverrides(): BookingOverridesApi {
  const { value: overrides, hydrated, commit } = useBookingOverridesStore();

  const setOverride = useCallback(
    (id: string, patch: Omit<BookingOverride, 'updatedAt'>) => {
      commit((current) => upsertOverride(current, id, patch));
    },
    [commit],
  );

  const clearOverride = useCallback(
    (id: string) => {
      commit((current) => removeOverride(current, id));
    },
    [commit],
  );

  return { overrides, hydrated, setOverride, clearOverride };
}
