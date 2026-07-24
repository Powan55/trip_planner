/**
 * My-places persisted accessor.
 *
 * Composes the gateway PRIMITIVES (`readJson`/`writeJson`) over the `STORAGE_KEYS.myPlaces` key
 * literal + trip-scoped `keyFor('myPlaces')` resolution — so still holds: raw web-storage
 * is touched only inside `gateway.ts`, and every persisted key literal is declared only in
 * `STORAGE_KEYS`. It lives in this SEPARATE module (not inside `gateway.ts`) purely for bundle reasons,
 * exactly like `core/storage/travel-mode-store.ts`: `gateway.ts` is in the app-wide First Load chunk,
 * whereas only the non-shared, lazy My Places island + import sheet use this accessor, so splitting it
 * out keeps the shared chunk byte-stable and the route budgets at the 107 kB line.
 *
 * The gateway is byte-transport only: it does NOT know the `MyPlace` shape — the value
 * type is a caller-supplied generic `T`, owned by `core/places/model.ts`. `get(fallback)` returns the
 * parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER sanitizes (`sanitizePlaces`).
 * `set(places)` writes the whole list as JSON. TRIP-SCOPED + LOCAL-ONLY (cross-device sync is the
 * deferred S-d). Never throws (inherits `readJson`/`writeJson`).
 */
import { readJson, writeJson, keyFor } from '@/core/storage/gateway';

export const myPlacesStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('myPlaces'), fallback);
  },
  set<T>(places: T): void {
    writeJson('local', keyFor('myPlaces'), places);
  },
} as const;
