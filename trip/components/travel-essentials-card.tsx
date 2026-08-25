'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cloud, Wallet, ShieldAlert, Plane, ChevronDown, Home } from 'lucide-react';
import { getCountryForDate, getCityForDate, formatHomeClock } from '@/core/dates';
import { isDefaultTrip } from '@/core/trips';
import { legCurrency } from '@/core/budget/model';
import { EMERGENCY_CONTACTS } from '@/core/content/safety';
import {
  fetchWeather,
  fetchAirQuality,
  weatherCodeToLabel,
  formatWeatherAsOf,
  fogRiskLabel,
  usAqiLabel,
  type WeatherResult,
  type AirQualityResult,
} from '@/lib/weather';
import { fetchCurrencyRate, type CurrencyRateResult } from '@/lib/currency-rate';
import {
  OUTBOUND_JOURNEY,
  RETURN_TO_JAPAN_JOURNEY,
  TOKYO_TO_OSAKA_JOURNEY,
  FLIGHT_HOME_JOURNEY,
  type Journey,
} from '@/lib/booking-data';
import { buildFlightTrackerUrl, buildRome2RioUrl, buildGoogleFlightsUrl } from '@/lib/flight-deep-links';
import { useWakeLock } from '@/lib/use-wake-lock';
import { useTravelTick } from '@/lib/travel-tick';
import { useOnline } from '@/hooks/use-online';
import { useBudget } from '@/hooks/use-budget';
import { cn } from '@/lib/utils';

/**
 * — Travel Mode Essentials block. Mounts BELOW the agenda on `/travel` (a lazy island,
 * `app/travel/sections.tsx`,) and follows the SAME resolved date the hero/agenda use
 * — it never reads its own clock or date param.
 *
 * Four at-a-glance panels: leg-correct weather (reuses `weatherCache` via `fetchWeather`,/
 * — no new fetch path), a live USD→leg-currency rate (NEW: `lib/currency-rate.ts`),
 * a compact safety/emergency-numbers subset (`core/content/safety.ts`, read-only, links to
 * `/safety` for the rest), and — ONLY on the trip's four travel days (Dec 9 arrival, Dec 18/19
 * leg hop, Jan 9 departure) — the confirmed flight(s) for that day with FlightRadar24 tracker +
 * Rome2Rio/Google-Flights deep-links.
 *
 * Also acquires the Screen Wake Lock while mounted — this card renders whenever
 * `/travel` has a resolved day, i.e. the whole time Travel Mode is meaningfully on-screen.
 */

/** The 4 travel days of the default pack, each mapped to its confirmed Journey(ies)
 * (`lib/booking-data.ts`). Dec 18 = departure from Kathmandu; Dec 19 = arrival in Tokyo AND
 * the Tokyo→Osaka domestic hop the same day — both journeys surface on Dec 19. */
export const TRAVEL_DAY_JOURNEYS: Record<string, Journey[]> = {
  '2026-12-09': [OUTBOUND_JOURNEY],
  '2026-12-18': [RETURN_TO_JAPAN_JOURNEY],
  '2026-12-19': [RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY],
  '2027-01-09': [FLIGHT_HOME_JOURNEY],
};

