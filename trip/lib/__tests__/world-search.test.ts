// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildWorldSearchUrl,
  parseNominatim,
  dropTripDuplicates,
  searchWorldPlaces,
  resetWorldSearchState,
  WORLD_SEARCH_MESSAGES,
  WORLD_SEARCH_LIMIT,
  NOMINATIM_SEARCH_URL,
  type WorldPlace,
} from '@/lib/world-search';

/**
 * Issue #22 — "search for any place in the world on the map". DETERMINISTIC: `fetch` is injected,
 * the pure functions take fixed inputs, and no live network is ever touched.
 *
 * What this proves, in the order it matters:
 *   - the REQUEST stays keyless and properly encoded (the D-108 check, applied to Nominatim), and
 *     Nominatim's 1-req/s policy is enforced by code rather than by hope;
 *   - the PARSER is total: string coordinates, missing fields, a non-array body and out-of-range
 *     latitudes all degrade to dropped rows, never to a `NaN` pin or a throw;
 *   - TRIP PLACES WIN: a world row naming a place the trip search already returned is dropped;
 *   - every FAILURE PATH — offline, HTTP 429, non-2xx, network error, timeout, garbage body —
 *     comes back as a typed outcome with plain-language words attached, and never rejects.
 *
 * The fixture is a real Nominatim `format=jsonv2` row shape: note `lat`/`lon` arrive as STRINGS,
 * which is the single most likely place for a naive parse to produce a null-island coordinate.
 */

const REYKJAVIK_BODY = [
  {
    place_id: 297577535,
    osm_type: 'relation',
    osm_id: 2580605,
    lat: '64.1466019',
    lon: '-21.9422367',
    category: 'boundary',
    type: 'administrative',
    name: 'Reykjavík',
    display_name: 'Reykjavík, Capital Region, Iceland',
  },
  {
    place_id: 12345678,
    osm_type: 'node',
    osm_id: 999,
    lat: '49.4200',
    lon: '-123.1000',
    name: 'Reykjavik Bakery',
    display_name: 'Reykjavik Bakery, Vancouver, British Columbia, Canada',
  },
];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/**
 * A recording stub in place of `vi.fn` — plain closures keep the `typeof fetch` assignability
 * obvious and match `lib/__tests__/currency-rate.test.ts`'s style. `urls` is what proves a
 * request was (or was not) issued at all, which is half of what this suite is for.
 */
function stubFetch(respond: (call: number) => Response) {
  const urls: string[] = [];
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    urls.push(String(url));
    return respond(urls.length - 1);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, urls };
}

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  resetWorldSearchState();
  setOnLine(true);
});

describe('buildWorldSearchUrl (pure) — the request is keyless and encoded', () => {
  it('targets Nominatim with a bounded jsonv2 query', () => {
    const url = new URL(buildWorldSearchUrl('Reykjavik'));
    expect(`${url.origin}${url.pathname}`).toBe(NOMINATIM_SEARCH_URL);
    expect(url.searchParams.get('q')).toBe('Reykjavik');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe(String(WORLD_SEARCH_LIMIT));
  });

  it('carries NO api key, token or contact parameter (free + keyless, D-088)', () => {
    // The same shape of check D-108 pinned on Open-Meteo. `email` is in this list on purpose:
    // Nominatim accepts it as an identifier and this repo is public.
    const url = buildWorldSearchUrl('anywhere').toLowerCase();
    for (const forbidden of ['api_key', 'apikey', 'appid', 'token', 'key=', 'email']) {
      expect(url).not.toContain(forbidden);
    }
  });

  it('URL-encodes the query rather than concatenating it', () => {
    const url = new URL(buildWorldSearchUrl('Kōfu & Nara, 奈良'));
    // Read back through the parser: whatever the encoding, the server sees the typed string.
    expect(url.searchParams.get('q')).toBe('Kōfu & Nara, 奈良');
    expect(url.search).not.toContain(' ');
  });

  it('trims a padded query so a stray space is not searched for', () => {
    expect(new URL(buildWorldSearchUrl('  Osaka  ')).searchParams.get('q')).toBe('Osaka');
  });
});

