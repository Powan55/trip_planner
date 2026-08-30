'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { differenceInCalendarDays } from 'date-fns';
import { ChevronDown } from 'lucide-react';
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
import { getActiveTripCityCoord } from '@/core/trips/registry';
import { fetchCurrencyRate, type CurrencyRateResult } from '@/lib/currency-rate';
import { getNow } from '@/lib/trip-now';
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
 * Drawn as the systems annunciator: one hairline-ruled row per subject, each carrying a mark, a
 * name, its condition IN WORDS and a value. The mark is redundant by design — every row says what
 * it knows in a sentence, so nothing here depends on colour, and a reading that failed reads as a
 * failed reading rather than as a missing row.
 *
 * The subjects: leg-correct weather (reuses `weatherCache` via `fetchWeather` — no new fetch
 * path), air quality (its own fetch/cache so it degrades independently), a live USD→leg-currency
 * rate (`lib/currency-rate.ts`), the home clock, a compact safety/emergency-numbers subset
 * (`core/content/safety.ts`, read-only, links to `/safety` for the rest), and — ONLY on the trip's
 * four travel days (Dec 9 arrival, Dec 18/19 leg hop, Jan 9 departure) — the confirmed flight(s)
 * for that day with FlightRadar24 tracker + Rome2Rio/Google-Flights deep-links.
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

