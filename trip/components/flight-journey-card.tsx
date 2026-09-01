'use client';

// FlightJourneyCard — one booked journey drawn as the route diagram (the `.strip` recipe).
// ONE static layout, fully reproducible from `lib/booking-data.ts`; only the phase mark +
// proximity countdown change with `now` (derived from the trip-clock via `lib/flight-phase`,
// NEVER from booking labels).
//
// every time/duration/total/date LABEL renders verbatim from the booking (display-only,
// JSX text). This file does NO `new Date`/parse/`getTime` on any label — timing lives entirely
// in `getFlightTiming`. The actions rail deep-links OUT only, never a live feed.

import { Fragment, useEffect, useState } from 'react';
import {
  Clock, ArrowRight,
  Radar, ExternalLink, Timer, PlaneTakeoff, CheckCircle2,
} from 'lucide-react';
import type { Journey, FlightLeg, Layover } from '@/lib/booking-data';
import { getFlightTiming, type FlightPhase, type FlightTiming } from '@/lib/flight-phase';
import { getCountryForDate } from '@/core/dates';
import { useTravelTick, requestFastTick } from '@/lib/travel-tick';
import { buildFlightTrackerUrl, buildRome2RioUrl, buildGoogleFlightsUrl } from '@/lib/flight-deep-links';

// --- Static class/label records: never interpolate Tailwind class names. ---
// FILLED means committed, UNFILLED means not yet. The phase mark is a `.chip` (a rule) for
// every state except the day itself, which is the one thing on this screen that is TRUE TODAY
// and so takes the `.stamp--live` accent fill — the allowlisted "what is now" site.
const PHASE: Record<FlightPhase, { label: string; mark: string; Icon: typeof Timer }> = {
  upcoming: { label: 'Upcoming', mark: 'chip', Icon: Timer },
  departing: { label: 'Departing today', mark: 'stamp stamp--live', Icon: PlaneTakeoff },
  completed: { label: 'Completed', mark: 'chip chip--struck', Icon: CheckCircle2 },
};

// Layover verdict: the authored human judgment, always as a TEXT label. A tight connection is
// the one fact on this page that wants attention after the form was printed, so it takes the
// off-register STAMP in the leg's own ink; the comfortable ones are ordinary printed chips.
const VERDICT: Record<'relaxed' | 'normal' | 'tight', { label: string; cls: string }> = {
  relaxed: { label: 'Relaxed', cls: 'chip' },
  normal: { label: 'Normal', cls: 'chip' },
  tight: { label: 'Tight', cls: 'stamp' },
};

// Build a short proximity string from the countdown's significant units. Far out → mo/w/d;
// once inside a week, tick down h/m/s so it reads live. Pure over the countdown
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

// One labelled slot. Fixed — an empty value renders "Not yet assigned" inside the HOLLOW frame
// (`.empty-frame`, a dashed box at the size the fact will be), so the 4-slot grid NEVER reflows
// whether or not the fact exists. Gate/Confirmation are always empty — not in the data, never
// fabricated.
function Slot({ label, value }: { label: string; value?: string | null }) {
  const empty = !value;
  return (
    <div className={`min-w-0 px-1.5 py-1 rounded-r1 ${empty ? 'empty-frame' : 'border-hair border-[color:hsl(var(--border))]'}`}>
      <span className="pr pr--lo block">{label}</span>
      <span className={`block truncate font-machine text-t-sm ${empty ? 'text-ink-lo' : 'text-ink-hi'}`}>
        {value ?? 'Not yet assigned'}
      </span>
    </div>
  );
}

