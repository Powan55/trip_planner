'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { differenceInCalendarDays } from 'date-fns';

import CelebrationBurst from '@/components/celebration-burst';
import OptimizedImage from '@/components/optimized-image';
import { claimStamps, type StampBoard } from '@/core/places/passport';
import { TRIP_DATES, getCityForDate, getCountryForDate, formatDate } from '@/core/dates';
import { elapsedTripDates } from '@/core/recap/model';
import { getNowAtTrip } from '@/lib/trip-now';
import { journeyLegs } from '@/lib/journey-legs';
import { useItineraryContext } from '@/components/itinerary-provider';
import { INSPIRATION_HIGHLIGHTS } from '@/lib/inspiration-data';

/**
 * The stamp board (issue #5) — the device-dependent half of the passport page, now built as
 * the LOG the document actually is: thirty-two numbered slots, one per trip day, each drawn
 * at the size it will be, with the country stamps that have not been earned yet drawn dry.
 *
 * NOTHING HERE IS CAPTIONED AS ABSENT, and that is the whole design. At three months out
 * every slot is unwritten and both stamps are dry, so the empty state IS the surface: the
 * count, the date and the T-minus for each slot are real, the item counts are the itinerary's
 * own, and the reserved photographs sit desaturated in the row each day will be logged into.
 * A grey "No stamps yet" sentence was the previous answer and it is what this replaces.
 *
 * WHAT MAKES A STAMP "NEW" IS NOT DECIDED HERE. `claimStamps()` (core/places/passport.ts)
 * answers it against a persisted record of the stamps already shown, and consuming the answer
 * is what makes it a one-shot: reload this page and `fresh` is empty. A stamp that re-animates
 * on every visit is the defect that mechanism exists to avoid, so the read is also the write.
 *
 * THE MARKS. FILLED means committed, UNFILLED means not yet, and exactly one mark on the
 * surface is STAMPED with what is true today:
 *   - a trip day already lived   -> struck
 *   - the day the clock is on    -> the live stamp
 *   - every day still ahead      -> hollow, at full size
 * Every one of them also states its condition in words, so no mark is ever the only cue.
 *
 * THE UNLOCK is `<CelebrationBurst>` unmodified (it renders nothing at all under reduced
 * motion, and an e2e case asserts that), a CSS press that RESTS at the stamped state, and a
 * TEXT badge — the half that survives both of the others being switched off. It is capped at
 * three: a device that has just had a dozen countries entered on it must not fire a dozen
 * entrances at once. The badge is not capped; only the motion is.
 *
 * NO NEW DATA SOURCE. Trip dates, cities, countries and legs come from `core/dates` and
 * `lib/journey-legs`; item counts come from the itinerary provider the app already mounts;
 * the elapsed-day set is `core/recap/model`'s, the same one `/recap` reads. The reserved
 * photographs are bundled assets that already ship and are already credited.
 */

/** How long `active` stays true. Mirrors `wrapped-story.tsx`; the burst itself is ~600ms. */
const BURST_MS = 700;

/** D-293's entrance budget. The badge is not capped — only the motion is. */
const FLOURISH_CAP = 3;

/** Reserved-plate treatment, verbatim from the direction: a photograph that is not yet earned. */
const RESERVED_FILTER = 'saturate(.16) brightness(.62)';

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

/** The same fold, as the ink VALUE, for the dry stamps and the slot rules. */
function inkVar(country: string): string {
  const folded = country.trim().toLowerCase();
  if (folded === 'nepal') return 'var(--ink-nepal)';
  if (folded === 'japan') return 'var(--ink-japan)';
  return 'var(--ink-green)';
}

/**
 * Days from today to `date`, which is the ONE T-minus convention on this surface — the
 * prototype shipped two and read `T−0` for the last day of the trip. Positive before, zero on
 * the day, negative after.
 */
function tMinus(date: string, today: string): number {
  return differenceInCalendarDays(new Date(`${date}T00:00:00`), new Date(`${today}T00:00:00`));
}

/**
 * The photograph reserved for a slot. It is the leg's own bundled photography, taken in order
 * and repeating — the repeat is visible and deliberate, and it is the honest answer to "which
 * picture belongs to a day nobody has photographed yet". `null` when the leg ships none, which
 * is what draws the slot as an open dashed box instead.
 */