/** One annunciator row. `state` picks the mark; the condition is always stated in words. */
function SysRow({
  state,
  name,
  condition,
  value,
  unit,
  testId,
  children,
}: {
  state: 'struck' | 'hollow';
  name: string;
  condition: React.ReactNode;
  value?: React.ReactNode;
  unit?: React.ReactNode;
  testId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="r" data-s={state} data-testid={testId}>
      <span className={state === 'struck' ? 'mk mk--struck' : 'mk mk--hollow'} />
      <span className="min-w-0">
        <span className="nm block">{name}</span>
        <span className="cond block">{condition}</span>
        {children}
      </span>
      <span className="val">
        {value !== undefined && <b>{value}</b>}
        {unit !== undefined && <i>{unit}</i>}
      </span>
    </div>
  );
}

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
    // #250: prefer this trip's own resolved coordinate over the static default-pack table.
    fetchWeather(city, fetch, getActiveTripCityCoord(city)).then((r) => {
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
    fetchAirQuality(city, fetch, getActiveTripCityCoord(city)).then((r) => {
      if (!cancelled) setAirQuality(r);
    });
    return () => {
      cancelled = true;
    };
  }, [city]);

  useEffect(() => {
    // Leg currency === home currency: nothing to convert, so skip the fetch (and the row
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

  // Same predicate as the safety gate, different reason, so it gets its own name: HOME_TIME_ZONE
  // is an assumption derived from the DEFAULT pack's flight-home destination (see its doc in
  // `core/dates/item-time.ts`). A custom trip's traveller does not live in Syracuse, and a
  // confidently wrong home clock is worse than none.
  const showHomeClock = isDefaultTrip();

  const journeys = showRealSafety ? (TRAVEL_DAY_JOURNEYS[date] ?? []) : [];

  // Essentials collapses to ONE row (a native <details>, closed by default) so the day's
  // checklist is the primary surface. Content stays mounted while collapsed — the weather/currency
  // fetch effects above still run — it is only visually folded behind the summary.
  return (
    <details
      data-testid="travel-essentials"
      className="group mx-auto mt-4 max-w-2xl border-t-2 border-border"
    >
      <summary
        data-testid="travel-essentials-summary"
        className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-gut py-2 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 id="travel-essentials-title" className="pr pr--l text-ink-hi">
            Essentials
          </h2>
          <span className="pr pr--lo">
            weather &middot; air &middot; currency &middot; safety{journeys.length > 0 ? ' · flights' : ''}
          </span>
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-ink-lo transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>

      <div className="sys">
        <WeatherRow city={city} weather={weather} />
        <AirQualityRow airQuality={airQuality} />
        {currency !== home && <CurrencyRow currency={currency} rate={rate} />}
        {showHomeClock && homeClock !== null && <HomeClockRow time={homeClock} />}
        <SafetyRow country={safetyCountry} contacts={contacts} />
        {wakeLock.supported && wakeLock.held && (
          <SysRow
            testId="travel-wake-lock-hint"
            state="struck"
            name="Screen"
            condition="stays awake while Travel Mode is open"
            value="on"
          />
        )}
      </div>

      {journeys.length > 0 && (
        <div className="sys" data-testid="travel-essentials-flights">
          {journeys.map((journey) => (
            <FlightRows key={journey.id} journey={journey} />
          ))}
        </div>
      )}

      <div className="px-gut py-3">
        <Link
          href="/safety/"
          data-testid="travel-essentials-safety-link"
          className="btn btn--2 w-full no-underline"
        >
          Full safety kit
        </Link>
      </div>
    </details>
  );
}

function WeatherRow({ city, weather }: { city: string; weather: WeatherResult | null }) {
  if (weather === null) {
    return (
      <SysRow
        testId="travel-essentials-weather"
        state="hollow"
        name={`Weather — ${city}`}
        condition={<span data-testid="travel-essentials-weather-loading">reading the forecast</span>}
        value={<span className="load px-2 text-t-micro">Loading</span>}
      />
    );
  }

  if (weather.status !== 'ok') {
    return (
      <SysRow
        testId="travel-essentials-weather"
        state="hollow"
        name={`Weather — ${city}`}
        condition={
          <span data-testid="travel-essentials-weather-unavailable">
            no reading available right now
          </span>
        }
        value="—"
        unit="unread"
      />
    );
  }

  const d = weather.data;
  return (
    <SysRow
      testId="travel-essentials-weather"
      state="struck"
      name={`Weather — ${city}`}
      condition={
        <>
          {weatherCodeToLabel(d.weatherCode)}
          {d.feelsLikeC !== null && (
            <span data-testid="travel-essentials-weather-feels-like">
              {' '}
              &middot; feels like {d.feelsLikeC}&deg;C
            </span>
          )}
          {/* #278 — a qualitative fog-risk signal, never a raw metre figure and never an
              aviation call (no "safe to fly" / "expect delays"). Absent when the response (or
              an old cache entry) didn't carry a visibility reading. */}
          {d.visibilityM !== null && (
            <span data-testid="travel-essentials-weather-fog-risk">
              {' '}
              &middot; {fogRiskLabel(d.visibilityM).label}
            </span>
          )}
          {d.stale && (
            <span data-testid="travel-essentials-weather-stale">
              {' '}
              &middot; cached, as of {formatWeatherAsOf(d.fetchedAt)}
            </span>
          )}
        </>
      }
      value={d.tempC}
      unit="°c"
    />
  );
}

/** #251 — air quality has its own fetch/cache, so it is its own row and degrades on its own.
 *  `usAqi` is the clearer at-a-glance signal (well-known 6-band scale); pm2.5 stands in when a
 *  body carries one field but not the other. */
function AirQualityRow({ airQuality }: { airQuality: AirQualityResult | null }) {
  if (airQuality === null) return null;

  if (airQuality.status !== 'ok') {
    return (
      <SysRow
        state="hollow"
        name="Air quality"
        condition={
          <span data-testid="travel-essentials-air-quality-unavailable">
            no reading available right now
          </span>
        }
        value="—"
        unit="unread"
      />
    );
  }

  const d = airQuality.data;
  return (
    <SysRow
      testId="travel-essentials-air-quality"
      state="struck"
      name="Air quality"
      condition={
        <>
          {d.usAqi !== null
            ? usAqiLabel(d.usAqi)
            : d.pm25 !== null
              ? `PM2.5 ${d.pm25} µg/m³`
              : 'reading unavailable'}
          {d.stale && ' · cached'}
        </>
      }
      value={d.usAqi !== null ? d.usAqi : d.pm25 !== null ? d.pm25 : '—'}
      unit={d.usAqi !== null ? 'aqi' : d.pm25 !== null ? 'pm2.5' : ''}
    />
  );
}

/**
 * Whole calendar days between a `YYYY-MM-DD` `asOf` date and now (a bare date string
 * doesn't tell anyone whether a rate is 3 days or 3 months stale). `T00:00:00` parses `asOf` as
 * LOCAL midnight, matching `TRIP_START`'s convention (`core/dates/trip-dates.ts`), not the
 * UTC midnight a bare date-only ISO string parses to. Clamped at 0 so clock skew (asOf briefly
 * "in the future") never prints a negative age.
 */
function daysOld(asOf: string): string {
  const days = Math.max(0, differenceInCalendarDays(getNow(), new Date(`${asOf}T00:00:00`)));
  return `${days} day${days === 1 ? '' : 's'} old`;
}

/**
 * What time it is at home, so "is it a reasonable hour to call" stops being two offset
 * conversions done in your head with a change of country in between.
 *
 * No `aria-live`: this re-renders every 20s and an announced clock would talk over everything
 * else on the screen. A screen-reader user reads it on demand, like the rest of the panel.
 */
function HomeClockRow({ time }: { time: string }) {
  return (
    <SysRow
      testId="travel-essentials-home-clock"
      state="struck"
      name="Home time"
      condition="Syracuse, NY (US Eastern)"
      value={time}
    />
  );
}

function CurrencyRow({ currency, rate }: { currency: string; rate: CurrencyRateResult | null }) {
  if (rate === null) {
    return (
      <SysRow
        testId="travel-essentials-currency"
        state="hollow"
        name="Currency"
        condition={<span data-testid="travel-essentials-currency-loading">reading the rate</span>}
        value={<span className="load px-2 text-t-micro">Loading</span>}
      />
    );
  }

  if (rate.status !== 'ok') {
    return (
      <SysRow
        testId="travel-essentials-currency"
        state="hollow"
        name="Currency"
        condition={
          <span data-testid="travel-essentials-currency-unavailable">
            no rate available — the Budget page carries the seeded one
          </span>
        }
        value="—"
        unit={currency}
      />
    );
  }

  const d = rate.data;
  return (
    <SysRow
      testId="travel-essentials-currency"
      state="struck"
      name="Currency"
      condition={
        <span data-testid="travel-essentials-currency-asof">
          {d.source === 'reference' ? (
            <span data-testid="travel-essentials-currency-reference">
              reference rate, as of {d.asOf} — not a live quote (
              <span data-testid="travel-essentials-currency-age">{daysOld(d.asOf)}</span>)
            </span>
          ) : (
            <>
              1 USD, as of {d.asOf}
              {d.stale ? (
                <>
                  {' '}
                  (cached, <span data-testid="travel-essentials-currency-age">{daysOld(d.asOf)}</span>)
                </>
              ) : (
                ''
              )}
            </>
          )}
        </span>
      }
      value={`${d.source === 'reference' ? '≈' : ''}${d.rate.toLocaleString()}`}
      unit={`${currency} per USD`}
    />
  );
}

function SafetyRow({
  country,
  contacts,
}: {
  /** `null` on a non-default (custom) trip: there is no real emergency-contacts pack for it. */
  country: 'Nepal' | 'Japan' | null;
  contacts: typeof EMERGENCY_CONTACTS;
}) {
  return (
    <SysRow
      testId="travel-essentials-safety"
      state={country ? 'struck' : 'hollow'}
      name={country ? `Emergency — ${country}` : 'Emergency'}
      condition={
        country ? (
          `${contacts.length} number${contacts.length === 1 ? '' : 's'} on file for this leg`
        ) : (
          // A-12: a custom trip has no real emergency-contacts pack. Going silent here would
          // read as "nothing to report" — worse than saying so — so this fallback line stays
          // in the SAME row/testid rather than omitting the subject.
          <span data-testid="travel-essentials-safety-unavailable">
            no numbers on file for this trip — check local guidance for your destination
          </span>
        )
      }
      value={contacts.length > 0 ? contacts.length : '—'}
      unit={country ? 'numbers' : 'unfiled'}
    >
      {country && (
        <span className="mt-2 flex flex-wrap gap-2">
          {contacts.map((c) => (
            <a
              key={c.id}
              href={`tel:${c.tel}`}
              aria-label={`Call ${c.service}, ${c.number}`}
              data-testid={`travel-essentials-safety-${c.id}`}
              className="chip chip--struck min-h-tap px-3 outline-none transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.service}: {c.number}
            </a>
          ))}
        </span>
      )}
    </SysRow>
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

/** One confirmed journey: a row per ticketed leg, all struck, plus the two route deep-links. */
function FlightRows({ journey }: { journey: Journey }) {
  const online = useOnline();
  const r2r = buildRome2RioUrl(journey.fromSummary, journey.toSummary);
  const gflights = buildGoogleFlightsUrl(journey.fromSummary, journey.toSummary);

  return (
    <div data-testid={`travel-essentials-flight-${journey.id}`}>
      {journey.legs.map((leg) => {
        const tracker = buildFlightTrackerUrl(leg.flightNumber);
        return (
          <SysRow
            key={leg.id}
            state="struck"
            name={`${leg.fromCode} → ${leg.toCode}`}
            condition={`${journey.label} · ${leg.flightNumber} · ${leg.departLabel}`}
            value={
              tracker ? (
                <DeepLink
                  href={tracker}
                  online={online}
                  testId={`travel-essentials-tracker-${leg.id}`}
                  className="chip min-h-tap px-3 outline-none transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Track
                </DeepLink>
              ) : (
                'ticketed'
              )
            }
          />
        );
      })}
      <div className="flex flex-wrap gap-2 px-gut py-2">
        <DeepLink
          href={r2r}
          online={online}
          testId={`travel-essentials-rome2rio-${journey.id}`}
          className="chip min-h-tap px-3 outline-none transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Rome2Rio
        </DeepLink>
        <DeepLink
          href={gflights}
          online={online}
          testId={`travel-essentials-gflights-${journey.id}`}
          className="chip min-h-tap px-3 outline-none transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Google Flights
        </DeepLink>
      </div>
    </div>
  );
}
