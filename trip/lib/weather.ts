// Weather + golden-hour for the current trip city.
//
// A KEYLESS, no-card, no-signup client for Open-Meteo ( free-tools-only: Open-Meteo is
// genuinely free forever, requires no API key / card / account — only CC-BY 4.0 attribution).
// Because there is no secret to protect, the fetch is a plain browser `fetch` DIRECTLY to
// api.open-meteo.com — NO route handler, NO server. NO npm
// dependency is added (native `fetch`).
//
// ── Offline / failure = graceful (never throws) ─────────────────────────────────────────
// On any fetch failure (offline, network error, non-200, malformed body) `fetchWeather`
// returns the CACHED last-good value for that city — read through the typed storage gateway
//, tagged `stale: true`. On success it
// write-throughs the fresh value (tagged `stale: false`) and returns it. With no cache AND a
// failed fetch it returns a typed `unavailable` state — the UI shows a quiet fallback, never
// an error. The function is total: it resolves, it never rejects.
//
// ── Purity ──────────────────────────────────────────────────────────────────────
// `goldenHour(sunriseISO, sunsetISO)` and `weatherCodeToLabel(code)` are PURE — no clock, no
// fetch, no storage — and are unit-tested in isolation. `fetchWeather` composes them with the
// (impure) fetch + gateway I/O.

import { weatherCache } from '@/core/storage/gateway';

// ── City → coordinates ──────────────────────────────────────────────────────────────────
// All 12 trip cities. Every per-day city in `core/dates`' TRIP_CITIES / the sample
// itinerary now has real coordinates, so day-trip days (Nagarkot, Kyoto, Osaka, …) get real
// weather instead of the graceful `unavailable` fallback. The original two (Kathmandu, Tokyo)
// are byte-identical to keep the weather net exact. A weather-coords coverage unit test
// asserts `isKnownWeatherCity` is true for all 12 canonical cities so no trip day loses weather.
const CITY_COORDS: Record<string, { latitude: number; longitude: number }> = {
  // Nepal
  Kathmandu: { latitude: 27.7172, longitude: 85.324 },
  Lalitpur: { latitude: 27.6667, longitude: 85.324 },
  Nagarkot: { latitude: 27.7157, longitude: 85.5206 },
  Bhaktapur: { latitude: 27.671, longitude: 85.4298 },
  // Japan
  Tokyo: { latitude: 35.6762, longitude: 139.6503 },
  Hakone: { latitude: 35.2324, longitude: 139.1069 },
  Kyoto: { latitude: 35.0116, longitude: 135.7681 },
  Osaka: { latitude: 34.6937, longitude: 135.5023 },
  Kawaguchiko: { latitude: 35.517, longitude: 138.754 },
  Yuzawa: { latitude: 36.937, longitude: 138.808 },
  Nikko: { latitude: 36.7198, longitude: 139.6982 },
  Yokohama: { latitude: 35.4437, longitude: 139.638 },
};

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** The Open-Meteo attribution the card must render (CC-BY 4.0). */
export const OPEN_METEO_ATTRIBUTION = {
  label: 'Weather data by Open-Meteo.com',
  href: 'https://open-meteo.com/',
} as const;

// ── Public shapes ───────────────────────────────────────────────────────────────────────

/** A golden-hour window (morning or evening) as ISO datetime strings. */
export interface GoldenWindow {
  start: string; // ISO local datetime, e.g. "2026-12-12T06:42"
  end: string; // ISO local datetime
}

/**
 * One day of the 7-day outlook. `date` is the Open-Meteo `daily.time[i]` local calendar
 * date ("YYYY-MM-DD"); index 0 of the source arrays is today. Golden hour is derived the SAME
 * pure way as today's (`goldenHour`), so photography planning extends naturally into the week.
 */
export interface ForecastDay {
  date: string;
  highC: number;
  lowC: number;
  weatherCode: number;
  condition: string;
  goldenMorning: GoldenWindow;
  goldenEvening: GoldenWindow;
}

