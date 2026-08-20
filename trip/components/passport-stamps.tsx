'use client';

import { useEffect, useRef, useState } from 'react';

import CelebrationBurst from '@/components/celebration-burst';
import { claimStamps, type StampBoard } from '@/core/places/passport';

/**
 * The stamp board (issue #5) — the device-dependent half of the passport page. Renders every
 * country in the lifetime visit set as a pressed stamp on the parchment sheet the Server Component
 * page owns, and gives the ones being counted for the FIRST time their unlock moment.
 *
 * WHAT MAKES A STAMP "NEW" IS NOT DECIDED HERE. `claimStamps()` (core/places/passport.ts) answers
 * it against a persisted record of the stamps already shown, and consuming the answer is what makes
 * it a one-shot: reload this page and `fresh` is empty. A stamp that re-animates on every visit is
 * the defect this whole mechanism exists to avoid, so the read is also the write.
 *
 * The unlock is a one-shot COMPLETION in D-323's sense — earned feedback for a transition the
 * traveller caused by going somewhere — so it does not lean on this route's tier. /passport is
 * Tier 1 for its entrance and its company (`lib/motion.ts`), not for this.
 *
 * THREE THINGS THE UNLOCK IS, AND ONE IT IS NOT:
 * - It is `<CelebrationBurst>`, unmodified. That component already carries the hard reduced-motion
 *   guard (it renders nothing at all under reduce) and an e2e case asserting it; a second
 *   celebration helper would be a second thing to get that wrong in.
 * - It is a CSS press (`.passport-stamp--new`, globals.css) that rests at the stamped state, so the
 *   app-wide reduced-motion collapse lands it settled and upright with no JS fork to forget.
 * - It is a TEXT badge, which is the half that survives both of the above being switched off. The
 *   unlock is never conveyed by motion alone.
 * - It is NOT unbounded. D-293's budget is at most three entrances on a screen, and a device that
 *   has just had a dozen countries entered on it would otherwise fire a dozen at once, so the
 *   flourish is capped and the rest are simply present — still flagged, still counted.
 */

/** How long `active` stays true. Mirrors `wrapped-story.tsx`; the burst itself is ~600ms. */
const BURST_MS = 700;

/** D-293's entrance budget. The badge is not capped — only the motion is. */
const FLOURISH_CAP = 3;

/**
 * The three D-294 inks, and there is no fourth. Nepal and Japan carry the trip's own two; every
 * other country is stamped in the green. The trip's country labels come from
 * `countryLabelForDate` ('Nepal', 'Japan', 'USA'), and a hand-entered one is whatever the traveller
 * typed, so the match folds case and whitespace exactly as `core/places/visited.ts` does.
 */
function inkClass(country: string): string {
  const folded = country.trim().toLowerCase();
  if (folded === 'nepal') return 'passport-stamp--nepal';
  if (folded === 'japan') return 'passport-stamp--japan';
  return 'passport-stamp--green';
}

export default function PassportStamps() {
  const [board, setBoard] = useState<StampBoard | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const claimedRef = useRef(false);

  // Claim ONCE per mount. The ref (not the effect's own guard) is what survives a StrictMode
  // double-invoke in development: the second run must not spend an unlock the first one already
  // consumed, and must not overwrite the board with an empty `fresh`.
  useEffect(() => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    const claimed = claimStamps();
    setBoard(claimed);
    if (claimed.fresh.length > 0) setCelebrate(true);
  }, []);

  // The burst window lives in its own effect keyed on `celebrate`, deliberately: folded into the
  // claim effect above, StrictMode's mount → cleanup → mount would clear the timer and re-enter
  // through the ref guard, leaving the burst on screen forever.
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), BURST_MS);
    return () => clearTimeout(timer);
  }, [celebrate]);

  if (board === null) {
    // Pre-hydration. The sheet, the heading and the copy are already painted by the Server
    // Component; this only reserves the board's space so the stamps do not shove the page.
    return <div data-testid="passport-stamps" aria-busy="true" className="mt-8 min-h-[140px]" />;
  }

  const { countries, fresh } = board;
  const freshSet = new Set(fresh);
  const flourishSet = new Set(fresh.slice(0, FLOURISH_CAP));

  return (
    <div data-testid="passport-stamps" className="mt-8">
      <p className="text-eyebrow uppercase" style={{ color: 'var(--paper-lo)' }}>
        Stamps collected
      </p>
      <p data-testid="passport-count" className="mt-1 text-2xl font-bold">
        {countries.length} {countries.length === 1 ? 'country' : 'countries'}
      </p>

      {countries.length === 0 ? (
        <div data-testid="passport-empty" className="mt-5">
          <ul aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <li className="passport-slot" />
            <li className="passport-slot" />
            <li className="passport-slot" />
          </ul>
          <p className="mt-5 max-w-md text-sm leading-relaxed" style={{ color: 'var(--paper-lo)' }}>
            No stamps yet. The first one lands the day your trip reaches Nepal, and any country you
            have already been to takes its place on this page as soon as it is counted.
          </p>
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {countries.map((country) => {
            const isFresh = freshSet.has(country);
            return (
              <li
                key={country}
                data-testid={`passport-stamp-${country}`}
                data-fresh={isFresh ? 'true' : undefined}
                className={`passport-stamp ${inkClass(country)}${
                  flourishSet.has(country) ? ' passport-stamp--new' : ''
                }`}
              >
                <CelebrationBurst
                  active={celebrate && flourishSet.has(country)}
                  // R6's burst cap is "never twice for the same stamp", so the country IS the
                  // entity. The lifetime record (key 35) already makes an unlock one-shot across
                  // sessions; this is the same guarantee inside one, and it is free here.
                  celebrationId={`stamp:${country}`}
                  weight="burst"
                />
                <span className="passport-stamp__country">{country}</span>
                <span className="passport-stamp__mark">Visited</span>
                {isFresh && <span className="passport-stamp__new">New</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