export default function TravelEssentialsCard({ date }: { date: string }) {
  const country = getCountryForDate(date);
  const city = getCityForDate(date);
  const currency = legCurrency(country);
  const { model } = useBudget();
  const home = model.homeCurrency;

  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [airQuality, setAirQuality] = useState<AirQualityResult | null>(null);
  const [rate, setRate] = useState<CurrencyRateResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWeather(city).then((r) => {
      if (!cancelled) setWeather(r);
    });
    return () => {
      cancelled = true;
    };
  }, [city]);

  // #251 — a separate fetch to a separate host (air-quality-api.open-meteo.com); it doesn't
  // ride along on the forecast response the way the 7-day outlook does.
  useEffect(() => {
    let cancelled = false;
    fetchAirQuality(city).then((r) => {
      if (!cancelled) setAirQuality(r);
    });
    return () => {
      cancelled = true;
    };
  }, [city]);

  useEffect(() => {
    // Leg currency === home currency: nothing to convert, so skip the fetch (and the panel
    // that would render it) entirely rather than fetch-and-hide.
    if (currency === home) return;
    let cancelled = false;
    fetchCurrencyRate(currency).then((r) => {
      if (!cancelled) setRate(r);
    });
    return () => {
      cancelled = true;
    };
  }, [currency, home]);

  // Wake lock: held the whole time this card (i.e. Travel Mode with a resolved day) is
  // on-screen; released automatically on unmount (navigation away) or tab hide.
  const wakeLock = useWakeLock(true);

  // #220 — the home clock. Reads the REAL clock, never `getNow()`: `?today=` moves the trip's
  // day, not the wall time in Syracuse, and a demo day would render a home time that is simply
  // wrong. Recomputed on the shared `/travel` tick (base 20s) rather than a fifth interval of its
  // own, and set in an effect so the server never renders an hour the client then contradicts.
  const tickN = useTravelTick();
  const [homeClock, setHomeClock] = useState<string | null>(null);
  useEffect(() => {
    setHomeClock(formatHomeClock(new Date()));
  }, [tickN]);

  // A-12: real emergency contacts and confirmed-flight journeys are DEFAULT-PACK content —
  // a custom trip has neither, and showing Japan/Nepal's numbers to a traveler who isn't
  // there is a safety defect, not a labeling one. Gate both to the default trip.
  const showRealSafety = isDefaultTrip();
  const safetyCountry: 'Nepal' | 'Japan' | null = showRealSafety
    ? country === 'nepal'
      ? 'Nepal'
      : 'Japan'
    : null;
  const contacts = showRealSafety
    ? EMERGENCY_CONTACTS.filter((c) => c.country === safetyCountry).slice(0, 3)
    : [];

  const journeys = showRealSafety ? (TRAVEL_DAY_JOURNEYS[date] ?? []) : [];

  // Same predicate as the safety gate, different reason, so it gets its own name: HOME_TIME_ZONE
  // is an assumption derived from the DEFAULT pack's flight-home destination (see its doc in
  // `core/dates/item-time.ts`). A custom trip's traveller does not live in Syracuse, and a
  // confidently wrong home clock is worse than none.
  const showHomeClock = isDefaultTrip();

  // Essentials collapses to ONE row (a native <details>, closed by default) so the day's
  // checklist is the primary surface. Content stays mounted while collapsed — the weather/currency
  // fetch effects above still run — it is only visually folded behind the summary.
  return (
    <details
      data-testid="travel-essentials"
      className="group mx-auto mt-4 max-w-2xl overflow-hidden rounded-2xl glass-card"
    >
      <summary
        data-testid="travel-essentials-summary"
        className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 id="travel-essentials-title" className="font-display text-base font-bold text-white">
            Essentials
          </h2>
          <span className="text-xs text-ink-mid">
            weather &middot; currency &middot; safety{journeys.length > 0 ? ' · flights' : ''}
          </span>
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-ink-mid transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {wakeLock.supported && wakeLock.held && (
          <p data-testid="travel-wake-lock-hint" className="text-xs text-ink-mid">
            Screen stays awake while Travel Mode is open
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <WeatherPanel city={city} weather={weather} airQuality={airQuality} />
          {currency !== home && <CurrencyPanel currency={currency} rate={rate} />}
          {showHomeClock && homeClock !== null && <HomeClockPanel time={homeClock} />}
        </div>

        <SafetyPanel country={safetyCountry} contacts={contacts} />

        {journeys.length > 0 && (
          <div className="mt-5 flex flex-col gap-4" data-testid="travel-essentials-flights">
            {journeys.map((journey) => (
              <FlightCard key={journey.id} journey={journey} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function WeatherPanel({
  city,
  weather,
  airQuality,
}: {
  city: string;
  weather: WeatherResult | null;
  airQuality: AirQualityResult | null;
}) {
  return (
    <div
      data-testid="travel-essentials-weather"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
        Weather — {city}
      </p>
      {weather === null && (
        <p className="mt-2 text-sm text-ink-mid" data-testid="travel-essentials-weather-loading">
          Loading…
        </p>
      )}
      {weather?.status === 'ok' && (
        <p className="mt-2 text-sm text-ink-hi">
          <span className="text-lg font-semibold text-white">{weather.data.tempC}&deg;C</span>{' '}
          {weatherCodeToLabel(weather.data.weatherCode)}
          {weather.data.feelsLikeC !== null && (
            <span
              className="mt-0.5 block text-xs text-ink-mid"
              data-testid="travel-essentials-weather-feels-like"
            >
              Feels like {weather.data.feelsLikeC}&deg;C
            </span>
          )}
          {/* #278 — a qualitative fog-risk signal, never a raw metre figure and never an
              aviation call (no "safe to fly" / "expect delays"). Absent when the response (or
              an old cache entry) didn't carry a visibility reading. */}
          {weather.data.visibilityM !== null && (
            <span
              className="mt-0.5 block text-xs text-ink-mid"
              data-testid="travel-essentials-weather-fog-risk"
            >
              {fogRiskLabel(weather.data.visibilityM).label}
            </span>
          )}
          {weather.data.stale && (
            <span className="ml-1.5 text-xs text-ink-mid" data-testid="travel-essentials-weather-stale">
              (cached — as of {formatWeatherAsOf(weather.data.fetchedAt)})
            </span>
          )}
        </p>
      )}
      {weather?.status === 'unavailable' && (
        <p className="mt-2 text-sm text-ink-mid" data-testid="travel-essentials-weather-unavailable">
          Weather unavailable right now.
        </p>
      )}
      {/* #251 — air quality, its own fetch/cache so it degrades independently of the
          weather panel above. `usAqi` is the clearer at-a-glance signal (well-known 6-band
          scale); pm2.5 stands in on its own if a body ever carries one field but not the other. */}
      {airQuality?.status === 'ok' && (
        <p
          className="mt-1.5 text-xs text-ink-mid"
          data-testid="travel-essentials-air-quality"
        >
          Air quality:{' '}
          {airQuality.data.usAqi !== null
            ? `${usAqiLabel(airQuality.data.usAqi)} (AQI ${airQuality.data.usAqi})`
            : airQuality.data.pm25 !== null
              ? `PM2.5 ${airQuality.data.pm25} µg/m³`
              : 'reading unavailable'}
          {airQuality.data.stale && ' (cached)'}
        </p>
      )}
      {airQuality?.status === 'unavailable' && (
        <p className="mt-1.5 text-xs text-ink-mid" data-testid="travel-essentials-air-quality-unavailable">
          Air quality unavailable right now.
        </p>
      )}
    </div>
  );
}

/**
 * #220 — what time it is at home, so "is it a reasonable hour to call" stops being two offset
 * conversions done in your head with a change of country in between.
 *
 * No `aria-live`: this re-renders every 20s and an announced clock would talk over everything
 * else on the screen. A screen-reader user reads it on demand, like the rest of the panel.
 *
 * A `<span>` and NOT a `<time>`: a `<time>` with no `datetime` attribute must have valid
 * datetime-string CONTENT, and "Sat 9:30 PM" is not one. The element buys no assistive-tech
 * behaviour here, so the valid markup is the plain one.
 */
function HomeClockPanel({ time }: { time: string }) {
  return (
    <div
      data-testid="travel-essentials-home-clock"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
        Home time
      </p>
      <p className="mt-2 text-sm text-ink-hi">
        <span className="text-lg font-semibold text-white">{time}</span>
        <span className="mt-0.5 block text-xs text-ink-mid">Syracuse, NY (US Eastern)</span>
      </p>
    </div>
  );
}

function CurrencyPanel({ currency, rate }: { currency: string; rate: CurrencyRateResult | null }) {
  return (
    <div
      data-testid="travel-essentials-currency"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
        Currency
      </p>
      {rate === null && (
        <p className="mt-2 text-sm text-ink-mid" data-testid="travel-essentials-currency-loading">
          Loading…
        </p>
      )}
      {rate?.status === 'ok' && (
        <p className="mt-2 text-sm text-ink-hi">
          <span className="font-semibold text-white">
            {rate.data.source === 'reference' ? '≈ ' : ''}
            1 USD = {rate.data.rate.toLocaleString()} {currency}
          </span>
          <span className="mt-0.5 block text-xs text-ink-mid" data-testid="travel-essentials-currency-asof">
            {rate.data.source === 'reference' ? (
              <span data-testid="travel-essentials-currency-reference">
                reference rate, as of {rate.data.asOf} — not a live quote
              </span>
            ) : (
              <>
                as of {rate.data.asOf}
                {rate.data.stale ? ' (cached)' : ''}
              </>
            )}
          </span>
        </p>
      )}
      {rate?.status === 'unavailable' && (
        <p className="mt-2 text-sm text-ink-mid" data-testid="travel-essentials-currency-unavailable">
          Rate unavailable — try the Budget page.
        </p>
      )}
    </div>
  );
}

function SafetyPanel({
  country,
  contacts,
}: {
  /** `null` on a non-default (custom) trip: there is no real emergency-contacts pack for it. */
  country: 'Nepal' | 'Japan' | null;
  contacts: typeof EMERGENCY_CONTACTS;
}) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="travel-essentials-safety">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        {country ? `Emergency — ${country}` : 'Emergency'}
      </p>
      {country ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {contacts.map((c) => (
            <li key={c.id}>
              <a
                href={`tel:${c.tel}`}
                aria-label={`Call ${c.service}, ${c.number}`}
                data-testid={`travel-essentials-safety-${c.id}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary/10 px-3 font-mono text-sm font-semibold text-primary outline-none transition-colors hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {c.service}: {c.number}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        // A-12: a custom trip has no real emergency-contacts pack. Going silent here would
        // read as "nothing to report" — worse than saying so — so this fallback line stays
        // in the SAME card shell/testid rather than omitting the section.
        <p className="mt-2 text-sm text-ink-mid" data-testid="travel-essentials-safety-unavailable">
          Emergency numbers aren&apos;t available for this trip yet — check local guidance for
          your destination.
        </p>
      )}
      <Link
        href="/safety/"
        data-testid="travel-essentials-safety-link"
        className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-ink-mid underline decoration-white/20 underline-offset-2 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Full safety kit &amp; phrasebook &rarr;
      </Link>
    </div>
  );
}

/**
 * an external booking/tracking deep-link that goes dead the instant the device is
 * offline (it opens a new tab that can't load). Rather than remove it, dim it in place and mark
 * it `aria-disabled` + intercept the click — re-enables automatically the moment `useOnline()`
 * flips back (no remount needed, `online` is just a prop). The disabled state is conveyed via
 * BOTH the dimmed/grayscale styling AND an `sr-only` text suffix — never color alone.
 */
export function DeepLink({
  href,
  online,
  testId,
  className,
  children,
}: {
  href: string;
  online: boolean;
  testId: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      aria-disabled={online ? undefined : true}
      onClick={(e) => {
        if (!online) e.preventDefault();
      }}
      className={cn(className, !online && 'pointer-events-none opacity-40 grayscale')}
    >
      {children}
      {!online && <span className="sr-only"> (unavailable offline)</span>}
    </a>
  );
}

function FlightCard({ journey }: { journey: Journey }) {
  const online = useOnline();
  const r2r = buildRome2RioUrl(journey.fromSummary, journey.toSummary);
  const gflights = buildGoogleFlightsUrl(journey.fromSummary, journey.toSummary);

  return (
    <div
      data-testid={`travel-essentials-flight-${journey.id}`}
      className="rounded-xl border border-border bg-muted/40 p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Plane className="h-3.5 w-3.5" aria-hidden="true" />
        Travel day — {journey.label}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {journey.legs.map((leg) => {
          const tracker = buildFlightTrackerUrl(leg.flightNumber);
          return (
            <li key={leg.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-hi">
              <span>
                {leg.flightNumber} &middot; {leg.fromCode}&rarr;{leg.toCode} &middot; {leg.departLabel}
              </span>
              {tracker && (
                <DeepLink
                  href={tracker}
                  online={online}
                  testId={`travel-essentials-tracker-${leg.id}`}
                  className="inline-flex min-h-tap items-center rounded-lg px-2 text-xs font-medium text-primary outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Track flight
                </DeepLink>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <DeepLink
          href={r2r}
          online={online}
          testId={`travel-essentials-rome2rio-${journey.id}`}
          className="inline-flex min-h-tap items-center gap-1 rounded-lg bg-white/5 px-3 font-medium text-ink-mid outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Plan this route (Rome2Rio)
        </DeepLink>
        <DeepLink
          href={gflights}
          online={online}
          testId={`travel-essentials-gflights-${journey.id}`}
          className="inline-flex min-h-tap items-center gap-1 rounded-lg bg-white/5 px-3 font-medium text-ink-mid outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Google Flights
        </DeepLink>
      </div>
    </div>
  );
}
