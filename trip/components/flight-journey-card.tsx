'use client';

// FlightJourneyCard — the standalone "Flighty" gold-standard journey card.
// ONE static layout, fully reproducible from `lib/booking-data.ts`; only the phase strip +
// proximity countdown change with `now` (derived from the trip-clock via `lib/flight-phase`,
// NEVER from booking labels —). Kept self-contained so a later change can embed it
// in Travel Mode / the day timeline.
//
// every time/duration/total/date LABEL renders verbatim from the booking (display-only,
// JSX text). This file does NO `new Date`/parse/`getTime` on any label — timing lives entirely
// in `getFlightTiming`.: the actions rail deep-links OUT only, never a live feed.

import { Fragment, useEffect, useState } from 'react';
import { m } from 'framer-motion';
import {
  Plane, Clock, ArrowRight, Armchair, Ticket,
  CircleDashed, Radar, ExternalLink, Timer, PlaneTakeoff, CheckCircle2,
} from 'lucide-react';
import type { Journey, FlightLeg, Layover } from '@/lib/booking-data';
import { getFlightTiming, type FlightPhase, type FlightTiming } from '@/lib/flight-phase';
import { buildFlightTrackerUrl, buildRome2RioUrl, buildGoogleFlightsUrl } from '@/lib/flight-deep-links';

// --- Static class/label records: never interpolate Tailwind class names. ---

// (Seam G) — this card's CONTENT vocabularies used to sit on cyan/teal, the same
// hue as the interactive signal (`--ring`/`--primary` = hsl(189 90% 60%); cyan-500 = hsl(189 94%
// 43%) — IDENTICAL hue, so "Economy" and "focused" were indistinguishable by hue). The content is
// re-hued into the 60-160 deg band; the signal never moves. That band holds exactly TWO Tailwind
// families at >=30 deg off 189 (lime 83 deg, green 142 deg — emerald is 160 deg, only 29 deg off,
// and teal/sky are 16/10 deg off), so a collision-free mapping for all four re-hued slots does not
// exist. The two reuses across vocabularies are deliberate; every control here carries its own TEXT
// label, so hue reuse costs no information. Within each vocabulary the spacing
// is maximal.

// Phase strip: color + a TEXT label + an icon.
const PHASE: Record<FlightPhase, { label: string; strip: string; Icon: typeof Timer }> = {
  upcoming: { label: 'Upcoming', strip: 'bg-green-500/12 text-green-200 border-green-500/25', Icon: Timer },
  departing: { label: 'Departing today', strip: 'bg-amber-500/15 text-amber-200 border-amber-500/30', Icon: PlaneTakeoff },
  completed: { label: 'Completed', strip: 'bg-white/[0.06] text-ink-lo border-white/10', Icon: CheckCircle2 },
};

// Layover verdict: color + TEXT label, never color-only.
// Severity now reads as a monotonic hue ramp: tight amber (38) -> normal lime (83) -> relaxed
// green (142). Previously the middle value was cyan, i.e. off the ramp AND on the signal hue.
const VERDICT: Record<'relaxed' | 'normal' | 'tight', { label: string; cls: string }> = {
  relaxed: { label: 'Relaxed', cls: 'bg-green-500/15 text-green-200 border border-green-500/30' },
  normal: { label: 'Normal', cls: 'bg-lime-500/15 text-lime-200 border border-lime-500/25' },
  tight: { label: 'Tight', cls: 'bg-amber-500/15 text-amber-200 border border-amber-500/30' },
};

// Cabin tier ladder, distinguishable step to step: lime (83) -> green (142) -> indigo (239) ->
// gold (44). Smallest gap 59 deg. Business/First are already off-band and unchanged.
const CABIN_BADGE: Record<string, string> = {
  'Economy': 'bg-lime-500/15 text-lime-200 border border-lime-500/25',
  'Premium Economy': 'bg-green-500/15 text-green-200 border border-green-500/25',
  'Business': 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/25',
  'First': 'bg-gold-500/15 text-gold-400 border border-gold-500/25',
};

// Build a short proximity string from the countdown's significant units. Far out → mo/w/d;
// once inside a week, tick down h/m/s so it reads live (Flighty vibe). Pure over the countdown
// object — no label parsing.
function proximityText(c: FlightTiming['countdown']): string {
  const parts: string[] = [];
  if (c.months) parts.push(`${c.months}mo`);
  if (c.weeks) parts.push(`${c.weeks}w`);
  if (c.days) parts.push(`${c.days}d`);
  // "inside a week": the units carry maximally (issue #11), so no month and no week left
  // IS fewer than seven days left. Nothing else to test.
  if (!c.months && !c.weeks) {
    parts.push(`${c.hours}h`, `${c.minutes}m`, `${c.seconds}s`);
  }
  return parts.join(' ') || 'under a minute';
}