/** One flown segment — a BOOKED stop on the route: a filled node in the leg's ink. */
function LegRow({ leg, legId }: { leg: FlightLeg; legId: string }) {
  return (
    <li className="s !items-start" data-leg={legId}>
      <span className="num text-n-sm text-ink-hi">{leg.fromCode}</span>

      <span className="min-w-0">
        <span className="nm">{leg.flightNumber}</span>
        <span className="mt">
          {leg.fromName} → {leg.toName}
        </span>

        {/* Depart / Arrive / cabin — VERBATIM labels. The weekday+date is already IN
            the label ("Thu Dec 10"); we do NOT compute a +1d badge (that would be parsing). */}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-machine text-t-sm">
          <span className="text-ink-hi"><span className="text-ink-lo">Depart </span>{leg.departLabel}</span>
          <span className="text-ink-hi"><span className="text-ink-lo">Arrive </span>{leg.arriveLabel}</span>
          <span className="text-ink-mid">{leg.cabin}{leg.cabinCode ? ` · ${leg.cabinCode}` : ''}</span>
        </span>

        {/* Fixed 4-slot grid (no reflow). Terminal/Seat from optional leg fields;
            Gate/Confirmation aren't in the booking → labelled-empty, never fabricated. */}
        <span className="mt-2 grid grid-cols-2 gap-1 min-[560px]:grid-cols-4">
          <Slot label="Terminal" value={leg.fromTerminal} />
          <Slot label="Gate" value={undefined} />
          <Slot label="Seat" value={leg.seats && leg.seats.length > 0 ? leg.seats.join(' · ') : undefined} />
          <Slot label="Confirmation" value={undefined} />
        </span>
      </span>

      <span className="rt">
        <b>{leg.toCode}</b>
        <i>{leg.duration}</i>
      </span>
    </li>
  );
}

function LayoverRow({ layover }: { layover: Layover }) {
  // the <li> stays a plain listitem (axe only-listitems); separator semantics live on
  // an inner span. The authored verdict renders as a TEXT mark, never colour-only.
  const v = layover.verdict ? VERDICT[layover.verdict] : null;
  return (
    <li className="s" data-transit>
      <span className="num text-t-sm text-ink-lo">{layover.airportCode}</span>
      <span
        className="min-w-0"
        role="separator"
        aria-label={
          `Layover ${layover.duration} at ${layover.airportName ?? layover.airportCode}` +
          (v ? ` — ${v.label} connection` : '')
        }
      >
        <span className="nm !text-ink-mid">Layover {layover.duration}</span>
        {layover.airportName ? <span className="mt">{layover.airportName}</span> : null}
      </span>
      {v ? <span className={v.cls}>{v.label}</span> : <span />}
    </li>
  );
}

const RAIL_LINK =
  'chip min-h-tap px-3 outline-none transition-colors hover:bg-white/5 hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

