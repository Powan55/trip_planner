'use client';

import { useMemo } from 'react';
import { formatDate } from '@/core/dates';
import { journeyLegs } from '@/lib/journey-legs';
import { SectionHeading } from '@/components/section-heading';

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
 * The entrance is the masthead's, through `SectionHeading` → `Reveal` → `entranceFor()`
 * (D-293 R7). No loop, no hand-rolled animation, nothing here rests below full opacity.
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
      className="bg-surface px-4 py-10 sm:px-6 sm:py-14"
    >
      <div className="mx-auto max-w-[1200px]">
        <SectionHeading
          id="journey-heading"
          className="mb-8"
          title={
            <>
              The <span className="text-display-emphasis">journey</span>
            </>
          }
          subtitle={`${totalDays} days, ${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}, one rail.`}
        />

        {/* The rail. `flexBasis: 0` so the segments divide the width by DAY COUNT alone —
            with the default `auto` basis an empty div contributes nothing and every segment
            would come out the same width. `gap-px` over the container fill draws the joins,
            the same mechanism the stat row's dividers use, so no segment owns an edge. */}
        <div
          aria-hidden="true"
          className="flex h-2 gap-px overflow-hidden rounded-full bg-border"
          data-testid="home-journey-rail"
        >
          {legs.map((leg, i) => (
            <div
              key={leg.id}
              style={{ flexGrow: leg.days, flexBasis: 0, background: RAIL_FILLS[i % RAIL_FILLS.length] }}
            />
          ))}
        </div>

        <ol className="mt-4 flex flex-col gap-3 sm:flex-row">
          {legs.map((leg, i) => (
            <li
              key={leg.id}
              data-testid={`home-journey-leg-${leg.id}`}
              className="min-w-0 flex-1 rounded-2xl glass-card p-4"
            >
              <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-ink-lo">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: RAIL_FILLS[i % RAIL_FILLS.length] }}
                />
                Leg {i + 1}
              </p>
              {/* `break-words`: a custom pack's label is `destinations.join(' × ')` and can
                  be arbitrarily long, and a single unbroken token at this size is the one
                  thing that could push the card past the viewport at 360. */}
              <p className="mt-1 break-words font-display text-2xl leading-tight text-ink-hi">
                {leg.label}
              </p>
              <p className="mt-1 text-sm text-ink-mid">
                {formatDate(leg.start)} &ndash; {formatDate(leg.end)} &middot; {leg.days}{' '}
                {leg.days === 1 ? 'day' : 'days'}
              </p>
              <ul aria-label={`Cities on ${leg.label}`} className="mt-3 flex flex-wrap gap-1.5">
                {leg.cities.map((city) => (
                  <li
                    key={city}
                    className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-ink-lo"
                  >
                    {city}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