function reservedPlate(country: string, index: number) {
  // `getCountryForDate` answers the pack's LEG ID ('nepal'), the gallery is authored against
  // the label ('Nepal'). One fold, the same one `visited.ts` uses, rather than two spellings.
  const folded = country.trim().toLowerCase();
  const pool = INSPIRATION_HIGHLIGHTS.filter((h) => h.country.toLowerCase() === folded);
  return pool.length > 0 ? pool[index % pool.length] : null;
}

export default function PassportStamps() {
  const [board, setBoard] = useState<StampBoard | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const claimedRef = useRef(false);
  const { getDayPlan } = useItineraryContext();

  // '' until mount, then the destination-local trip day — the SAME clock `/recap` and the home
  // recap read, so the log and those surfaces can never disagree about which day it is.
  const [today, setToday] = useState('');
  useEffect(() => setToday(getNowAtTrip().date), []);

  const legs = useMemo(journeyLegs, []);

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
    // Component; this only reserves the board's space so the log does not shove the page.
    return (
      <div data-testid="passport-stamps" aria-busy="true" className="mt-8 min-h-[140px]">
        <span className="pr" style={{ color: 'var(--paper-lo)' }}>
          Loading
        </span>
      </div>
    );
  }

  const { countries, fresh } = board;
  const freshSet = new Set(fresh);
  const flourishSet = new Set(fresh.slice(0, FLOURISH_CAP));
  const earned = new Set(countries.map((c) => c.trim().toLowerCase()));
  const elapsed = new Set(elapsedTripDates(today));

  return (
    <div data-testid="passport-stamps" className="mt-8">
      {/* ---- The visa page: the two country stamps, and neither is pressed by hand ---- */}
      <p className="pr" style={{ color: 'var(--paper-lo)' }}>
        Visas
      </p>
      <ul className="mt-3 flex flex-wrap gap-3">
        {legs.map((leg) => {
          const isEarned = earned.has(leg.label.trim().toLowerCase());
          const ink = inkVar(leg.label);
          const days = today ? tMinus(leg.start, today) : null;
          return (
            <li
              key={leg.id}
              data-testid={`passport-visa-${leg.id}`}
              data-earned={isEarned ? 'true' : 'false'}
              className="min-w-[9.5rem] rounded-r2 px-3 py-2.5"
              style={{
                color: ink,
                border: `2px ${isEarned ? 'solid' : 'dashed'} ${ink}`,
                transform: `rotate(${leg.id === 'japan' ? '1.1deg' : '-1.4deg'})`,
              }}
            >
              <span className="pr block" style={{ color: ink }}>
                {leg.label}
              </span>
              <span className="num mt-0.5 block text-n-sm" style={{ color: ink }}>
                {formatDate(leg.start)}
              </span>
              {/* THE CONDITION IN WORDS. The dashed edge repeats it; it never carries it. */}
              <span className="pr mt-0.5 block" style={{ color: 'var(--paper-lo)' }}>
                {isEarned
                  ? 'Stamped'
                  : days === null
                    ? 'Not yet valid'
                    : `T−${Math.abs(days)} · not yet valid`}
              </span>
            </li>
          );
        })}
      </ul>
      <p
        className="mt-4 max-w-[46ch] text-t-body leading-relaxed"
        style={{ color: 'var(--on-paper)' }}
      >
        Both stamps stay dry until the app sees you inside the country. There is no manual
        unlock &mdash; an impression you can press yourself is not a record of anything.
      </p>

      {/* ---- The lifetime stamps, once any exist ---- */}
      <div className="mt-8 flex items-baseline justify-between gap-3">
        <p className="pr" style={{ color: 'var(--paper-lo)' }}>
          Stamps collected
        </p>
        <p data-testid="passport-count" className="num text-n-sm" style={{ color: 'var(--on-paper)' }}>
          {countries.length}
          <span className="pr ml-1" style={{ color: 'var(--paper-lo)' }}>
            {countries.length === 1 ? 'country' : 'countries'}
          </span>
        </p>
      </div>

      {countries.length === 0 ? (
        // NOT an empty state in the old sense: the slot board below IS the state, so this line
        // only names the condition that fills these frames. It sits at --t-body, never the
        // micro floor, and `e2e` reaches it by `passport-empty`.
        <div data-testid="passport-empty" className="mt-3">
          <ul aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <li className="passport-slot" />
            <li className="passport-slot" />
            <li className="passport-slot" />
          </ul>
          <p
            className="mt-4 max-w-md text-t-body leading-relaxed"
            style={{ color: 'var(--on-paper)' }}
          >
            No stamps yet. The first one lands the day your trip reaches Nepal, and any country
            you have already been to takes its place on this page as soon as it is counted.
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
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

      {/* ---- The slots: every trip day, at the size it will be ---- */}
      <div className="mt-10 flex items-baseline justify-between gap-3">
        <p className="pr" style={{ color: 'var(--paper-lo)' }}>
          The slots
        </p>
        <p className="pr" style={{ color: 'var(--paper-lo)' }}>
          {TRIP_DATES.length} days &middot; {elapsed.size} written
        </p>
      </div>
      <p
        className="mt-2 max-w-[52ch] text-t-body leading-relaxed"
        style={{ color: 'var(--on-paper)' }}
      >
        Every place already saved is waiting in the row it will be logged into. The photographs
        sit reserved until the day is written.
      </p>

      <ol data-testid="passport-slots" className="mt-4">
        {TRIP_DATES.map((date, i) => {
          const country = getCountryForDate(date);
          // The pack's own human label, never the raw leg id printed at the reader.
          const countryLabel = legs.find((l) => l.id === country)?.label ?? country;
          const city = getCityForDate(date);
          const count = getDayPlan(date).items.length;
          const plate = count > 0 ? reservedPlate(country, i) : null;
          const written = elapsed.has(date);
          const isToday = today !== '' && date === today;
          const ink = inkVar(country);
          const days = today ? tMinus(date, today) : null;

          return (
            <li
              key={date}
              data-testid={`passport-slot-${date}`}
              data-mark={isToday ? 'stamp' : written ? 'struck' : 'hollow'}
              className="grid grid-cols-[2.6rem_54px_1fr_auto] items-center gap-2 py-2 sm:gap-3"
              style={{ borderBottom: '1px solid var(--bind-lo)' }}
            >
              <span className="num text-t-sm" style={{ color: 'var(--paper-lo)' }}>
                {String(i + 1).padStart(3, '0')}
              </span>

              {plate ? (
                <span
                  className="block h-[40px] w-[54px] overflow-hidden"
                  style={{
                    border: `1px solid var(--bind-lo)`,
                    // The reserved treatment: present, and visibly not yet earned. A written
                    // day gets the photograph at full strength.
                    filter: written || isToday ? 'none' : RESERVED_FILTER,
                  }}
                >
                  <OptimizedImage
                    src={plate.image}
                    alt=""
                    width={54}
                    height={40}
                    className="h-full w-full object-cover"
                  />
                </span>
              ) : (
                // The genuinely open slot, drawn as a dashed box at thumbnail size.
                <span
                  aria-hidden="true"
                  className="block h-[40px] w-[54px]"
                  style={{ border: '1.5px dashed var(--paper-lo)' }}
                />
              )}

              <span className="min-w-0">
                <span
                  className="block truncate text-t-body font-semibold leading-tight"
                  style={{ color: written || isToday ? 'var(--on-paper)' : 'var(--paper-lo)' }}
                >
                  {city}
                </span>
                <span className="pr block" style={{ color: 'var(--paper-lo)' }}>
                  {count > 0
                    ? `${count} ${count === 1 ? 'item' : 'items'} · ${countryLabel}`
                    : `Nothing planned · ${countryLabel}`}
                </span>
              </span>

              <span className="text-right">
                <span className="num block text-t-sm" style={{ color: 'var(--on-paper)' }}>
                  {formatDate(date)}
                </span>
                {isToday ? (
                  // THE ONE STAMP ON THE SURFACE — what is true today, in the leg's own ink.
                  <span
                    className="pr mt-0.5 inline-block rounded-r1 px-1.5"
                    style={{
                      background: ink,
                      color: 'var(--paper)',
                      transform: 'rotate(-0.9deg)',
                    }}
                  >
                    Today
                  </span>
                ) : written ? (
                  <span className="pr mt-0.5 block" style={{ color: 'var(--on-paper)' }}>
                    Written
                  </span>
                ) : (
                  <span className="pr mt-0.5 block" style={{ color: 'var(--paper-lo)' }}>
                    {days === null ? 'Not yet' : `T−${Math.abs(days)}`}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