// One labelled chip. Fixed slot — an empty value renders "Not yet assigned" (muted), so the
// 4-chip grid NEVER reflows whether or not the fact exists (; Gate/Confirmation are
// always empty — not in the data, never fabricated).
function Chip({ label, value }: { label: string; value?: string | null }) {
  const empty = !value;
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-1.5 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-ink-lo">{label}</div>
      <div className={`text-[11px] font-medium truncate ${empty ? 'text-ink-lo italic' : 'text-ink-hi'}`}>
        {value ?? 'Not yet assigned'}
      </div>
    </div>
  );
}

function LegRow({ leg }: { leg: FlightLeg }) {
  return (
    <li className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 text-green-300 shrink-0">
            <Plane className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="font-semibold text-white text-sm truncate">{leg.flightNumber}</span>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${CABIN_BADGE[leg.cabin] ?? CABIN_BADGE['Economy']}`}>
          <Ticket className="w-3 h-3" aria-hidden="true" />
          {leg.cabin}{leg.cabinCode ? ` · ${leg.cabinCode}` : ''}
        </span>
      </div>

      {/* From -> To codes, names, terminals (structured code fields — not a time label). */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono font-bold text-white text-base">{leg.fromCode}</div>
          <div className="text-[11px] text-ink-mid leading-tight">{leg.fromName}</div>
        </div>
        <ArrowRight className="w-4 h-4 text-green-400/60 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-right">
          <div className="font-mono font-bold text-white text-base">{leg.toCode}</div>
          <div className="text-[11px] text-ink-mid leading-tight">{leg.toName}</div>
        </div>
      </div>

      {/* Depart / Arrive / duration — VERBATIM labels. The weekday+date is already IN
          the label ("Thu Dec 10"); we do NOT compute a +1d badge (that would be parsing). */}
      <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <span className="text-ink-hi"><span className="text-ink-lo">Depart</span> {leg.departLabel}</span>
        <span className="text-ink-hi"><span className="text-ink-lo">Arrive</span> {leg.arriveLabel}</span>
        <span className="inline-flex items-center gap-1 text-ink-mid">
          <Clock className="w-3 h-3" aria-hidden="true" />{leg.duration}
        </span>
      </div>

      {/* Fixed labelled-chip grid — always 4 slots (no reflow). Terminal/Seat from optional leg
          fields; Gate/Confirmation aren't in the booking → labelled-empty, never fabricated. */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <Chip label="Terminal" value={leg.fromTerminal} />
        <Chip label="Gate" value={undefined} />
        <Chip label="Seat" value={leg.seats && leg.seats.length > 0 ? leg.seats.join(' · ') : undefined} />
        <Chip label="Confirmation" value={undefined} />
      </div>

      {leg.seats && leg.seats.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-mid">
          <Armchair className="w-3 h-3 text-green-300/70" aria-hidden="true" />
          <span className="text-ink-lo">Seats</span>
          <span className="font-mono text-ink-hi">{leg.seats.join(' · ')}</span>
        </div>
      )}
    </li>
  );
}

function LayoverRow({ layover }: { layover: Layover }) {
  // the <li> stays a plain listitem (axe only-listitems); separator semantics live on
  // an inner span. The authored verdict renders as a colored TEXT pill, never color-only.
  const v = layover.verdict ? VERDICT[layover.verdict] : null;
  return (
    <li className="flex items-center gap-2 pl-4 py-1.5 text-[11px] text-amber-200/70">
      <span
        className="flex flex-wrap items-center gap-2"
        role="separator"
        aria-label={
          `Layover ${layover.duration} at ${layover.airportName ?? layover.airportCode}` +
          (v ? ` — ${v.label} connection` : '')
        }
      >
        <span className="inline-flex items-center justify-center w-7 shrink-0">
          <CircleDashed className="w-3.5 h-3.5 text-amber-300/60" aria-hidden="true" />
        </span>
        <span>
          Layover {layover.duration} · {layover.airportCode}
          {layover.airportName ? <span className="text-amber-200/60"> — {layover.airportName}</span> : null}
        </span>
        {v && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${v.cls}`}>
            {v.label}
          </span>
        )}
      </span>
    </li>
  );
}

const RAIL_LINK =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-white/5 px-3 text-[11px] font-medium text-ink-mid outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

