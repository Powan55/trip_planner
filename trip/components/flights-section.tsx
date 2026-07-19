'use client';

import { Fragment, useEffect, useState } from 'react';
import { m } from 'framer-motion';
import {
  Plane, Hotel, Clock, ArrowRight, Armchair, Ticket,
  Building2, Star, MapPin, CircleDashed,
} from 'lucide-react';
import {
  JOURNEYS, BOOKED_STAYS, JAPAN_TODO,
  type Journey, type FlightLeg, type Layover, type Stay, type ToBookPlaceholder,
} from '@/lib/booking-data';

// --- Static class records: never interpolate Tailwind class names. ---
// Status chip styling, keyed by booking status.
const STATUS_CHIP: Record<'booked' | 'to-book', string> = {
  'booked': 'bg-green-500/15 text-green-300 border border-green-500/30',
  'to-book': 'bg-amber-500/15 text-amber-200 border border-amber-500/30 border-dashed',
};

// Cabin badge styling. Every CabinClass has a whole literal class string.
const CABIN_BADGE: Record<string, string> = {
  'Economy': 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/25',
  'Premium Economy': 'bg-teal-500/15 text-teal-200 border border-teal-500/25',
  'Business': 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/25',
  'First': 'bg-gold-500/15 text-gold-400 border border-gold-500/25',
};

function StatusChip({ status }: { status: 'booked' | 'to-book' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${STATUS_CHIP[status]}`}>
      {status === 'booked' ? 'Booked' : 'To be booked'}
    </span>
  );
}

function LegRow({ leg }: { leg: FlightLeg }) {
  return (
    <li className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
      {}/* Flight number + cabin */
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-300 shrink-0">
            <Plane className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="font-display font-semibold text-white text-sm truncate">{leg.flightNumber}</span>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${CABIN_BADGE[leg.cabin] ?? CABIN_BADGE['Economy']}`}>
          <Ticket className="w-3 h-3" aria-hidden="true" />
          {leg.cabin}{leg.cabinCode ? ` · ${leg.cabinCode}` : ''}
        </span>
      </div>

      {}/* From -> To, with airport names + terminals */
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono font-bold text-white text-base">{leg.fromCode}</div>
          <div className="text-[11px] text-white/45 leading-tight">{leg.fromName}</div>
          {leg.fromTerminal && <div className="text-[11px] text-white/35">{leg.fromTerminal}</div>}
        </div>
        <ArrowRight className="w-4 h-4 text-cyan-400/60 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-right">
          <div className="font-mono font-bold text-white text-base">{leg.toCode}</div>
          <div className="text-[11px] text-white/45 leading-tight">{leg.toName}</div>
          {leg.toTerminal && <div className="text-[11px] text-white/35">{leg.toTerminal}</div>}
        </div>
      </div>

      {}/* Depart -> Arrive + duration. Verbatim labels — never parsed/recomputed. */
      <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <span className="text-white/55">
          <span className="text-white/40">Depart</span> {leg.departLabel}
        </span>
        <span className="text-white/55">
          <span className="text-white/40">Arrive</span> {leg.arriveLabel}
        </span>
        <span className="inline-flex items-center gap-1 text-white/45">
          <Clock className="w-3 h-3" aria-hidden="true" />{leg.duration}
        </span>
      </div>

      {}/* Seats — only when present. */
      {leg.seats && leg.seats.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/45">
          <Armchair className="w-3 h-3 text-cyan-300/70" aria-hidden="true" />
          <span className="text-white/40">Seats</span>
          <span className="font-mono text-white/60">{leg.seats.join(' · ')}</span>
        </div>
      )}
    </li>
  );
}

function LayoverRow({ layover }: { layover: Layover }) {
  // (a11y `list` rule, WCAG 1.3.1): the layover row must be a REAL <li>
  // (listitem) as a direct child of the <ol> — previously it carried
  // `role="separator"` on the <li> itself, which OVERRODE its implicit listitem
  // role, so axe saw the <ol> directly containing a non-listitem (only-listitems
  // failure). We keep the <li> a plain listitem and move the separator semantics
  // (role + descriptive aria-label) onto an INNER wrapper, so the list structure
  // is valid while assistive tech still announces the layover as a separator.
  return (
    <li className="flex items-center gap-2 pl-4 py-1.5 text-[11px] text-amber-200/70">
      <span
        className="flex items-center gap-2"
        role="separator"
        aria-label={`Layover ${layover.duration} at ${layover.airportName ?? layover.airportCode}`}
      >
        <span className="inline-flex items-center justify-center w-7 shrink-0">
          <CircleDashed className="w-3.5 h-3.5 text-amber-300/60" aria-hidden="true" />
        </span>
        <span>
          Layover {layover.duration} · {layover.airportCode}
          {layover.airportName ? <span className="text-amber-200/45"> — {layover.airportName}</span> : null}
        </span>
      </span>
    </li>
  );
}