// "Check live status" rail: external deep-links OUT only, built from the SAME
// `lib/flight-deep-links.ts` builders Travel Mode uses so the two can't drift.
function JourneyActionsRail({ journey }: { journey: Journey }) {
  const r2r = buildRome2RioUrl(journey.fromSummary, journey.toSummary);
  const gflights = buildGoogleFlightsUrl(journey.fromSummary, journey.toSummary);
  return (
    <div className="border-t-hair border-[color:hsl(var(--border))] px-gut py-3">
      <p className="pr pr--lo mb-2">Check live status</p>
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
 * One journey as a printed route diagram. Self-contained: derives its own phase/countdown from
 * the trip-clock (live-ticking, honors `?today=`).
 */
export function FlightJourneyCard({ journey }: { journey: Journey }) {
  // Timing is clock-dependent → set after mount so this component is SSR/hydration-safe even if
  // a future embedder renders it server-side. Ticks every second so the countdown reads live.
  const [timing, setTiming] = useState<FlightTiming | null>(null);
  // The four cards on /flights each ran their own 1 Hz interval, never pausing on a hidden tab and
  // never relaxing while the countdown was months out and could not visibly change (#118). They
  // share the one module-level tick now; the clock read per tick is unchanged.
  const tick = useTravelTick();
  useEffect(() => {
    setTiming(getFlightTiming(journey));
  }, [journey, tick]);

  const phase = timing?.phase ?? 'upcoming';
  // Only the inside-a-week reading carries seconds (see `proximityText`) — that is the one state
  // worth 1 Hz, and it releases the moment the card leaves or the countdown widens again.
  const needsSeconds =
    phase === 'upcoming' && !!timing && !timing.countdown.months && !timing.countdown.weeks;
  useEffect(() => {
    if (!needsSeconds) return;
    return requestFastTick();
  }, [needsSeconds]);

  const phaseMeta = PHASE[phase];
  const routeFrom = journey.legs[0]?.fromCode ?? '';
  const routeTo = journey.legs[journey.legs.length - 1]?.toCode ?? '';
  // The leg this journey DEPARTS on, from the authored date-only anchor — never a booking label.
  // It is what inks the spine and the nodes: one `--now`, set from `data-leg`.
  const legId = getCountryForDate(journey.departDate);

  return (
    <article
      data-leg={legId}
      className="min-w-0 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]"
      aria-labelledby={`journey-${journey.id}-heading`}
      data-testid={`flight-card-${journey.id}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b-2 border-[color:hsl(var(--border))] px-gut py-2.5">
        <h3 id={`journey-${journey.id}-heading`} className="pr pr--l min-w-0 text-ink-hi">
          {journey.label}
        </h3>
        {/* Phase mark — text label + icon + material (never colour-only). */}
        <span className={phaseMeta.mark} data-testid={`flight-phase-${journey.id}`}>
          <phaseMeta.Icon className="w-3 h-3" aria-hidden="true" />
          {phaseMeta.label}
        </span>
      </header>

      <div className="px-gut py-3">
        <p className="num flex items-center gap-3 text-n-md text-ink-hi">
          <span>{routeFrom}</span>
          <ArrowRight className="w-5 h-5 shrink-0 text-ink-lo" aria-hidden="true" />
          <span>{routeTo}</span>
        </p>
        <p className="pr pr--lo mt-1">
          {journey.fromSummary} → {journey.toSummary}
        </p>

        {/* Verbatim journey depart/arrive + total. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-machine text-t-sm">
          <span className="text-ink-hi"><span className="text-ink-lo">Depart </span>{journey.legs[0]?.departLabel}</span>
          <span className="text-ink-hi"><span className="text-ink-lo">Arrive </span>{journey.legs[journey.legs.length - 1]?.arriveLabel}</span>
          <span className="inline-flex items-center gap-1 text-ink-hi">
            <Clock className="w-3 h-3 text-ink-lo" aria-hidden="true" />
            <span className="text-ink-lo">Total</span>
            <span className="num">{journey.totalDuration}</span>
          </span>
        </p>

        {/* Proximity countdown — from the trip-clock, honest & live vs departDate. Zeroes for
            completed; on the day itself the phase mark already says "Departing today". */}
        <p
          className="mt-2 flex items-center gap-2 font-machine text-t-sm text-ink-mid"
          data-testid={`flight-countdown-${journey.id}`}
        >
          <phaseMeta.Icon className="w-3.5 h-3.5 shrink-0 text-ink-lo" aria-hidden="true" />
          {phase === 'upcoming' && timing ? (
            <span>
              <span className="text-ink-lo">Departs in </span>
              <span className="num text-ink-hi">{proximityText(timing.countdown)}</span>
            </span>
          ) : phase === 'departing' ? (
            <span className="text-ink-hi">Departing today</span>
          ) : phase === 'completed' ? (
            <span>This journey is complete</span>
          ) : (
            // The word LOADING is a real text node, never a bare grey block.
            <span className="load px-2 py-0.5 text-ink-lo">Loading</span>
          )}
        </p>
      </div>

      {/* The route: ordered segments interleaved with layover nodes. Every stop on this trip is
          ticketed, so every node is FILLED; the transit nodes are the layovers. `before:bg-now`
          inks the spine from the journey's own leg. */}
      <ol className="strip strip--one list-none before:bg-now pb-1" data-leg={legId}>
        {journey.legs.map((leg, i) => (
          <Fragment key={leg.id}>
            <LegRow leg={leg} legId={legId} />
            {i < journey.layovers.length && <LayoverRow layover={journey.layovers[i]} />}
          </Fragment>
        ))}
      </ol>

      <JourneyActionsRail journey={journey} />
    </article>
  );
}
