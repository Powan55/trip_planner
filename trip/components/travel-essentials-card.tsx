'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cloud, Wallet, ShieldAlert, Plane } from 'lucide-react';
import { getCountryForDate, getCityForDate } from '@/core/dates';
import { legCurrency } from '@/core/budget/model';
import { EMERGENCY_CONTACTS } from '@/core/content/safety';
import { fetchWeather, weatherCodeToLabel, type WeatherResult } from '@/lib/weather';
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
const TRAVEL_DAY_JOURNEYS: Record<string, Journey[]> = {
  '2026-12-09': [OUTBOUND_JOURNEY],
  '2026-12-18': [RETURN_TO_JAPAN_JOURNEY],
  '2026-12-19': [RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY],
  '2027-01-09': [FLIGHT_HOME_JOURNEY],
};

export default function TravelEssentialsCard({ date }: { date: string }) {
  const country = getCountryForDate(date);
  const city = getCityForDate(date);
  const currency = legCurrency(country);

  const [weather, setWeather] = useState<WeatherResult | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    fetchCurrencyRate(currency).then((r) => {
      if (!cancelled) setRate(r);
    });
    return () => {
      cancelled = true;
    };
  }, [currency]);

  // Wake lock: held the whole time this card (i.e. Travel Mode with a resolved day) is
  // on-screen; released automatically on unmount (navigation away) or tab hide.
  const wakeLock = useWakeLock(true);

  const contacts = EMERGENCY_CONTACTS.filter(
    (c) => c.country === (country === 'nepal' ? 'Nepal' : 'Japan'),
  ).slice(0, 3);

  const journeys = TRAVEL_DAY_JOURNEYS[date] ?? [];

  return (
    <section
      aria-labelledby="travel-essentials-title"
      data-testid="travel-essentials"
      className="mx-auto mt-4 max-w-2xl rounded-2xl glass-card p-6 sm:p-8"
    >
      <h2 id="travel-essentials-title" className="font-display text-xl font-bold text-white">
        Essentials
      </h2>

      {wakeLock.supported && wakeLock.held && (
        <p data-testid="travel-wake-lock-hint" className="mt-1 text-xs text-white/40">
          Screen stays awake while Travel Mode is open
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <WeatherPanel city={city} weather={weather} />
        <CurrencyPanel currency={currency} rate={rate} />
      </div>

      <SafetyPanel country={country === 'nepal' ? 'Nepal' : 'Japan'} contacts={contacts} />

      {journeys.length > 0 && (
        <div className="mt-5 flex flex-col gap-4" data-testid="travel-essentials-flights">
          {journeys.map((journey) => (
            <FlightCard key={journey.id} journey={journey} />
          ))}
        </div>
      )}
    </section>
  );
}

function WeatherPanel({ city, weather }: { city: string; weather: WeatherResult | null }) {
  return (
    <div
      data-testid="travel-essentials-weather"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-gold-400/80">
        <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
        Weather — {city}
      </p>
      {weather === null && (
        <p className="mt-2 text-sm text-white/50" data-testid="travel-essentials-weather-loading">
          Loading…
        </p>
      )}
      {weather?.status === 'ok' && (
        <p className="mt-2 text-sm text-white/85">
          <span className="text-lg font-semibold text-white">{weather.data.tempC}&deg;C</span>{' '}
          {weatherCodeToLabel(weather.data.weatherCode)}
          {weather.data.stale && (
            <span className="ml-1.5 text-xs text-white/40" data-testid="travel-essentials-weather-stale">
              (cached)
            </span>
          )}
        </p>
      )}
      {weather?.status === 'unavailable' && (
        <p className="mt-2 text-sm text-white/50" data-testid="travel-essentials-weather-unavailable">
          Weather unavailable right now.
        </p>
      )}
    </div>
  );
}

function CurrencyPanel({ currency, rate }: { currency: string; rate: CurrencyRateResult | null }) {
  return (
    <div
      data-testid="travel-essentials-currency"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-gold-400/80">
        <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
        Currency
      </p>
      {rate === null && (
        <p className="mt-2 text-sm text-white/50" data-testid="travel-essentials-currency-loading">
          Loading…
        </p>
      )}
      {rate?.status === 'ok' && (
        <p className="mt-2 text-sm text-white/85">
          <span className="font-semibold text-white">1 USD = {rate.data.rate.toLocaleString()} {currency}</span>
          <span className="mt-0.5 block text-xs text-white/40" data-testid="travel-essentials-currency-asof">
            as of {rate.data.asOf}
            {rate.data.stale ? ' (cached)' : ''}
          </span>
        </p>
      )}
      {rate?.status === 'unavailable' && (
        <p className="mt-2 text-sm text-white/50" data-testid="travel-essentials-currency-unavailable">
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
  country: 'Nepal' | 'Japan';
  contacts: typeof EMERGENCY_CONTACTS;
}) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="travel-essentials-safety">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-gold-400/80">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Emergency — {country}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {contacts.map((c) => (
          <li key={c.id}>
            <a
              href={`tel:${c.tel}`}
              aria-label={`Call ${c.service}, ${c.number}`}
              data-testid={`travel-essentials-safety-${c.id}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gold-500/15 px-3 font-mono text-sm font-semibold text-gold-300 outline-none transition-colors hover:bg-gold-500/25 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {c.service}: {c.number}
            </a>
          </li>
        ))}
      </ul>
      <Link
        href="/safety/"
        data-testid="travel-essentials-safety-link"
        className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-white/60 underline decoration-white/20 underline-offset-2 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
      >
        Full safety kit &amp; phrasebook &rarr;
      </Link>
    </div>
  );
}

function FlightCard({ journey }: { journey: Journey }) {
  const r2r = buildRome2RioUrl(journey.fromSummary, journey.toSummary);
  const gflights = buildGoogleFlightsUrl(journey.fromSummary, journey.toSummary);

  return (
    <div
      data-testid={`travel-essentials-flight-${journey.id}`}
      className="rounded-xl border border-gold-400/20 bg-gold-400/[0.05] p-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-gold-400/80">
        <Plane className="h-3.5 w-3.5" aria-hidden="true" />
        Travel day — {journey.label}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {journey.legs.map((leg) => {
          const tracker = buildFlightTrackerUrl(leg.flightNumber);
          return (
            <li key={leg.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/80">
              <span>
                {leg.flightNumber} &middot; {leg.fromCode}&rarr;{leg.toCode} &middot; {leg.departLabel}
              </span>
              {tracker && (
                <a
                  href={tracker}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`travel-essentials-tracker-${leg.id}`}
                  className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-xs font-medium text-gold-300 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                >
                  Track flight
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <a
          href={r2r}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`travel-essentials-rome2rio-${journey.id}`}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-white/5 px-3 font-medium text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          Plan this route (Rome2Rio)
        </a>
        <a
          href={gflights}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`travel-essentials-gflights-${journey.id}`}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-white/5 px-3 font-medium text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          Google Flights
        </a>
      </div>
    </div>
  );
}