function JourneyCard({ journey, index }: { journey: Journey; index: number }) {
  return (
    <m.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="glass-card rounded-2xl p-5 sm:p-6 min-w-0"
      aria-labelledby={`journey-${journey.id}-heading`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 id={`journey-${journey.id}-heading`} className="font-display font-bold text-white text-lg leading-tight">
            {journey.label}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/50">
            <span className="font-medium text-white/70">{journey.fromSummary}</span>
            <ArrowRight className="w-3.5 h-3.5 text-cyan-400/60" aria-hidden="true" />
            <span className="font-medium text-white/70">{journey.toSummary}</span>
          </div>
        </div>
        <StatusChip status={journey.status} />
      </div>

      <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-200 text-xs">
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-cyan-300/70">Total travel time</span>
        <span className="font-mono font-semibold">{journey.totalDuration}</span>
      </div>

      {/* Ordered legs interleaved with layovers: layover[i] sits between leg[i] and leg[i+1].
          LegRow / LayoverRow each render a single <li> LISTITEM (: the layover's
          `role="separator"` now lives on an inner span, not the <li>), so every DIRECT
}          child of this <ol> is a valid listitem (axe `only-listitems`). */
      <ol className="space-y-2">
        {journey.legs.map((leg, i) => (
          <Fragment key={leg.id}>
            <LegRow leg={leg} />
            {i < journey.layovers.length && <LayoverRow layover={journey.layovers[i]} />}
          </Fragment>
        ))}
      </ol>
    </m.article>
  );
}

function StayCard({ stay }: { stay: Stay }) {
  return (
    <m.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="glass-card rounded-2xl p-5 sm:p-6 h-full min-w-0"
      aria-labelledby={`stay-${stay.id}-heading`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-300 shrink-0">
            <Hotel className="w-5 h-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id={`stay-${stay.id}-heading`} className="font-display font-bold text-white text-base leading-tight">
              {stay.name}
            </h3>
            <div className="text-[11px] text-white/45">{stay.city}</div>
          </div>
        </div>
        <StatusChip status={stay.status} />
      </div>

      {stay.stars !== null && (
        <div className="flex items-center gap-1 mb-3" aria-label={`${stay.stars} star hotel`}>
          {Array.from({ length: stay.stars }).map((_, i) => (
            <Star key={i} className="w-3.5 h-3.5 fill-gold-400 text-gold-400" aria-hidden="true" />
          ))}
          <span className="ml-1 text-[11px] text-white/40">{stay.stars}-star</span>
        </div>
      )}

      {stay.area && (
        <p className="flex items-start gap-1.5 text-xs text-white/55 mb-1.5">
          <MapPin className="w-3.5 h-3.5 text-indigo-300/70 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{stay.area}</span>
        </p>
      )}
      {stay.address && (
        <p className="text-[11px] text-white/35 pl-5">{stay.address}</p>
      )}
      {stay.checkIn && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/45">
          <Clock className="w-3.5 h-3.5 text-indigo-300/70 shrink-0" aria-hidden="true" />
          <span className="text-white/40">Check-in</span> {stay.checkIn}
        </p>
      )}
      {stay.checkOut && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/45">
          <Clock className="w-3.5 h-3.5 text-indigo-300/70 shrink-0" aria-hidden="true" />
          <span className="text-white/40">Check-out</span> {stay.checkOut}
        </p>
      )}
      {stay.note && (
        <p className="mt-1.5 text-[11px] text-white/40 pl-5">{stay.note}</p>
      )}
    </m.article>
  );
}

function ToBookCard({ item }: { item: ToBookPlaceholder }) {
  const Icon = item.kind === 'flight' ? Plane : Building2;
  return (
    <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/[0.04] p-4">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10 text-amber-300/80 shrink-0">
            <Icon className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="font-display font-semibold text-white/80 text-sm truncate">{item.label}</span>
        </div>
        <StatusChip status="to-book" />
      </div>
      <p className="text-[11px] text-amber-100/55 pl-9">{item.note}</p>
    </div>
  );
}

export default function FlightsSection() {
  // Mount guard for parity with neighbor sections (this section is static/SSR-safe,
  // but it is loaded ssr:false per; the guard avoids any flash before mount).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section id="flights" aria-labelledby="flights-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* slide-only masthead entrance (opacity pinned to 1) — see the
            RecommendationSection masthead for the full rationale. Prevents the
            (non-reduced-motion) axe scan from catching the muted `text-white/50`
}            subtitle mid-fade and flagging a transient contrast failure. */
        <m.div
          initial={{ opacity: 1, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="flights-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Flights <span className="text-gradient-gold">&amp; Stays</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">
            The confirmed bookings for the journey — flight by flight, with layovers, seats and the
            Kathmandu hotel. What is not yet booked is shown honestly as still to come.
          </p>
        </m.div>

        {mounted && (
          <>
            {}/* Two journey cards. */
            <div className="grid lg:grid-cols-2 gap-5 mb-5">
              {JOURNEYS.map((journey, i) => (
                <JourneyCard key={journey.id} journey={journey} index={i} />
              ))}
            </div>

            {}/* Stays + Japan to-book, side by side on wide screens. */
            <div className="grid lg:grid-cols-2 gap-5">
              <div className="min-w-0">
                <h3 className="sr-only">Accommodation</h3>
                <div className="space-y-3">
                  {BOOKED_STAYS.map((stay) => (
                    <StayCard key={stay.id} stay={stay} />
                  ))}
                </div>
              </div>

              {JAPAN_TODO.length > 0 && (
                <m.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="glass-card rounded-2xl p-5 sm:p-6 min-w-0"
                  aria-labelledby="japan-todo-heading"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CircleDashed className="w-4 h-4 text-amber-300/70" aria-hidden="true" />
                    <h3 id="japan-todo-heading" className="font-display font-bold text-white text-base">
                      Japan — to be booked
                    </h3>
                  </div>
                  <p className="text-[11px] text-white/40 mb-4">
                    These parts of the trip are not confirmed yet. They are intentionally left open, not missing.
                  </p>
                  <div className="space-y-3">
                    {JAPAN_TODO.map((item) => (
                      <ToBookCard key={item.id} item={item} />
                    ))}
                  </div>
                </m.div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