describe('parseNominatim (pure, total)', () => {
  it('maps a real jsonv2 body, converting the STRING lat/lon into numbers', () => {
    const places = parseNominatim(REYKJAVIK_BODY);
    expect(places).toHaveLength(2);
    expect(places[0]).toEqual({
      id: 'world-297577535',
      name: 'Reykjavík',
      displayName: 'Reykjavík, Capital Region, Iceland',
      lat: 64.1466019,
      lng: -21.9422367,
    });
    // Never NaN — a NaN coordinate is a camera move to the null island.
    for (const p of places) {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lng)).toBe(true);
    }
  });

  it('falls back to the first segment of display_name when `name` is empty', () => {
    const places = parseNominatim([
      { place_id: 1, lat: '35.0', lon: '135.0', name: '', display_name: 'Gion, Kyoto, Japan' },
    ]);
    expect(places[0].name).toBe('Gion');
    expect(places[0].displayName).toBe('Gion, Kyoto, Japan');
  });

  it('drops rows that cannot be flown to or named', () => {
    expect(
      parseNominatim([
        { place_id: 1, lat: 'not-a-number', lon: '135.0', display_name: 'Nowhere' },
        { place_id: 2, lon: '135.0', display_name: 'No latitude' },
        { place_id: 3, lat: '35.0', lon: '135.0', display_name: '' },
        { place_id: 4, lat: '35.0', lon: '135.0' },
        { place_id: 5, lat: '95.0', lon: '135.0', display_name: 'Above the north pole' },
        { place_id: 6, lat: '35.0', lon: '-999', display_name: 'Off the edge' },
        null,
        'not an object',
      ]),
    ).toEqual([]);
  });

  it('returns [] — never throws — on a body that is not an array', () => {
    expect(parseNominatim(null)).toEqual([]);
    expect(parseNominatim(undefined)).toEqual([]);
    expect(parseNominatim({ error: 'Unable to geocode' })).toEqual([]);
    expect(parseNominatim('<html>rate limited</html>')).toEqual([]);
  });

  // The id becomes a React key and a `data-testid`, so a collision is a real defect, not cosmetic.
  it('never emits two rows with the same id — a repeated place_id is dropped, a missing one falls back to the index', () => {
    const places = parseNominatim([
      { place_id: 7, lat: '1', lon: '1', display_name: 'A' },
      { place_id: 7, lat: '2', lon: '2', display_name: 'Duplicate id' },
      { lat: '3', lon: '3', display_name: 'C' },
      { lat: '4', lon: '4', display_name: 'D' },
    ]);
    const ids = places.map((p) => p.id);
    expect(ids).toEqual(['world-7', 'world-2', 'world-3']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('dropTripDuplicates (pure) — trip places win', () => {
  const world: WorldPlace[] = [
    { id: 'world-1', name: 'Kathmandu', displayName: 'Kathmandu, Bagmati, Nepal', lat: 27.7, lng: 85.3 },
    { id: 'world-2', name: 'Reykjavík', displayName: 'Reykjavík, Iceland', lat: 64.1, lng: -21.9 },
  ];

  it('drops a world row the trip search already returned, case- and space-insensitively', () => {
    expect(dropTripDuplicates(world, ['  KATHMANDU '])).toEqual([world[1]]);
  });

  it('keeps everything when the trip matched nothing', () => {
    expect(dropTripDuplicates(world, [])).toEqual(world);
  });

  it('keeps a DIFFERENT place with a different name, however close it sits', () => {
    // Deliberately not a proximity merge: two temples 400 m apart are two places, and a
    // distance-based dedupe would silently delete the second one.
    const near: WorldPlace[] = [
      { id: 'world-3', name: 'Boudha Stupa Cafe', displayName: 'Boudha, Kathmandu', lat: 27.7215, lng: 85.362 },
    ];
    expect(dropTripDuplicates(near, ['Boudhanath Stupa'])).toEqual(near);
  });
});

describe('searchWorldPlaces — the happy path, the policy, and the cache', () => {
  it('resolves a real body into places', async () => {
    const { fetchImpl, urls } = stubFetch(() => jsonResponse(REYKJAVIK_BODY));
    const out = await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.places.map((p) => p.name)).toEqual(['Reykjavík', 'Reykjavik Bakery']);
    }
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('nominatim.openstreetmap.org');
  });

  it('answers a repeated query from the memo, issuing NO second request', async () => {
    const { fetchImpl, urls } = stubFetch(() => jsonResponse(REYKJAVIK_BODY));
    await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 });
    const again = await searchWorldPlaces('  reykjavik  ', { fetchImpl, minIntervalMs: 0 });
    expect(urls).toHaveLength(1);
    expect(again.status).toBe('ok');
    if (again.status === 'ok') expect(again.places).toHaveLength(2);
  });

  it('waits out the 1-request-per-second policy interval before a second query', async () => {
    // The policy is enforced in code, not left to how fast a user can click. Real timers here
    // deliberately: the assertion is that the SECOND request is held back, and a fake clock
    // would prove only that a timer was created.
    const { fetchImpl, urls } = stubFetch(() => jsonResponse([]));
    await searchWorldPlaces('one', { fetchImpl, minIntervalMs: 40 });
    const startedAt = Date.now();
    await searchWorldPlaces('two', { fetchImpl, minIntervalMs: 40 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30); // timer granularity slack
    expect(urls).toHaveLength(2);
  });

  it('an empty query resolves to nothing WITHOUT a request', async () => {
    const { fetchImpl, urls } = stubFetch(() => jsonResponse(REYKJAVIK_BODY));
    const out = await searchWorldPlaces('   ', { fetchImpl, minIntervalMs: 0 });
    expect(out).toEqual({ status: 'ok', places: [] });
    expect(urls).toEqual([]);
  });
});

