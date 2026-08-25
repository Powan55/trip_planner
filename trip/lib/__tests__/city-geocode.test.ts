// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAndCacheCityCoords } from '@/lib/city-geocode';
import { setTripConfig, getKnownTrip, type TripConfigBlock } from '@/core/trips/registry';
import { resetWorldSearchState } from '@/lib/world-search';

/**
 * #250 — a custom trip's city has no coordinates in `lib/city-coords.ts`'s hand-maintained table,
 * so weather silently goes unavailable forever. `resolveAndCacheCityCoords` is the one-shot,
 * user-initiated fix: geocode each destination via the SAME throttled Nominatim wrapper
 * `lib/world-search.ts` already enforces, and store the result on the TRIP'S OWN record —
 * never a second copy of `city-coords.ts`'s table.
 */

const BASE: TripConfigBlock = {
  start: '2027-03-01',
  end: '2027-03-05',
  destinations: ['Ubud'],
  vibe: 'beach',
  updatedAt: 0,
};

function nominatimRow(name: string, displayName: string, lat: string, lon: string) {
  return [{ place_id: 1, lat, lon, name, display_name: displayName }];
}

/** A realistic multi-row body — Nominatim ranks by relevance and the FIRST row is the match. */
function nominatimRows(
  ...rows: Array<[name: string, displayName: string, lat: string, lon: string]>
) {
  return rows.map(([name, display_name, lat, lon], i) => ({
    place_id: i + 1,
    lat,
    lon,
    name,
    display_name,
  }));
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function stubFetch(respond: (call: number, url: string) => Response) {
  const urls: string[] = [];
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    urls.push(String(url));
    return respond(urls.length - 1, String(url));
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, urls };
}

describe('resolveAndCacheCityCoords (#250)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetWorldSearchState();
  });

  it('geocodes a destination and caches the TOP result on the TRIP RECORD, not city-coords.ts', async () => {
    setTripConfig('custom-1', BASE);
    // TWO rows, not one: Nominatim ranks by relevance, so the FIRST row is the answer. A
    // one-row fixture cannot tell `places[0]` apart from any other index.
    const { fetchImpl } = stubFetch(() =>
      jsonResponse(
        nominatimRows(
          ['Ubud', 'Ubud, Bali, Indonesia', '-8.5069', '115.2625'],
          ['Ubud', 'Ubud, Gianyar Regency, Indonesia', '-8.4200', '115.1800'],
        ),
      ),
    );

    await resolveAndCacheCityCoords('custom-1', ['Ubud'], { fetchImpl, minIntervalMs: 0 });

    const stored = getKnownTrip('custom-1')?.config;
    expect(stored?.cityCoords).toEqual({ Ubud: { latitude: -8.5069, longitude: 115.2625 } });
  });

  it('merges onto the config as it is AFTER the await, not the snapshot taken before it', async () => {
    setTripConfig('custom-1', BASE);
    // The concurrency guard the re-read at city-geocode.ts:55 exists for: an edit that lands
    // WHILE the throttled request is in flight must survive the coordinate write.
    const { fetchImpl } = stubFetch(() => {
      setTripConfig('custom-1', { ...BASE, vibe: 'city', destinations: ['Ubud', 'Kuta'] });
      return jsonResponse(nominatimRow('Ubud', 'Ubud, Bali, Indonesia', '-8.5069', '115.2625'));
    });

    await resolveAndCacheCityCoords('custom-1', ['Ubud'], { fetchImpl, minIntervalMs: 0 });

    const stored = getKnownTrip('custom-1')?.config;
    expect(stored?.cityCoords).toEqual({ Ubud: { latitude: -8.5069, longitude: 115.2625 } });
    // Reusing the pre-await snapshot would silently revert both of these.
    expect(stored?.vibe).toBe('city');
    expect(stored?.destinations).toEqual(['Ubud', 'Kuta']);
  });

  it('skips a destination already resolved (no second request)', async () => {
    setTripConfig('custom-1', {
      ...BASE,
      cityCoords: { Ubud: { latitude: 1, longitude: 2 } },
    });
    const { fetchImpl, urls } = stubFetch(() => jsonResponse([]));

    await resolveAndCacheCityCoords('custom-1', ['Ubud'], { fetchImpl, minIntervalMs: 0 });

    expect(urls).toHaveLength(0); // no request — already resolved
    expect(getKnownTrip('custom-1')?.config?.cityCoords).toEqual({ Ubud: { latitude: 1, longitude: 2 } });
  });

  it('a destination Nominatim cannot resolve is skipped, others still resolve (best-effort, never throws)', async () => {
    setTripConfig('custom-1', { ...BASE, destinations: ['Ubud', 'Nowhereville'] });
    const { fetchImpl } = stubFetch((call) =>
      call === 0
        ? jsonResponse(nominatimRow('Ubud', 'Ubud, Bali, Indonesia', '-8.5069', '115.2625'))
        : jsonResponse([]), // empty result for the unresolvable city
    );

    await expect(
      resolveAndCacheCityCoords('custom-1', ['Ubud', 'Nowhereville'], { fetchImpl, minIntervalMs: 0 }),
    ).resolves.toBeUndefined();

    const coords = getKnownTrip('custom-1')?.config?.cityCoords;
    expect(coords).toEqual({ Ubud: { latitude: -8.5069, longitude: 115.2625 } });
    expect(coords?.Nowhereville).toBeUndefined();
  });

  it('a network failure resolves quietly (never throws) and leaves the config untouched', async () => {
    setTripConfig('custom-1', BASE);
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(
      resolveAndCacheCityCoords('custom-1', ['Ubud'], { fetchImpl, minIntervalMs: 0 }),
    ).resolves.toBeUndefined();
    expect(getKnownTrip('custom-1')?.config?.cityCoords).toBeUndefined();
  });

  it('no-op when the trip has no config yet', async () => {
    const { fetchImpl, urls } = stubFetch(() => jsonResponse([]));
    await resolveAndCacheCityCoords('no-config-trip', ['Ubud'], { fetchImpl, minIntervalMs: 0 });
    expect(urls).toHaveLength(0);
    expect(getKnownTrip('no-config-trip')).toBeUndefined();
  });
});
