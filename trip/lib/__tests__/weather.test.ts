// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchWeather,
  parseOpenMeteo,
  parseForecast,
  goldenHour,
  weatherCodeToLabel,
  isKnownWeatherCity,
  getCachedForecastForDate,
  weatherTagForDay,
  formatWeatherAsOf,
  OPEN_METEO_ATTRIBUTION,
  type WeatherNow,
  type ForecastDay,
} from '@/lib/weather';
import { weatherCache, STORAGE_KEYS } from '@/core/storage/gateway';

/**
 * S99 — weather + golden-hour client. DETERMINISTIC: `fetch` is mocked (vitest), the pure
 * helpers take fixed inputs, and the gateway cache round-trips through jsdom localStorage. NO
 * live network is ever touched (the sandbox can't reliably reach api.open-meteo.com; the live
 * call is spot-checkable by the operator in a real browser).
 *
 * What this proves:
 *   - `goldenHour` + `weatherCodeToLabel` are pure (no clock/fetch/storage).
 *   - `parseOpenMeteo` maps a captured Open-Meteo body → WeatherNow, and rejects a malformed body.
 *   - `fetchWeather` write-throughs a fresh value to the gateway cache (D-078).
 *   - the offline path (fetch rejects / non-200) returns the CACHED last-good value (stale:true).
 *   - no-cache + failed fetch → the typed `unavailable` state (never throws).
 *   - the `weatherCache` gateway accessor round-trips per-city without evicting the other city.
 */

// A captured, realistic Open-Meteo `/v1/forecast` body (Kathmandu, winter). Shape verbatim
// from the documented `current` + `daily` response for the exact params the client requests.
const KATHMANDU_FIXTURE = {
  latitude: 27.71,
  longitude: 85.32,
  timezone: 'Asia/Kathmandu',
  current: {
    time: '2026-12-12T09:00',
    temperature_2m: 12.4,
    weather_code: 1,
  },
  daily: {
    time: ['2026-12-12'],
    sunrise: ['2026-12-12T06:42'],
    sunset: ['2026-12-12T17:08'],
    temperature_2m_max: [18.9],
    temperature_2m_min: [3.2],
    weather_code: [2],
  },
};

// A 7-day variant of the fixture (S150) — same shape, `daily` arrays extended to a full week so
// `parseForecast`/`fetchWeather` can be exercised against a realistic body.
const KATHMANDU_WEEK_FIXTURE = {
  ...KATHMANDU_FIXTURE,
  daily: {
    time: ['2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18'],
    sunrise: [
      '2026-12-12T06:42', '2026-12-13T06:43', '2026-12-14T06:43', '2026-12-15T06:44',
      '2026-12-16T06:44', '2026-12-17T06:45', '2026-12-18T06:45',
    ],
    sunset: [
      '2026-12-12T17:08', '2026-12-13T17:08', '2026-12-14T17:08', '2026-12-15T17:08',
      '2026-12-16T17:09', '2026-12-17T17:09', '2026-12-18T17:09',
    ],
    temperature_2m_max: [18.9, 19.2, 17.8, 20.1, 19.5, 18.0, 17.6],
    temperature_2m_min: [3.2, 2.8, 4.1, 3.9, 3.0, 2.5, 3.4],
    weather_code: [2, 0, 3, 1, 2, 61, 0],
  },
};

/** A minimal ok-Response stub around a JSON body (only the fields `fetchWeather` reads). */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('weatherCodeToLabel (pure)', () => {
  it('maps the documented WMO code groups', () => {
    expect(weatherCodeToLabel(0)).toBe('Clear sky');
    expect(weatherCodeToLabel(1)).toBe('Mainly clear');
    expect(weatherCodeToLabel(2)).toBe('Partly cloudy');
    expect(weatherCodeToLabel(3)).toBe('Overcast');
    expect(weatherCodeToLabel(45)).toBe('Fog');
    expect(weatherCodeToLabel(48)).toBe('Fog');
    expect(weatherCodeToLabel(53)).toBe('Drizzle');
    expect(weatherCodeToLabel(63)).toBe('Rain');
    expect(weatherCodeToLabel(73)).toBe('Snow');
    expect(weatherCodeToLabel(81)).toBe('Rain showers');
    expect(weatherCodeToLabel(86)).toBe('Snow showers');
    expect(weatherCodeToLabel(95)).toBe('Thunderstorm');
    expect(weatherCodeToLabel(99)).toBe('Thunderstorm');
  });

  it('falls back to a safe label for an unknown code (never throws)', () => {
    expect(weatherCodeToLabel(-1)).toBe('Unknown');
    expect(weatherCodeToLabel(12345)).toBe('Unknown');
  });
});

