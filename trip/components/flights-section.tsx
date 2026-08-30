'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { JOURNEYS, BOOKED_STAYS, type Stay } from '@/lib/booking-data';
import { FlightJourneyCard } from '@/components/flight-journey-card';

// --- Static class records: never interpolate Tailwind class names. ---
// FILLED means committed, UNFILLED means not yet: a booked stay is STRUCK, an unbooked one is
// drawn hollow. The word carries the state as well as the mark, so it reads without colour.
const STATUS_CHIP: Record<'booked' | 'to-book', string> = {
  'booked': 'chip chip--struck',
  'to-book': 'chip chip--hollow',
};

function StatusChip({ status }: { status: 'booked' | 'to-book' }) {
  return (
    <span className={STATUS_CHIP[status]}>{status === 'booked' ? 'Booked' : 'To be booked'}</span>
  );
}

/** One stay as a printed row: city · name · the facts the booking actually carries · its mark. */
function StayRow({ stay }: { stay: Stay }) {
  return (
    <div className="r [--lead:5.5rem]" data-leg={stay.country}>
      <span className="tm truncate">{stay.city}</span>
      <span className="min-w-0">
        <h3 id={`stay-${stay.id}-heading`}>{stay.name}</h3>
        <span className="mt flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {stay.stars !== null && (
            <span className="inline-flex items-center gap-0.5" aria-label={`${stay.stars} star hotel`}>
              {Array.from({ length: stay.stars }).map((_, i) => (
                <Star key={i} className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
              ))}
              <span className="ml-1">{stay.stars}-star</span>
            </span>
          )}
          {stay.area && <span>{stay.area}</span>}
        </span>
        {stay.address && <span className="mt">{stay.address}</span>}
        {stay.checkIn && (
          <span className="mt">
            Check-in {stay.checkIn}
            {stay.checkOut ? ` → Check-out ${stay.checkOut}` : ''}
          </span>
        )}
        {stay.note && <span className="mt">{stay.note}</span>}
      </span>
      <StatusChip status={stay.status} />
    </div>
  );
}

export default function FlightsSection() {
  // Mount guard for parity with neighbor sections (this section is static/SSR-safe,
  // but it is loaded ssr:false; the guard avoids any flash before mount).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Every figure printed on this screen is READ from lib/booking-data, never asserted.
  const segments = JOURNEYS.reduce((n, j) => n + j.legs.length, 0);
  const ticketed = JOURNEYS.every((j) => j.status === 'booked');
  const tight = JOURNEYS.flatMap((j) => j.layovers).find((l) => l.verdict === 'tight');

  return (
    <section id="flights" aria-labelledby="flights-heading" className="pb-20">
      {/* The running head. Solid --surface-1, no backdrop filter; it parks under the
          fixed 64px navbar rather than at the viewport top. Below 440px the `f--drop` fields
          are dropped rather than clipped, because a half-cut field reads as a bug. */}
      <header className="head top-16">
        <div className="f">
          <span className="k">Journeys</span>
          <span className="v">{JOURNEYS.length}</span>
        </div>
        <div className="f">
          <span className="k">Segments</span>
          <span className="v">{segments}</span>
        </div>
        <div className="f">
          <span className="k">Ticketed</span>
          <span className="v">{ticketed ? 'All' : 'Partial'}</span>
        </div>
        {tight && (
          <div className="f f--drop">
            <span className="k">Tight connection</span>
            <span className="v">{tight.duration} · {tight.airportCode}</span>
          </div>
        )}
        <div className="f f--drop">
          <span className="k">Stays</span>
          <span className="v">{BOOKED_STAYS.length}</span>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="pt-8 pb-6">
          <div className="sec">
            <h2 id="flights-heading">Flights and stays</h2>
            <span className="sub">
              {JOURNEYS.length} journeys · {segments} segments{ticketed ? ' · all ticketed' : ''}
            </span>
          </div>
          <p className="max-w-2xl text-t-lead text-ink-mid">
            Every confirmed booking for the journey — each flight leg with its layovers, seats and
            cabin, plus all four hotels across Nepal and Japan. Everything is booked; use “Check
            live status” on any journey to follow it on the day.
          </p>
        </div>

        {mounted && (
          <>
            {/* Four route diagrams — phase mark → route → verbatim times → countdown →
                segment chain with layover nodes → deep-link rail. */}
            <div className="grid gap-5 lg:grid-cols-2">
              {JOURNEYS.map((journey) => (
                <FlightJourneyCard key={journey.id} journey={journey} />
              ))}
            </div>

            {/* Booked stays — one ruled list, no cards. */}
            <div className="mt-10 min-w-0">
              <div className="sec">
                <h2>Accommodation</h2>
                <span className="sub">{BOOKED_STAYS.length} stays booked</span>
              </div>
              <div className="list border-t-2 border-[color:hsl(var(--border))]">
                {BOOKED_STAYS.map((stay) => (
                  <StayRow key={stay.id} stay={stay} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
