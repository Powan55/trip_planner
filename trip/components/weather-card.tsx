'use client';

import { Sunrise, Sunset, Thermometer, WifiOff, CloudOff, ChevronDown } from 'lucide-react';
import {
  OPEN_METEO_ATTRIBUTION,
  type ForecastDay,
  type WeatherNow,
  type WeatherResult,
} from '@/lib/weather';

/**
 * Trip OS 2: the weather + golden-hour card for the CURRENT trip city.
 *
 * Renders a `WeatherResult` in one of four states:
 *   - `loading`  — a quiet skeleton while the first fetch is in flight (prop `loading`).
 *   - live       — fresh weather (temp / condition / hi-lo / golden hour + attribution).
 *   - cached     — the SAME layout, plus a "last updated …" offline indicator (`data.stale`).
 *   - unavailable— a quiet fallback (no error styling) when there's no data and no cache.
 *
 * Golden hour is highlighted (this is the app's photography theme). A11y: a labelled region,
 * semantic time via visible + `aria-label`led text, an AA-contrast palette, and NO
 * motion-only affordance — the card is static markup, so it is reduced-motion-safe by
 * construction (the parent TodayPanel owns the reveal animation, already reduced-motion gated).
 * Test ids are registered in docs/test-ids.md.
 *
 * A compact 7-day outlook (`data.forecast`) sits below the golden-hour block as a native
 * `<details>` disclosure — collapsed by default so it never dominates the card, keyboard-operable
 * with zero extra JS/state, and reduced-motion-safe via the same global CSS rule as everything
 * else. It rides the SAME `WeatherResult`/`WeatherNow` this component already receives (no new
 * prop, no change to `today-panel.tsx`), and is simply absent — never an error state — when the
 * response didn't carry a usable forecast.
 */

/** Format a golden-hour ISO local datetime ("2026-12-12T06:42") to a "6:42 AM" clock time. */
function formatClock(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/** Format the "last updated" timestamp for the offline indicator (short local date + time). */
function formatUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Label a forecast row's date: "Today" / "Tomorrow" / a short weekday name. Display-only —
 *  parses the "YYYY-MM-DD" local calendar date (no clock read), mirrors `formatClock`. */
function formatDayLabel(date: string, index: number): string {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return date;
  return dt.toLocaleDateString(undefined, { weekday: 'short' });
}

/** One row of the 7-day outlook: day label, condition, hi/lo, and that day's golden-hour times
 *  (photography-ahead — the app's photography theme, extended past just today). */
function ForecastRow({ day, index }: { day: ForecastDay; index: number }) {
  return (
    <li
      data-testid="weather-forecast-day"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 py-2 text-xs first:border-t-0 first:pt-1"
    >
      <span className="w-16 flex-shrink-0 font-medium text-white/75">
        {formatDayLabel(day.date, index)}
      </span>
      <span className="min-w-[6rem] flex-1 text-white/55">{day.condition}</span>
      <span
        className="text-white/70"
        aria-label={`High ${day.highC} degrees, low ${day.lowC} degrees`}
      >
        {day.highC}° / {day.lowC}°
      </span>
      <span
        className="flex items-center gap-1 text-[11px] text-gold-400/80"
        aria-label={`Golden hour: morning ${formatClock(day.goldenMorning.start)}, evening ${formatClock(
          day.goldenEvening.end,
        )}`}
      >
        <Sunrise className="h-3 w-3" aria-hidden="true" />
        {formatClock(day.goldenMorning.start)}
        <Sunset className="ml-1 h-3 w-3" aria-hidden="true" />
        {formatClock(day.goldenEvening.end)}
      </span>
    </li>
  );
}

/**
 * The 7-day outlook — a compact, SECONDARY block, collapsed by default (native
 * `<details>`/`<summary>`: keyboard-operable and toggleable with no JS state, reduced-motion
 * safe by construction, and never dominates the card above the current conditions). `stale`
 * mirrors the parent card's own offline flag — the outlook was cached in the same round-trip
 * as the current conditions, so it carries the same freshness.
 */
function ForecastOutlook({ days, stale }: { days: ForecastDay[]; stale: boolean }) {
  return (
    <details data-testid="weather-forecast" className="group mt-4">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-medium text-white/70 outline-none transition-colors duration-200 hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 [&::-webkit-details-marker]:hidden">
        <span>
          7-day outlook
          {stale && <span className="sr-only"> (cached — offline)</span>}
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-white/50 transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ol className="mt-2">
        {days.map((day, i) => (
          <ForecastRow key={day.date} day={day} index={i} />
        ))}
      </ol>
    </details>
  );
}

/** A small pill row for one golden-hour window. */
function GoldenRow({
  icon,
  label,
  start,
  end,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  start: string;
  end: string;
  testId: string;
}) {
  const range = `${formatClock(start)} – ${formatClock(end)}`;
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2 rounded-lg border border-gold-400/20 bg-gold-400/[0.06] px-3 py-2"
    >
      <span className="text-gold-400" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 text-xs font-medium text-white/70">{label}</span>
      <span className="text-sm font-semibold text-gold-300" aria-label={`${label}: ${range}`}>
        {range}
      </span>
    </div>
  );
}