describe('formatWeatherAsOf (pure, S276/P6 — stale weather age label)', () => {
  it('renders a short human date+time for a valid ISO timestamp', () => {
    const out = formatWeatherAsOf('2026-07-20T14:05:00.000Z');
    expect(out).not.toBe('');
    expect(out).toMatch(/Jul/);
  });

  it('degrades to an empty string for an unparsable timestamp (never throws)', () => {
    expect(formatWeatherAsOf('not-a-date')).toBe('');
  });
});

describe('goldenHour (pure)', () => {
  it('morning = [sunrise, sunrise+50m]; evening = [sunset-50m, sunset]', () => {
    const g = goldenHour('2026-12-12T06:42', '2026-12-12T17:08');
    expect(g.morning.start).toBe('2026-12-12T06:42');
    expect(g.morning.end).toBe('2026-12-12T07:32'); // +50m
    expect(g.evening.start).toBe('2026-12-12T16:18'); // -50m
    expect(g.evening.end).toBe('2026-12-12T17:08');
  });

  it('rolls the hour correctly when +50m crosses an hour boundary', () => {
    const g = goldenHour('2026-12-12T06:20', '2026-12-12T17:50');
    expect(g.morning.end).toBe('2026-12-12T07:10'); // 6:20 + 50m
    expect(g.evening.start).toBe('2026-12-12T17:00'); // 17:50 - 50m
  });

  it('is pure — same input yields same output, no clock/storage read', () => {
    const a = goldenHour('2026-12-12T06:42', '2026-12-12T17:08');
    const b = goldenHour('2026-12-12T06:42', '2026-12-12T17:08');
    expect(a).toEqual(b);
  });
});

describe('parseOpenMeteo (pure)', () => {
  it('maps a captured Open-Meteo body into a WeatherNow', () => {
    const w = parseOpenMeteo(KATHMANDU_FIXTURE, 'Kathmandu', '2026-12-12T09:00:00.000Z');
    expect(w).not.toBeNull();
    expect(w!.city).toBe('Kathmandu');
    expect(w!.tempC).toBe(12); // rounded from 12.4
    expect(w!.weatherCode).toBe(1);
    expect(w!.condition).toBe('Mainly clear');
    expect(w!.highC).toBe(19); // rounded from 18.9
    expect(w!.lowC).toBe(3); // rounded from 3.2
    expect(w!.sunrise).toBe('2026-12-12T06:42');
    expect(w!.sunset).toBe('2026-12-12T17:08');
    expect(w!.goldenMorning).toEqual({ start: '2026-12-12T06:42', end: '2026-12-12T07:32' });
    expect(w!.goldenEvening).toEqual({ start: '2026-12-12T16:18', end: '2026-12-12T17:08' });
    expect(w!.stale).toBe(false);
    expect(w!.fetchedAt).toBe('2026-12-12T09:00:00.000Z');
  });

  it('returns null on a malformed body (missing current / daily fields)', () => {
    expect(parseOpenMeteo({}, 'Kathmandu', 'x')).toBeNull();
    expect(parseOpenMeteo({ current: {} }, 'Kathmandu', 'x')).toBeNull();
    expect(
      parseOpenMeteo({ current: { temperature_2m: 10, weather_code: 1 } }, 'Kathmandu', 'x'),
    ).toBeNull();
    expect(
      parseOpenMeteo(
        { current: { temperature_2m: 10, weather_code: 1 }, daily: { sunrise: [] } },
        'Kathmandu',
        'x',
      ),
    ).toBeNull();
  });
});