// "Check live status" rail: external deep-links OUT only, built from the SAME
// `lib/flight-deep-links.ts` builders Travel Mode uses so the two can't drift.
function JourneyActionsRail({ journey }: { journey: Journey }) {
  const r2r = buildRome2RioUrl(journey.fromSummary, journey.toSummary);
  const gflights = buildGoogleFlightsUrl(journey.fromSummary, journey.toSummary);
  return (
    <div className="mt-4 pt-4 border-t border-white/5">
      <p className="mb-2 text-[11px] uppercase tracking-widest text-green-300/70">Check live status</p>
      <div className="flex flex-wrap gap-2">
        {journey.legs.map((leg) => {
          const tracker = buildFlightTrackerUrl(leg.flightNumber);
          if (!tracker) return null;
          return (
            <a
              key={leg.id}
              href={tracker}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Track ${leg.flightNumber} on FlightRadar24`}
              data-testid={`flights-tracker-${leg.id}`}
              className={RAIL_LINK}
            >
              <Radar className="w-3 h-3" aria-hidden="true" />
              {leg.flightNumber}
            </a>
          );
        })}
        <a
          href={r2r}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Plan ${journey.fromSummary} to ${journey.toSummary} on Rome2Rio`}
          data-testid={`flights-rome2rio-${journey.id}`}
          className={RAIL_LINK}
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Rome2Rio
        </a>
        <a
          href={gflights}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Search ${journey.fromSummary} to ${journey.toSummary} on Google Flights`}
          data-testid={`flights-gflights-${journey.id}`}
          className={RAIL_LINK}
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Google Flights
        </a>
      </div>
    </div>
  );
}

/**
 * The standalone Flighty journey card. Self-contained: derives its own phase/countdown from
 * the trip-clock (live-ticking, honors `?today=`). `index` is optional so it can be embedded
 * outside the /flights grid (Travel Mode / timeline — deferred FU).
 */
export function FlightJourneyCard({ journey, index = 0 }: { journey: Journey; index?: number }) {
  // Timing is clock-dependent → set after mount so this component is SSR/hydration-safe even if
  // a future embedder renders it server-side. Ticks every second so the countdown reads live.
  const [timing, setTiming] = useState<FlightTiming | null>(null);
  useEffect(() => {
    const tick = () => setTiming(getFlightTiming(journey));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [journey]);

  const phase = timing?.phase ?? 'upcoming';
  const phaseMeta = PHASE[phase];
  const routeFrom = journey.legs[0]?.fromCode ?? '';
  const routeTo = journey.legs[journey.legs.length - 1]?.toCode ?? '';

  return (
    <m.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="glass-card rounded-2xl p-5 sm:p-6 min-w-0"
      aria-labelledby={`journey-${journey.id}-heading`}
      data-testid={`flight-card-${journey.id}`}
    >
      {/* Phase strip — text label + icon + color (never color-only). */}
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${phaseMeta.strip}`}
        data-testid={`flight-phase-${journey.id}`}
      >
        <phaseMeta.Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {phaseMeta.label}
      </div>

      {/* Big route + journey label. */}
      <div className="mt-3">
        <h3 id={`journey-${journey.id}-heading`} className="font-display font-bold text-white text-lg leading-tight">
          {journey.label}
        </h3>
        <div className="mt-2 flex items-center gap-3 font-mono font-bold text-white text-2xl sm:text-3xl">
          <span>{routeFrom}</span>
          <ArrowRight className="w-6 h-6 text-green-400/70 shrink-0" aria-hidden="true" />
          <span>{routeTo}</span>
        </div>
        <div className="mt-1 text-sm text-ink-mid">
          {journey.fromSummary} <span className="text-ink-lo">→</span> {journey.toSummary}
        </div>
      </div>

      {/* Verbatim journey depart/arrive + total. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <span className="text-ink-hi"><span className="text-ink-lo">Depart</span> {journey.legs[0]?.departLabel}</span>
        <span className="text-ink-hi"><span className="text-ink-lo">Arrive</span> {journey.legs[journey.legs.length - 1]?.arriveLabel}</span>
        <span className="inline-flex items-center gap-1 rounded-lg bg-green-500/10 px-2 py-0.5 text-green-200">
          <Clock className="w-3 h-3" aria-hidden="true" />
          <span className="text-green-300/70">Total</span>
          <span className="font-mono font-semibold">{journey.totalDuration}</span>
        </span>
      </div>

      {/* Proximity countdown — from the trip-clock, honest & live vs departDate. Zeroes for
          completed; on the day itself the phase strip already says "Departing today". */}
      <div
        className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2"
        data-testid={`flight-countdown-${journey.id}`}
      >
        <phaseMeta.Icon className="w-4 h-4 text-green-300/70 shrink-0" aria-hidden="true" />
        {phase === 'upcoming' && timing ? (
          <span className="text-sm text-ink-mid">
            <span className="text-ink-lo">Departs in </span>
            <span className="font-mono font-semibold text-white">{proximityText(timing.countdown)}</span>
          </span>
        ) : phase === 'departing' ? (
          <span className="text-sm font-semibold text-amber-200">Departing today</span>
        ) : phase === 'completed' ? (
          <span className="text-sm text-ink-mid">This journey is complete</span>
        ) : (
          <span className="text-sm text-ink-mid">Loading…</span>
        )}
      </div>

      {/* Ordered legs interleaved with layover verdict rows. */}
      <ol className="mt-4 space-y-2">
        {journey.legs.map((leg, i) => (
          <Fragment key={leg.id}>
            <LegRow leg={leg} />
            {i < journey.layovers.length && <LayoverRow layover={journey.layovers[i]} />}
          </Fragment>
        ))}
      </ol>

      <JourneyActionsRail journey={journey} />
    </m.article>
  );
}
