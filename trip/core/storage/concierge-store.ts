/**
 * Concierge accessors (keys 43 and 44). Composes the gateway primitives over the `STORAGE_KEYS`
 * literals, so raw web storage is still touched only in `gateway.ts`. Split out like
 * `my-places-store.ts`: `gateway.ts` sits in the app-wide First Load chunk and only the lazy
 * concierge panel reads these. Byte-transport only, never throws.
 */
import {
  STORAGE_KEYS,
  keyForTrip,
  readJson,
  readString,
  removeKey,
  writeJson,
  writeString,
} from '@/core/storage/gateway';

/** The thread for one trip id. `get` hands back the raw parse; the hook sanitizes it. */
export const conciergeChatStore = {
  get(tripId: string): unknown {
    return readJson<unknown>('local', keyForTrip(tripId, 'conciergeChat'), []);
  },
  set(tripId: string, turns: unknown): void {
    writeJson('local', keyForTrip(tripId, 'conciergeChat'), turns);
  },
  clear(tripId: string): void {
    removeKey('local', keyForTrip(tripId, 'conciergeChat'));
  },
} as const;

export const conciergeProviderStore = {
  get(): string | null {
    return readString('local', STORAGE_KEYS.conciergeProvider);
  },
  set(provider: string): void {
    writeString('local', STORAGE_KEYS.conciergeProvider, provider);
  },
} as const;