/** The parsed, UI-ready weather snapshot for one city. */
export interface WeatherNow {
  city: string;
  /** Current temperature in °C (rounded). */
  tempC: number;
  /** Open-Meteo WMO weather code + its human label + a matching emoji/icon key. */
  weatherCode: number;
  condition: string;
  /** Today's high / low in °C (rounded). */
  highC: number;
  lowC: number;
  /** Today's sunrise / sunset as ISO local datetime strings (from Open-Meteo `daily`). */
  sunrise: string;
  sunset: string;
  /** Derived golden-hour windows (pure `goldenHour`). */
  goldenMorning: GoldenWindow;
  goldenEvening: GoldenWindow;
  /** True when this value came from the offline cache, not a fresh fetch. */
  stale: boolean;
  /** ISO timestamp the value was fetched (for the "last updated" indicator). */
  fetchedAt: string;
  /**
   * the 7-day outlook (index 0 = today), parsed from the SAME Open-Meteo response — no
   * extra fetch. `null` when the daily arrays didn't hold a full row (malformed/short body); the
   * current-day fields above are still valid on their own in that case.
   */
  forecast: ForecastDay[] | null;
}

/** The result of a weather load: either data (fresh or stale) or a quiet unavailable state. */
export type WeatherResult =
  | { status: 'ok'; data: WeatherNow }
  | { status: 'unavailable'; city: string };

// ── Pure helpers ────────────────────────────────────────────────────────────────

/**
 * Map an Open-Meteo WMO weather code to a short human label. Codes grouped per the WMO
 * table Open-Meteo documents (0 clear … 95+ thunderstorm). Any unknown code falls back to a
 * safe generic label rather than throwing — pure + total.
 */
