/**
 * #250 — one-shot, user-initiated city→coordinate resolution for a custom trip's destinations.
 *
 * Uses the SAME throttled, no-autocomplete Nominatim wrapper `lib/world-search.ts` already
 * enforces (1 req/s, no key/email) — no second network client, no new provider. Called ONLY from
 * a user-initiated surface (trip creation today; a future city-edit surface would call it the
 * same way) and NEVER from the weather-fetch path — an automatic per-fetch geocode query would
 * violate that provider's usage policy.
 *
 * Resolved coordinates are written onto the TRIP'S OWN config record
 * (`TripConfigBlock.cityCoords`, via `sanitizeTripConfig`), never back into the shared
 * `lib/city-coords.ts` table — that table stays the one hand-maintained default-pack list.
 *
 * Lives in `lib/`, not `core/`, because it calls `lib/world-search.ts`'s fetch client (D-099:
 * `core/` may not import `lib/` at runtime). Reached only via a dynamic `import()` — this and
 * `world-search.ts` are not on the eager per-route import chain, and should stay off it.
 */
import { searchWorldPlaces, type WorldSearchOptions } from '@/lib/world-search';
import { getKnownTrip, setTripConfig } from '@/core/trips/registry';

/**
 * Geocode every destination this trip doesn't already have a coordinate for, and merge the
 * results onto its stored config. Best-effort and total (never throws): a destination Nominatim
 * can't resolve (no result, offline, rate-limited, timed out) is silently skipped — the weather
 * card then falls back to `lib/city-coords.ts`'s static table, or the quiet "unavailable" state,
 * exactly the pre-#250 behaviour for that one city.
 *
 * No-op when the trip has no config yet (nothing to attach coordinates to) or every destination
 * is already resolved.
 */
export async function resolveAndCacheCityCoords(
  tripId: string,
  destinations: string[],
  options: WorldSearchOptions = {},
): Promise<void> {
  const config = getKnownTrip(tripId)?.config;
  if (!config) return;
  const known = config.cityCoords ?? {};
  const toResolve = [...new Set(destinations)].filter(
    (d) => !Object.prototype.hasOwnProperty.call(known, d),
  );
  if (toResolve.length === 0) return;

  const resolved: Record<string, { latitude: number; longitude: number }> = { ...known };
  for (const city of toResolve) {
    const outcome = await searchWorldPlaces(city, options);
    if (outcome.status === 'ok' && outcome.places.length > 0) {
      const place = outcome.places[0];
      resolved[city] = { latitude: place.lat, longitude: place.lng };
    }
  }

  // Re-read rather than reuse the snapshot above: the config may have changed while this awaited
  // the throttled requests (a rename, a re-edit) — merge onto whatever is current, don't clobber it.
  const latest = getKnownTrip(tripId)?.config;
  if (!latest) return;
  setTripConfig(tripId, { ...latest, cityCoords: resolved });
}
