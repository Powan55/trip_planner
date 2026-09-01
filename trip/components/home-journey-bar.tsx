'use client';

import { useMemo } from 'react';
import { formatDate } from '@/core/dates';
import { journeyLegs } from '@/lib/journey-legs';

/**
 * Home's journey bar (issue #92) — the whole trip in one glance: every leg as a weighted
 * segment on one date rail, then a card per leg with its dates, its day count and the cities
 * it covers. Nothing else on Home answers "what shape is this trip".
 *
 * Every figure is read from `lib/journey-legs.ts`, which counts the app's OWN per-day
 * answers; there is no second piece of date maths in this file. It renders whatever legs the
 * active pack has, so a custom single-leg trip gets one honest segment rather than a
 * Nepal/Japan split it does not have.
 *
 * WHY IT IS A BAND BELOW THE HERO. The hero's height is a fold budget (D-311) and its
 * content block is vertically centred, so anything added inside it spends that budget twice.
 * This section sits below the `min-h-[100svh]` column entirely, the same place
 * `components/home-stat-row.tsx` sits and for the same reason.
 *
 * COLOUR CARRIES NOTHING ALONE (D-293 R9). The rail is `aria-hidden` decoration; every fact
 * it draws — which leg, how long, which cities — is written out in the cards below it, in
 * DOM order, and the fills only repeat the ordering the numbered eyebrows already give.
 * The two gradient stops are the country tokens the front door's chapters use; a pack with
 * more than two legs alternates between them rather than inventing a third.
 *
 * NO ENTRANCE AND NO LOOP. This is below the fold on an Operate surface, so the content is
 * present when you arrive; nothing here rests below full opacity.
 */

const RAIL_FILLS = ['var(--grad-nepal)', 'var(--grad-japan)'] as const;

export default function HomeJourneyBar() {
  const legs = useMemo(journeyLegs, []);
  if (legs.length === 0) return null;

  const totalDays = legs.reduce((n, leg) => n + leg.days, 0);

  return (
    <section
      id="journey"
      aria-labelledby="journey-heading"
      data-testid="home-journey-bar"
      className="bg-surface py-10 sm:py-14"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="sec px-gut">
          <h2 id="journey-heading">The journey</h2>
          <span className="sub">
            {totalDays} days · {legs.length} {legs.length === 1 ? 'leg' : 'legs'} · one rail
          </span>
        </div>

        {/* The date rail, weighted by DAY COUNT. `flexBasis: 0` so the segments divide the
            width by that count alone — with the default `auto` basis an empty div
            contributes nothing and every segment would come out the same width. Square, not
            a pill: this is a printed scale, and it is decoration on top of the stops below,
            which state every fact it draws in words. */}
        <div
          aria-hidden="true"
          className="mx-gut flex h-2 gap-px overflow-hidden bg-border"
          data-testid="home-journey-rail"
        >
          {legs.map((leg, i) => (
            <div
              key={leg.id}
              style={{ flexGrow: leg.days, flexBasis: 0, background: RAIL_FILLS[i % RAIL_FILLS.length] }}
            />
          ))}
        </div>

        {/* The route. `data-leg` is what colours the spine node, and it is the pack's own leg
            id, so a single-leg custom trip gets `.strip--one` and one honest spine rather than
            a Nepal/Japan gradient it does not have. Every stop is STRUCK — these legs are
            ticketed (four journeys, eleven segments); an unbooked one would take `data-open`
            and draw hollow. */}
        <ol className={`strip mt-4${legs.length === 1 ? ' strip--one' : ''}`}>
          {legs.map((leg, i) => (
            <li
              key={leg.id}
              data-testid={`home-journey-leg-${leg.id}`}
              data-leg={leg.id}
              className="s"
            >
              <span className="pr pr--lo tabular-nums">Leg {String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                {/* `break-words`: a custom pack's label is `destinations.join(' × ')` and can
                    be arbitrarily long, and a single unbroken token is the one thing that
                    could push the row past the viewport at 360. */}
                <span className="nm break-words">{leg.label}</span>
                <span className="mt">
                  {formatDate(leg.start)} &ndash; {formatDate(leg.end)}
                </span>
                <ul
                  aria-label={`Cities on ${leg.label}`}
                  className="mt-1.5 flex flex-wrap gap-1"
                >
                  {leg.cities.map((city) => (
                    <li key={city} className="chip">
                      {city}
                    </li>
                  ))}
                </ul>
              </div>
              <span className="rt">
                <b>{leg.days}</b>
                <i>{leg.days === 1 ? 'day' : 'days'}</i>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