export function weatherCodeToLabel(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

/** A short, quiet contextual weather tag for an itinerary day card. */
export interface WeatherTag {
  icon: string;
  label: string;
}

/** Icon per `ForecastDay.condition` label — reuses the SAME label `weatherCodeToLabel`
 * already computed rather than re-grouping WMO codes a second time. An unmapped
 * label (shouldn't happen — `weatherCodeToLabel` is total) falls back to no icon, not a
 * crash. */
const WEATHER_TAG_ICONS: Record<string, string> = {
  'Clear sky': '☀️',
  'Mainly clear': '☀️',
  'Partly cloudy': '⛅',
  Overcast: '☁️',
  Fog: '🌫️',
  Drizzle: '🌦️',
  Rain: '🌧️',
  'Rain showers': '🌧️',
  Snow: '❄️',
  'Snow showers': '❄️',
  Thunderstorm: '⛈️',
};

/**
 * Derive a short contextual weather tag for one forecast day (PURE, — plain data-in/
 * data-out, no fetch/storage/clock/DOM). `null` in (nothing cached for that city/date, the
 * common case for a 32-day trip against a 7-day cache window) → `null` out, so the calendar
 * day card renders nothing rather than a broken/empty tag.
 */
export function weatherTagForDay(day: ForecastDay | null): WeatherTag | null {
  if (!day) return null;
  return { icon: WEATHER_TAG_ICONS[day.condition] ?? '', label: day.condition };
}

/** The golden-hour half-window length: ~50 minutes on either side of sunrise/sunset. */
const GOLDEN_MINUTES = 50;

/**
 * Compute the morning + evening golden-hour windows from sunrise/sunset (PURE).
 * morning ≈ [sunrise, sunrise + 50m]
 * evening ≈ [sunset − 50m, sunset]
 * Inputs are Open-Meteo's local-timezone ISO datetime strings (e.g. "2026-12-12T06:42");
 * outputs preserve that same "YYYY-MM-DDTHH:mm" local shape (no tz shift) so the card can
 * format them in the destination's local time without a Date round-trip through UTC.
 */
export function goldenHour(sunriseISO: string, sunsetISO: string): {
  morning: GoldenWindow;
  evening: GoldenWindow;
} {
  return {
    morning: {
      start: sunriseISO,
      end: addLocalMinutes(sunriseISO, GOLDEN_MINUTES),
    },
    evening: {
      start: addLocalMinutes(sunsetISO, -GOLDEN_MINUTES),
      end: sunsetISO,
    },
  };
}

/**
 * Add `minutes` (can be negative) to a local "YYYY-MM-DDTHH:mm[:ss]" string and return the
 * same local shape truncated to minutes. Computed with a LOCAL Date built from the parts (no
 * `Z`/UTC), so DST-free destinations are exact and there is no tz drift. Pure over its input.
 */
function addLocalMinutes(iso: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso; // defensive: unparsable input passes through unchanged
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi) + minutes,
    0,
    0,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours(),
  )}:${pad(dt.getMinutes())}`;
}

// ── Open-Meteo response parsing ─────────────────────────────────────────────────────────

/** The subset of the Open-Meteo `/v1/forecast` body we consume (all else ignored). */
interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  daily?: {
    /** Open-Meteo always includes the daily calendar dates alongside the requested fields. */
    time?: string[];
    sunrise?: string[];
    sunset?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
  };
}

/**
 * Parse a raw Open-Meteo body into a `WeatherNow` (PURE given the raw json + city + clock).
 * Reads index 0 of each `daily` array (today). Returns `null` if the required fields are
 * missing/malformed so the caller can fall back to cache rather than surface a broken card.
 */
export function parseOpenMeteo(
  json: OpenMeteoResponse,
  city: string,
  fetchedAt: string,
): WeatherNow | null {
  const current = json.current;
  const daily = json.daily;
  if (!current || !daily) return null;
  if (typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') {
    return null;
  }
  const sunrise = daily.sunrise?.[0];
  const sunset = daily.sunset?.[0];
  const high = daily.temperature_2m_max?.[0];
  const low = daily.temperature_2m_min?.[0];
  if (
    typeof sunrise !== 'string' ||
    typeof sunset !== 'string' ||
    typeof high !== 'number' ||
    typeof low !== 'number'
  ) {
    return null;
  }

  const golden = goldenHour(sunrise, sunset);
  return {
    city,
    tempC: Math.round(current.temperature_2m),
    weatherCode: current.weather_code,
    condition: weatherCodeToLabel(current.weather_code),
    highC: Math.round(high),
    lowC: Math.round(low),
    sunrise,
    sunset,
    goldenMorning: golden.morning,
    goldenEvening: golden.evening,
    stale: false,
    fetchedAt,
    // Filled in by `fetchWeather`; a bare `parseOpenMeteo` call (as the
    // existing unit tests make) has no forecast of its own to attach.
    forecast: null,
  };
}

/**
 * Parse the 7-day outlook out of the SAME Open-Meteo body `parseOpenMeteo` reads (PURE — no
 * clock/fetch/storage). Reads indices 0..6 of the `daily` arrays (index 0 = today). Returns
 * `null` if `daily` or any required array is missing/not-an-array/empty, or if any row within
 * the available range is malformed — total + total-simple: a partially-bad body is never
 * half-rendered, the caller falls back to cache instead.
 */
export function parseForecast(json: OpenMeteoResponse): ForecastDay[] | null {
  const daily = json.daily;
  if (!daily) return null;
  const { time, sunrise, sunset, temperature_2m_max: highs, temperature_2m_min: lows, weather_code: codes } = daily;
  if (
    !Array.isArray(time) ||
    !Array.isArray(sunrise) ||
    !Array.isArray(sunset) ||
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(codes)
  ) {
    return null;
  }
  const length = Math.min(7, time.length, sunrise.length, sunset.length, highs.length, lows.length, codes.length);
  if (length === 0) return null;

  const days: ForecastDay[] = [];
  for (let i = 0; i < length; i++) {
    const date = time[i];
    const sr = sunrise[i];
    const ss = sunset[i];
    const hi = highs[i];
    const lo = lows[i];
    const code = codes[i];
    if (
      typeof date !== 'string' ||
      typeof sr !== 'string' ||
      typeof ss !== 'string' ||
      typeof hi !== 'number' ||
      typeof lo !== 'number' ||
      typeof code !== 'number'
    ) {
      return null;
    }
    const golden = goldenHour(sr, ss);
    days.push({
      date,
      highC: Math.round(hi),
      lowC: Math.round(lo),
      weatherCode: code,
      condition: weatherCodeToLabel(code),
      goldenMorning: golden.morning,
      goldenEvening: golden.evening,
    });
  }
  return days;
}

// ── The client (impure: fetch + gateway I/O, but TOTAL — never throws) ───────────────────

/**
 * Build the Open-Meteo request URL for a city's coordinates. Requests exactly the fields the
 * card needs; `timezone=auto` returns sunrise/sunset in the DESTINATION's local time.
 */
function buildUrl(coords: { latitude: number; longitude: number }): string {
  const params = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    current: 'temperature_2m,weather_code',
    daily: 'sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'auto',
    // explicit (Open-Meteo already defaults to 7) so the 7-day outlook is guaranteed
    // present in the SAME response the current-day fields already parse — zero extra fetch.
    forecast_days: '7',
  });
  return `${OPEN_METEO_URL}?${params.toString()}`;
}

/** The compound cache key the 7-day outlook is stored under — reuses `weatherCache`'s
 * existing get/set surface with a distinct string, so `core/storage/gateway.ts` stays
 * untouched and the current-conditions entry under the plain `city` key is unaffected. */
function forecastCacheKey(city: string): string {
  return `${city}:forecast`;
}

/** Read the cached last-good value for a city (through the gateway), tagged `stale: true`,
 * with the last cached 7-day outlook (if any) merged back in. */
function readCache(city: string): WeatherNow | null {
  const cached = weatherCache.get<WeatherNow>(city);
  if (!cached) return null;
  const forecast = weatherCache.get<ForecastDay[]>(forecastCacheKey(city));
  return { ...cached, stale: true, forecast: forecast ?? null };
}

/**
 * Read ONE day out of a city's cached 7-day outlook, through the gateway (`weatherCache`,
 * — never raw `localStorage`). Read-only, no fetch triggered: `null` when
 * that city has never been fetched (no cache entry) or the cached window doesn't cover that
 * date — expected for most of a 32-day trip, since the cache only holds whichever 7 days were
 * last fetched for whichever surface (Essentials/today panel) the user actually viewed.
 */
export function getCachedForecastForDate(city: string, date: string): ForecastDay | null {
  const forecast = weatherCache.get<ForecastDay[]>(forecastCacheKey(city));
  if (!forecast) return null;
  return forecast.find((day) => day.date === date) ?? null;
}

/**
 * Load weather for a city. Total + never-throws:
 * 1. Unknown city → `unavailable` (no coords to query).
 * 2. Fetch OK + parses → write-through the fresh value, return `ok` (stale:false).
 * 3. Fetch fails / non-200 / unparsable → return the cached value if any (stale:true),
 * else `unavailable`.
 *
 * `fetchImpl` is injectable so unit tests can drive the fetch deterministically; production
 * passes the global `fetch`.
 */
export async function fetchWeather(
  city: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherResult> {
  const coords = CITY_COORDS[city];
  if (!coords) {
    // No coordinates for this city — nothing to query. Fall back to any cache, else unavailable.
    const cached = readCache(city);
    return cached ? { status: 'ok', data: cached } : { status: 'unavailable', city };
  }

  try {
    const res = await fetchImpl(buildUrl(coords));
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = (await res.json()) as OpenMeteoResponse;
    const parsed = parseOpenMeteo(json, city, new Date().toISOString());
    if (!parsed) throw new Error('Open-Meteo body missing required fields');
    // Write-through the fresh value (persist WITHOUT the stale flag flipped — it is fresh).
    weatherCache.set<WeatherNow>(city, parsed);
    // the 7-day outlook, parsed from the SAME body (no second fetch), cached under its
    // own compound key so the current-conditions entry above stays byte-identical to pre-.
    const forecast = parseForecast(json);
    if (forecast) weatherCache.set<ForecastDay[]>(forecastCacheKey(city), forecast);
    return { status: 'ok', data: { ...parsed, forecast: forecast ?? null } };
  } catch {
    // Any failure → cached last-good (stale), else the quiet unavailable state. Never throws.
    const cached = readCache(city);
    return cached ? { status: 'ok', data: cached } : { status: 'unavailable', city };
  }
}

/** Whether we have coordinates for a city (i.e. weather is queryable for it). */
export function isKnownWeatherCity(city: string): boolean {
  return Object.prototype.hasOwnProperty.call(CITY_COORDS, city);
}
