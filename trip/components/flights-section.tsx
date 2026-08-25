'use client';

import { useEffect, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { Hotel, Clock, Star, MapPin } from 'lucide-react';
import { JOURNEYS, BOOKED_STAYS, type Stay } from '@/lib/booking-data';
import { FlightJourneyCard } from '@/components/flight-journey-card';
import { FADE_FLOOR } from '@/lib/motion';

// --- Static class records: never interpolate Tailwind class names. ---
// /15 is not a Tailwind opacity step and emitted no rule; these chips had no fill. /20 is.
// Status chip styling, keyed by booking status (stays only; journeys use the phase strip).
const STATUS_CHIP: Record<'booked' | 'to-book', string> = {
  'booked': 'bg-green-500/20 text-green-300 border border-green-500/30',
  'to-book': 'bg-amber-500/20 text-amber-200 border border-amber-500/30 border-dashed',
};

function StatusChip({ status }: { status: 'booked' | 'to-book' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${STATUS_CHIP[status]}`}>
      {status === 'booked' ? 'Booked' : 'To be booked'}
    </span>
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
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-300 shrink-0">
            <Hotel className="w-5 h-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id={`stay-${stay.id}-heading`} className="font-display font-bold text-white text-base leading-tight">
              {stay.name}
            </h3>
            <div className="text-[11px] text-ink-mid">{stay.city}</div>
          </div>
        </div>
        <StatusChip status={stay.status} />
      </div>

      {stay.stars !== null && (
        <div className="flex items-center gap-1 mb-3" aria-label={`${stay.stars} star hotel`}>
          {Array.from({ length: stay.stars }).map((_, i) => (
            <Star key={i} className="w-3.5 h-3.5 fill-current text-muted-foreground" aria-hidden="true" />
          ))}
          <span className="ml-1 text-[11px] text-ink-mid">{stay.stars}-star</span>
        </div>
      )}

      {stay.area && (
        <p className="flex items-start gap-1.5 text-xs text-ink-mid mb-1.5">
          <MapPin className="w-3.5 h-3.5 text-indigo-300/70 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{stay.area}</span>
        </p>
      )}
      {stay.address && (
        <p className="text-[11px] text-ink-mid pl-5">{stay.address}</p>
      )}
      {stay.checkIn && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-mid">
          <Clock className="w-3.5 h-3.5 text-indigo-300/70 shrink-0" aria-hidden="true" />
          <span className="text-ink-mid">Check-in</span> {stay.checkIn}
        </p>
      )}
      {stay.checkOut && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-mid">
          <Clock className="w-3.5 h-3.5 text-indigo-300/70 shrink-0" aria-hidden="true" />
          <span className="text-ink-mid">Check-out</span> {stay.checkOut}
        </p>
      )}
      {stay.note && (
        <p className="mt-1.5 text-[11px] text-ink-mid pl-5">{stay.note}</p>
      )}
    </m.article>
  );
}

export default function FlightsSection() {
  const prefersReducedMotion = useReducedMotion();
  // Mount guard for parity with neighbor sections (this section is static/SSR-safe,
  // but it is loaded ssr:false per; the guard avoids any flash before mount).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section id="flights" aria-labelledby="flights-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* masthead entrance now FLOORS the fade (FADE_FLOOR → 1) instead of
            pinning it at 1. The floor is shallow enough that the (non-reduced-motion) axe
            scan still sees the muted `text-ink-mid` subtitle ≥AA at the darkest frame —
            the guarantee, preserved. Under reduce we keep the pin outright:
            MotionConfig neutralises `y` but not opacity, so an un-forked floor would
            strand an off-screen reveal at 0.7. */}
        <m.div
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: FADE_FLOOR, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="flights-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Flights <span className="text-display-emphasis">&amp; Stays</span>
          </h2>
          <p className="text-ink-mid max-w-xl mx-auto">
            Every confirmed booking for the journey — each flight leg with its layovers, seats and
            cabin, plus all four hotels across Nepal and Japan. Everything is booked; use “Check
            live status” on any journey to follow it on the day.
          </p>
        </m.div>

        {mounted && (
          <>
            {/* Four journey cards — Flighty-anatomy (phase → route → verbatim times → countdown
                → labelled chips → layover verdict rows → deep-link rail). */}
            <div className="grid lg:grid-cols-2 gap-5 mb-5">
              {JOURNEYS.map((journey, i) => (
                <FlightJourneyCard key={journey.id} journey={journey} index={i} />
              ))}
            </div>

            {/* Booked stays — a full-width 2-up grid (no empty column: the former
                "Japan — to be booked" panel was permanently empty and is removed). */}
            <div className="min-w-0">
              <h3 className="sr-only">Accommodation</h3>
              <div className="grid sm:grid-cols-2 gap-5">
                {BOOKED_STAYS.map((stay) => (
                  <StayCard key={stay.id} stay={stay} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