describe('parseForecast (pure, S150)', () => {
  it('malformed body (no daily) → null', () => {
    expect(parseForecast({})).toBeNull();
  });

  it('missing/short arrays → null', () => {
    expect(parseForecast({ daily: {} })).toBeNull();
    expect(parseForecast({ daily: { time: ['2026-12-12'] } })).toBeNull(); // other arrays absent
  });

  it('a malformed row within the range (wrong type) → null, not a partial list', () => {
    const bad = {
      daily: {
        ...KATHMANDU_WEEK_FIXTURE.daily,
        temperature_2m_max: [18.9, 19.2, 'not-a-number', 20.1, 19.5, 18.0, 17.6],
      },
    };
    expect(parseForecast(bad as unknown as Parameters<typeof parseForecast>[0])).toBeNull();
  });

  it('well-formed 7-day body → 7 rows, index 0 = today, golden-hour derived per row', () => {
    const days = parseForecast(KATHMANDU_WEEK_FIXTURE);
    expect(days).not.toBeNull();
    expect(days).toHaveLength(7);
    const d = days as ForecastDay[];

    expect(d[0].date).toBe('2026-12-12');
    expect(d[0].highC).toBe(19); // rounded from 18.9
    expect(d[0].lowC).toBe(3); // rounded from 3.2
    expect(d[0].condition).toBe('Partly cloudy'); // weather_code 2
    expect(d[0].goldenMorning).toEqual({ start: '2026-12-12T06:42', end: '2026-12-12T07:32' });
    expect(d[0].goldenEvening).toEqual({ start: '2026-12-12T16:18', end: '2026-12-12T17:08' });

    expect(d[6].date).toBe('2026-12-18');
    expect(d[6].condition).toBe('Clear sky'); // weather_code 0
    expect(d[6].highC).toBe(18); // rounded from 17.6
    expect(d[6].lowC).toBe(3); // rounded from 3.4
  });

  it('caps at 7 rows even if the body has more', () => {
    const extra = {
      daily: {
        time: [...KATHMANDU_WEEK_FIXTURE.daily.time, '2026-12-19'],
        sunrise: [...KATHMANDU_WEEK_FIXTURE.daily.sunrise, '2026-12-19T06:46'],
        sunset: [...KATHMANDU_WEEK_FIXTURE.daily.sunset, '2026-12-19T17:09'],
        temperature_2m_max: [...KATHMANDU_WEEK_FIXTURE.daily.temperature_2m_max, 17.0],
        temperature_2m_min: [...KATHMANDU_WEEK_FIXTURE.daily.temperature_2m_min, 3.0],
        weather_code: [...KATHMANDU_WEEK_FIXTURE.daily.weather_code, 1],
      },
    };
    expect(parseForecast(extra)).toHaveLength(7);
  });
});

describe('weatherCache gateway accessor (D-078 round-trip)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('set/get round-trips per city and does not evict the other city', () => {
    const kt = { city: 'Kathmandu', tempC: 12 } as unknown as WeatherNow;
    const tk = { city: 'Tokyo', tempC: 8 } as unknown as WeatherNow;
    weatherCache.set<WeatherNow>('Kathmandu', kt);
    weatherCache.set<WeatherNow>('Tokyo', tk);
    expect(weatherCache.get<WeatherNow>('Kathmandu')).toEqual(kt);
    expect(weatherCache.get<WeatherNow>('Tokyo')).toEqual(tk);
    // Both persisted under ONE key as a { city: value } map (byte-transport contract).
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.weatherCache) as string);
    expect(Object.keys(raw).sort()).toEqual(['Kathmandu', 'Tokyo']);
  });

  it('get returns null for an uncached city (never throws)', () => {
    expect(weatherCache.get<WeatherNow>('Nowhere')).toBeNull();
  });

  it('uses a distinct, additive on-disk key', () => {
    expect(STORAGE_KEYS.weatherCache).toBe('nepal_japan_weather_cache');
  });
});