/** The Open-Meteo attribution pill (CC-BY 4.0) — required by their license. */
function Attribution() {
  return (
    <a
      href={OPEN_METEO_ATTRIBUTION.href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="weather-attribution"
      className="mt-3 inline-block text-[10px] text-white/50 hover:text-white/70 transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded"
    >
      {OPEN_METEO_ATTRIBUTION.label}
    </a>
  );
}

// Skeleton shimmer: the loading bars use the shared `.animate-shimmer` sweep
// (a moving gradient) instead of the plain `animate-pulse` opacity blink, for a more
// premium loading feel — consistent with SectionSkeleton. Both are already neutralized
// under prefers-reduced-motion in globals.css (the sweep hard-stops to a static muted
// block), so this stays reduced-motion-safe. The 200%-wide gradient is what the
// keyframe travels across.
const SHIMMER_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, hsl(var(--muted)) 0%, hsl(var(--secondary)) 20%, hsl(var(--muted)) 40%, hsl(var(--muted)) 100%)',
  backgroundSize: '200% 100%',
};

function LoadingState() {
  return (
    <div
      data-testid="weather-card"
      data-state="loading"
      role="status"
      aria-busy="true"
      aria-label="Loading weather"
      // min-height approximates the loaded WeatherBody (conditions row + golden-hour block +
      // attribution) so the agenda below does not jump when weather resolves.
      className="min-h-[220px] rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="flex items-center gap-3">
        <div className="animate-shimmer h-10 w-16 rounded" style={SHIMMER_STYLE} aria-hidden="true" />
        <div className="flex-1 space-y-2" aria-hidden="true">
          <div className="animate-shimmer h-3 w-24 rounded" style={SHIMMER_STYLE} />
          <div className="animate-shimmer h-3 w-16 rounded" style={SHIMMER_STYLE} />
        </div>
      </div>
    </div>
  );
}

function UnavailableState() {
  return (
    <div
      data-testid="weather-card"
      data-state="unavailable"
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <CloudOff className="h-5 w-5 flex-shrink-0 text-white/25" aria-hidden="true" />
      <p className="text-sm text-white/55">Weather is unavailable right now.</p>
    </div>
  );
}

function WeatherBody({ data }: { data: WeatherNow }) {
  return (
    <section
      data-testid="weather-card"
      data-state={data.stale ? 'cached' : 'live'}
      aria-labelledby="weather-heading"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <h3 id="weather-heading" className="sr-only">
        Weather in {data.city}
      </h3>

      {/* Current conditions — temp + condition + hi/lo. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Thermometer className="h-6 w-6 text-gold-400" aria-hidden="true" />
          <div>
            <p className="leading-none">
              <span
                data-testid="weather-temp"
                className="font-display text-3xl font-bold text-white"
              >
                {data.tempC}°
              </span>
              <span className="text-lg text-white/50">C</span>
            </p>
            <p data-testid="weather-condition" className="mt-1 text-sm text-white/70">
              {data.condition}
            </p>
          </div>
        </div>
        <p className="text-right text-xs text-white/50" data-testid="weather-hilo">
          <span aria-label={`High ${data.highC} degrees`}>H: {data.highC}°</span>
          <br />
          <span aria-label={`Low ${data.lowC} degrees`}>L: {data.lowC}°</span>
        </p>
      </div>

      {/* Golden hour — highlighted for photographers (the app's photography theme). */}
      <div className="mt-4 space-y-2" data-testid="weather-golden-hour">
        <p className="text-[10px] uppercase tracking-widest text-gold-400/70">
          Golden hour · {data.city}
        </p>
        <GoldenRow
          testId="weather-golden-morning"
          icon={<Sunrise className="h-4 w-4" />}
          label="Morning"
          start={data.goldenMorning.start}
          end={data.goldenMorning.end}
        />
        <GoldenRow
          testId="weather-golden-evening"
          icon={<Sunset className="h-4 w-4" />}
          label="Evening"
          start={data.goldenEvening.start}
          end={data.goldenEvening.end}
        />
      </div>

      {/* 7-day outlook — compact, collapsed-by-default, never dominates the card. Absent
          (not an error) when the response didn't carry a usable forecast. */}
      {data.forecast && data.forecast.length > 0 && (
        <ForecastOutlook days={data.forecast} stale={data.stale} />
      )}

      {/* Offline / cached indicator — only when we're showing stale data. */}
      {data.stale && (
        <p
          data-testid="weather-cached-indicator"
          className="mt-3 flex items-center gap-1.5 text-[11px] text-white/55"
          aria-live="polite"
        >
          <WifiOff className="h-3 w-3" aria-hidden="true" />
          Offline — last updated {formatUpdated(data.fetchedAt)}
        </p>
      )}

      <Attribution />
    </section>
  );
}

/**
 * The public weather card. `loading` renders the skeleton; otherwise the `result` decides
 * live / cached / unavailable. Keeping the state selection here (not in TodayPanel) keeps the
 * panel integration a one-liner.
 */
export default function WeatherCard({
  result,
  loading,
}: {
  result: WeatherResult | null;
  loading: boolean;
}) {
  if (loading || result === null) return <LoadingState />;
  if (result.status === 'unavailable') return <UnavailableState />;
  return <WeatherBody data={result.data} />;
}