describe('searchWorldPlaces — every failure path is typed, worded, and never thrown', () => {
  it('OFFLINE: reports offline and never issues the doomed request', async () => {
    setOnLine(false);
    const { fetchImpl, urls } = stubFetch(() => jsonResponse(REYKJAVIK_BODY));
    const out = await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 });
    expect(out).toEqual({ status: 'offline' });
    expect(urls).toEqual([]);
  });

  it('RATE LIMITED: HTTP 429 is its own state, not a generic failure', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse('', false, 429));
    const out = await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 });
    expect(out).toEqual({ status: 'rate-limited' });
  });

  it('FAILED: any other non-2xx', async () => {
    for (const status of [403, 500, 503]) {
      resetWorldSearchState();
      const { fetchImpl } = stubFetch(() => jsonResponse('', false, status));
      expect(await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 })).toEqual({
        status: 'failed',
      });
    }
  });

  it('FAILED: a rejected fetch (no connection, DNS, CORS, abort) never escapes as a throw', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 }),
    ).resolves.toEqual({ status: 'failed' });
  });

  it('FAILED: a timeout settles rather than hanging forever', async () => {
    // A stalled connection that neither routes nor rejects: the abort signal is what makes the
    // "total" contract true instead of leaving the panel on "Searching…" for good.
    const fetchImpl = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const out = await searchWorldPlaces('Reykjavik', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
      minIntervalMs: 0,
    });
    expect(out).toEqual({ status: 'failed' });
  });

  it('FAILED: a body that is not JSON at all', async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }) as unknown as Response;
    expect(await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 })).toEqual({
      status: 'failed',
    });
  });

  it('a failure is NOT cached — the retry after the wifi comes back really retries', async () => {
    const { fetchImpl, urls } = stubFetch((call) =>
      call === 0 ? jsonResponse('', false, 500) : jsonResponse(REYKJAVIK_BODY),
    );
    expect(await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 })).toEqual({
      status: 'failed',
    });
    const second = await searchWorldPlaces('Reykjavik', { fetchImpl, minIntervalMs: 0 });
    expect(second.status).toBe('ok');
    expect(urls).toHaveLength(2);
  });

  it('a 200 with an empty result list is a real answer, and IS cached', async () => {
    const { fetchImpl, urls } = stubFetch(() => jsonResponse([]));
    expect(await searchWorldPlaces('zzzzzzz', { fetchImpl, minIntervalMs: 0 })).toEqual({
      status: 'ok',
      places: [],
    });
    await searchWorldPlaces('zzzzzzz', { fetchImpl, minIntervalMs: 0 });
    expect(urls).toHaveLength(1);
  });

  it('every failure has plain-language words, and none of them is a raw error string', () => {
    for (const kind of ['offline', 'rate-limited', 'failed'] as const) {
      const message = WORLD_SEARCH_MESSAGES[kind];
      expect(message.length).toBeGreaterThan(20);
      // Says what still works, so a degraded lookup never reads as a broken app.
      expect(message.toLowerCase()).toContain('trip');
      // Never leaks the machinery at the user.
      expect(message).not.toMatch(/error|http|fetch|\b\d{3}\b|undefined|null|nominatim/i);
    }
  });
});