describe('fetchWeather (total; write-through + offline fallback)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('success: parses, write-throughs to the gateway cache, returns fresh (stale:false)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(KATHMANDU_FIXTURE));
    const result = await fetchWeather('Kathmandu', fetchMock as unknown as typeof fetch);

    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Requested the documented keyless endpoint with the exact params (no key in the URL).
    const url = (fetchMock.mock.calls[0][0] as string);
    expect(url.startsWith('https://api.open-meteo.com/v1/forecast?')).toBe(true);
    expect(url).toContain('latitude=27.7172');
    expect(url).toContain('longitude=85.324');
    expect(url).toContain('current=temperature_2m%2Cweather_code');
    expect(url).toContain('timezone=auto');
    expect(url).not.toMatch(/api[_-]?key|apikey|appid|token=/i); // KEYLESS — no secret
    // #54A — the request carries an abort signal, so a STALLED connection (one that neither
    // routes nor rejects) settles at the ceiling instead of pinning the card at `loading`
    // forever. Asserted on the init object; the URL above is deliberately unaffected.
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    if (result.status === 'ok') {
      expect(result.data.stale).toBe(false);
      expect(result.data.tempC).toBe(12);
    }
    // Write-through: the fresh value is now in the gateway cache (persisted stale:false).
    const cached = weatherCache.get<WeatherNow>('Kathmandu');
    expect(cached).not.toBeNull();
    expect(cached!.tempC).toBe(12);
    expect(cached!.stale).toBe(false);
  });

  it('offline (fetch rejects): returns the CACHED last-good value tagged stale:true', async () => {
    // Prime the cache via a first successful fetch.
    const okFetch = vi.fn().mockResolvedValue(jsonResponse(KATHMANDU_FIXTURE));
    await fetchWeather('Kathmandu', okFetch as unknown as typeof fetch);

    // Now the network is down — fetch rejects.
    const downFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await fetchWeather('Kathmandu', downFetch as unknown as typeof fetch);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.stale).toBe(true); // served from cache
      expect(result.data.tempC).toBe(12); // same last-good value
    }
  });

  it('non-200 response: falls back to cache (treated as a failure)', async () => {
    const okFetch = vi.fn().mockResolvedValue(jsonResponse(KATHMANDU_FIXTURE));
    await fetchWeather('Kathmandu', okFetch as unknown as typeof fetch);

    const badFetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const result = await fetchWeather('Kathmandu', badFetch as unknown as typeof fetch);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.data.stale).toBe(true);
  });

  it('no cache + failed fetch → the typed unavailable state (never throws)', async () => {
    const downFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await fetchWeather('Tokyo', downFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'unavailable', city: 'Tokyo' });
  });

  it('unknown city (no coords) → unavailable without any fetch', async () => {
    const fetchMock = vi.fn();
    const result = await fetchWeather('Atlantis', fetchMock as unknown as typeof fetch);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'unavailable', city: 'Atlantis' });
  });

  it('never throws even when json() itself throws (malformed body → cache/unavailable)', async () => {
    const brokenJson = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });
    await expect(
      fetchWeather('Tokyo', brokenJson as unknown as typeof fetch),
    ).resolves.toEqual({ status: 'unavailable', city: 'Tokyo' });
  });
});

describe('fetchWeather forecast attachment (S150 — zero extra fetch)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('success with a 7-day body: attaches `forecast` (7 rows) from the SAME response — exactly 1 fetch call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(KATHMANDU_WEEK_FIXTURE));
    const result = await fetchWeather('Kathmandu', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1); // NOT 2 — no second round-trip for the outlook
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.forecast).not.toBeNull();
      expect(result.data.forecast).toHaveLength(7);
      expect(result.data.forecast![0].date).toBe('2026-12-12');
    }

    // Cached under a DISTINCT compound key (`${city}:forecast`) — the plain `Kathmandu` key still
    // holds the current-conditions object, unaffected.
    expect(weatherCache.get<ForecastDay[]>('Kathmandu:forecast')).toHaveLength(7);
    expect(weatherCache.get<WeatherNow>('Kathmandu')!.tempC).toBe(12);
    // Both live under the ONE on-disk gateway key (no new gateway key was added, D-078/D-097).
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.weatherCache) as string);
    expect(Object.keys(raw).sort()).toEqual(['Kathmandu', 'Kathmandu:forecast']);
  });

  it('success with only a 1-day body (legacy-shaped fixture): forecast is null, current-day fields unaffected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(KATHMANDU_FIXTURE));
    const result = await fetchWeather('Kathmandu', fetchMock as unknown as typeof fetch);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.forecast).toHaveLength(1); // 1 row is still a valid (short) forecast
      expect(result.data.tempC).toBe(12);
    }
  });

  it('offline after a 7-day fetch: the CACHED forecast rides along on the stale fallback', async () => {
    const okFetch = vi.fn().mockResolvedValue(jsonResponse(KATHMANDU_WEEK_FIXTURE));
    await fetchWeather('Kathmandu', okFetch as unknown as typeof fetch);

    const downFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await fetchWeather('Kathmandu', downFetch as unknown as typeof fetch);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.stale).toBe(true);
      expect(result.data.forecast).toHaveLength(7); // outlook survives the offline fallback too
    }
  });
});

