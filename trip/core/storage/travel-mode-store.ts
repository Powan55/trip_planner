/**
 * Travel Mode persisted accessors.
 *
 * These compose the gateway PRIMITIVES (`readString`/`writeString`/`removeKey`) over the key
 * literals declared in `STORAGE_KEYS` — so still holds: raw web-storage is touched only
 * inside `gateway.ts`, and every persisted key literal is declared only in `STORAGE_KEYS`. They live
 * in this SEPARATE module (not inside `gateway.ts`) purely for bundle reasons: `gateway.ts` is in the
 * app-wide First Load chunk, whereas only the non-shared Travel Mode surfaces use these accessors, so
 * splitting them out keeps the shared chunk byte-stable and the route budgets at the 106/107 kB line.
 */
import { readString, writeString, removeKey, getActiveTripId, STORAGE_KEYS } from '@/core/storage/gateway';

/**
 * Travel Mode gateway flag + arrival-toast "seen" marker (key 19). The 3-state presence string on
 * `STORAGE_KEYS.travelMode`: ABSENT → `'seen:<tripId>'` → `'active:<tripId>'`, where active also counts as
 * seen. The trip id scopes both to the trip that wrote them: another trip reads as unseen and inactive,
 * so a relaunch or the arrival toast never leaks across a trip switch. Bare legacy `'seen'` / `'active'`
 * (pre-scoping) match every trip.
 *
 * - `isActive()` drives the PWA-relaunch re-enter (`components/travel-mode-relaunch.tsx`).
 * - `hasSeen()` (key-presence) suppresses the arrival toast forever once entered OR dismissed.
 * - `enter()` writes `'active'` (an entry — also marks seen); `exit()` downgrades to `'seen'` (no
 * longer active, still seen → no re-enter and no toast); `markSeen()` writes `'seen'` ONLY when
 * absent (the toast-dismiss path — never clobbers an `'active'` flag).
 *
 * SSR-safe + never-throw (inherited from the primitives). The CALLER (the entry hook) decides
 * whether to arm the flag — this transport layer just writes whatever it is told.
 */
export const travelModeGate = {
  isActive(): boolean {
    const v = readString('local', STORAGE_KEYS.travelMode);
    return v === 'active' || v === `active:${getActiveTripId()}`;
  },
  hasSeen(): boolean {
    const v = readString('local', STORAGE_KEYS.travelMode);
    const id = getActiveTripId();
    return v !== null && (!v.includes(':') || v === `seen:${id}` || v === `active:${id}`);
  },
  enter(): void {
    writeString('local', STORAGE_KEYS.travelMode, `active:${getActiveTripId()}`);
  },
  exit(): void {
    writeString('local', STORAGE_KEYS.travelMode, `seen:${getActiveTripId()}`);
  },
  markSeen(): void {
    if (!travelModeGate.hasSeen()) writeString('local', STORAGE_KEYS.travelMode, `seen:${getActiveTripId()}`);
  },
} as const;

/**
 * Travel-return slot (key 20) — the SESSION-store route string the exit X restores to. `set(route)`
 * records the in-app entry origin (`pathname+search`); `get()` reads it back (or `null` on a cold
 * start → the exit falls back to `/`); `clear()` drops it on exit / relaunch re-enter. SSR-safe +
 * never-throw (inherited).
 */
export const travelReturn = {
  get(): string | null {
    return readString('session', STORAGE_KEYS.travelReturn);
  },
  set(route: string): void {
    writeString('session', STORAGE_KEYS.travelReturn, route);
  },
  clear(): void {
    removeKey('session', STORAGE_KEYS.travelReturn);
  },
} as const;
