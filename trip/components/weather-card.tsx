'use client';

import { Sunrise, Sunset, Thermometer, WifiOff, CloudOff } from 'lucide-react';
import {
  OPEN_METEO_ATTRIBUTION,
  type WeatherNow,
  type WeatherResult,
} from '@/lib/weather';

/**
 * The weather + golden-hour card for the CURRENT trip city.
 *
 * Renders a `WeatherResult` in one of four states:
 *   - `loading`  — a quiet skeleton while the first fetch is in flight (prop `loading`).
 *   - live       — fresh weather (temp / condition / hi-lo / golden hour + attribution).
 *   - cached     — the SAME layout, plus a "last updated …" offline indicator (`data.stale`).
 *   - unavailable— a quiet fallback (no error styling) when there's no data and no cache.
 *
 * Golden hour is highlighted (this is the app's photography theme). A11y: a labelled region,
 * semantic time via visible + `aria-label`led text, AA-contrast palette, and NO
 * motion-only affordance — the card is static markup, so it is reduced-motion-safe by
 * construction (the parent TodayPanel owns the reveal animation, already reduced-motion gated).
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

/** The Open-Meteo attribution pill (CC-BY 4.0) — required by the data license. */
function Attribution() {
  return (
    <a
      href={OPEN_METEO_ATTRIBUTION.href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="weather-attribution"
      className="mt-3 inline-block text-[10px] text-white/30 hover:text-white/50 transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded"
    >
      {OPEN_METEO_ATTRIBUTION.label}
    </a>
  );
}

function LoadingState() {
  return (
    <div
      data-testid="weather-card"
      data-state="loading"
      aria-busy="true"
      aria-label="Loading weather"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-16 rounded bg-white/10 animate-pulse" aria-hidden="true" />
        <div className="flex-1 space-y-2" aria-hidden="true">
          <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
          <div className="h-3 w-16 rounded bg-white/5 animate-pulse" />
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
      <p className="text-sm text-white/40">Weather is unavailable right now.</p>
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

      {/* Offline / cached indicator — only when we're showing stale data. */}
      {data.stale && (
        <p
          data-testid="weather-cached-indicator"
          className="mt-3 flex items-center gap-1.5 text-[11px] text-white/40"
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