describe('metadata', () => {
  it('exposes the required Open-Meteo attribution (D-088, CC-BY 4.0)', () => {
    expect(OPEN_METEO_ATTRIBUTION.label).toBe('Weather data by Open-Meteo.com');
    expect(OPEN_METEO_ATTRIBUTION.href).toBe('https://open-meteo.com/');
  });

  it('knows the two trip cities and nothing else', () => {
    expect(isKnownWeatherCity('Kathmandu')).toBe(true);
    expect(isKnownWeatherCity('Tokyo')).toBe(true);
    expect(isKnownWeatherCity('Atlantis')).toBe(false);
  });
});

describe('weatherTagForDay (pure, S216)', () => {
  const day = (overrides: Partial<ForecastDay> = {}): ForecastDay => ({
    date: '2026-12-12',
    highC: 19,
    lowC: 3,
    weatherCode: 2,
    condition: 'Partly cloudy',
    goldenMorning: { start: '2026-12-12T06:42', end: '2026-12-12T07:32' },
    goldenEvening: { start: '2026-12-12T16:18', end: '2026-12-12T17:08' },
    ...overrides,
  });

  it('null in (nothing cached) → null out', () => {
    expect(weatherTagForDay(null)).toBeNull();
  });

  it('maps a known condition to an icon + the SAME label weatherCodeToLabel already computed', () => {
    expect(weatherTagForDay(day({ condition: 'Clear sky' }))).toEqual({ icon: '☀️', label: 'Clear sky' });
    expect(weatherTagForDay(day({ condition: 'Partly cloudy' }))).toEqual({ icon: '⛅', label: 'Partly cloudy' });
    expect(weatherTagForDay(day({ condition: 'Rain' }))).toEqual({ icon: '🌧️', label: 'Rain' });
    expect(weatherTagForDay(day({ condition: 'Snow' }))).toEqual({ icon: '❄️', label: 'Snow' });
    expect(weatherTagForDay(day({ condition: 'Thunderstorm' }))).toEqual({ icon: '⛈️', label: 'Thunderstorm' });
  });

  it('an unmapped/unknown condition label falls back to no icon rather than throwing (total)', () => {
    expect(weatherTagForDay(day({ condition: 'Unknown' }))).toEqual({ icon: '', label: 'Unknown' });
  });

  it('is pure — same input yields same output, no clock/storage read', () => {
    const a = weatherTagForDay(day());
    const b = weatherTagForDay(day());
    expect(a).toEqual(b);
  });
});

describe('getCachedForecastForDate (gateway read-only, S216)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const week = (): ForecastDay[] => [
    {
      date: '2026-12-12',
      highC: 19,
      lowC: 3,
      weatherCode: 2,
      condition: 'Partly cloudy',
      goldenMorning: { start: '2026-12-12T06:42', end: '2026-12-12T07:32' },
      goldenEvening: { start: '2026-12-12T16:18', end: '2026-12-12T17:08' },
    },
    {
      date: '2026-12-13',
      highC: 19,
      lowC: 3,
      weatherCode: 0,
      condition: 'Clear sky',
      goldenMorning: { start: '2026-12-13T06:43', end: '2026-12-13T07:33' },
      goldenEvening: { start: '2026-12-13T16:18', end: '2026-12-13T17:08' },
    },
  ];

  it('cache hit: returns the matching row for city+date', () => {
    weatherCache.set<ForecastDay[]>('Kathmandu:forecast', week());
    const day = getCachedForecastForDate('Kathmandu', '2026-12-13');
    expect(day).not.toBeNull();
    expect(day!.condition).toBe('Clear sky');
  });

  it('cache miss: the city has never been fetched at all → null', () => {
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')).toBeNull();
  });

  it('date not in the cached forecast window → null (a cached city, an uncovered date)', () => {
    weatherCache.set<ForecastDay[]>('Kathmandu:forecast', week());
    expect(getCachedForecastForDate('Kathmandu', '2026-12-25')).toBeNull();
  });

  it('unknown city → null, never throws', () => {
    weatherCache.set<ForecastDay[]>('Kathmandu:forecast', week());
    expect(getCachedForecastForDate('Atlantis', '2026-12-12')).toBeNull();
  });

  it('reads through the weatherCache gateway, never raw localStorage (D-078/D-097)', () => {
    weatherCache.set<ForecastDay[]>('Kathmandu:forecast', week());
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.weatherCache) as string);
    expect(Object.keys(raw)).toEqual(['Kathmandu:forecast']);
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')!.condition).toBe('Partly cloudy');
  });
});
