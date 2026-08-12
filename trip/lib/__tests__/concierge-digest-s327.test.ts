// @vitest-environment jsdom
//
// S327 — trip-context digest: stable ids + compact format + cap-to-server-ceiling.
// Directly exercises the now-exported `buildTripDigest` (hooks/use-concierge-chat.ts).
// Proves: planned items carry a compact stable `#<id>`, tombstoned items are excluded,
// unplanned days are omitted (not printed as wasted lines), and the digest is hard-capped
// at the Worker CONTEXT_TRUNCATE_LENGTH ceiling. Also MEASURES a fully-populated trip.
//
// S362 extends it to the enriched per-item encoding, and to the
// body-budget measurement that justifies HISTORY_CHAR_CAP (see the MEASUREMENT test at the
// bottom — it is the source of those numbers, not a guess).
//
// #12 changes that encoding from 24-hour `HH:MM` to 12-hour `h:mm AM/PM`, and makes the date line
// unconditional, so every expectation and both pinned sizes below moved with it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildTripDigest, capHistory, type ChatTurn } from '@/hooks/use-concierge-chat';
import { ITINERARY_STORAGE_KEY } from '../itinerary-storage';
import { SAMPLE_ITINERARY } from '../sample-itinerary';
import { TRIP_DATES, TRIP_DATE_LABEL } from '@/core/dates';
import { effectiveStartMinutes, formatTimeAmPm } from '@/core/dates/item-time';
import { getNowAtTrip } from '../trip-now';
import type { DayPlan } from '../trip-data';

const DIGEST_CAP = 9500; // must equal the constant in use-concierge-chat.ts (coupled to the Worker; S362 raised 7000→9500)

// The MEASURED sizes of the fully-planned SAMPLE trip digest, before and after S362's per-item
// time+category prefixes. Asserted EXACTLY at the bottom of this file. DIGEST_CAP's slack and
// the Worker's CONTEXT_TRUNCATE_LENGTH coupling are both sized from these, so they are contract,
// not trivia. Adding a field to the digest SHOULD fail that assertion.
// #12 RE-MEASURED, 9024 → 9426 (+402), taken from the [S362 MEASUREMENT] block on the run that
// made this change, not adjusted to fit. Two causes, both wanted:
//   +351  the per-item time goes 24-hour `18:30` → 12-hour `6:30 PM` (+2 chars, +3 when the
//         12-hour form has two digits: 123 items and 35 items respectively of the 158 timed)
//   + 51  the date line is UNCONDITIONAL now, and carries a time, so it is in this measurement
//         where it used to be absent at this deliberately out-of-window instant
// The Worker's CONTEXT_TRUNCATE_LENGTH floor RISES from 9024 to 9426. It is 9500, so it still
// holds, but the slack is now THIN: 74 chars out of window and ~65 in it (the in-window date line
// is the longer branch). Raising DIGEST_CAP to buy more is a Worker deploy, not a client edit.
const MEASURED_DIGEST_BEFORE = 6610;
const MEASURED_DIGEST_AFTER = 9426;
const HISTORY_CHAR_CAP = 3000; // must equal the constant in use-concierge-chat.ts
const MAX_BODY_BYTES = 16 * 1024; // the Worker's hard 413 ceiling (worker/src/index.ts:24)
// S395: must equal TRIP_LABEL_MAX in use-concierge-chat.ts AND the Worker's own (providers.ts).
const TRIP_LABEL_MAX = 120;

function seed(plans: DayPlan[]) {
  localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(plans));
}

describe('buildTripDigest (S327)', () => {
  beforeEach(() => localStorage.clear());
  // S367: buildTripDigest() is now clock-dependent (the "Today is …" line). Any test in this file
  // that calls vi.setSystemTime/useFakeTimers must not leak a frozen clock into the next test.
  afterEach(() => vi.useRealTimers());

  it('tags each planned item with a compact stable #id and keeps the day + city', () => {
    seed([
      {
        date: TRIP_DATES[0],
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 'n1-1', title: 'Depart Syracuse', category: 'transportation' },
          { id: 'n1-2', title: 'Layover at JFK', category: 'transportation' },
        ],
      },
    ]);

    const digest = buildTripDigest();
    expect(digest).toContain('Depart Syracuse #n1-1');
    expect(digest).toContain('Layover at JFK #n1-2');
    expect(digest).toContain(`${TRIP_DATES[0]} Kathmandu:`);
    // header frames the whole trip so omitted days aren't lost
    expect(digest).toContain(`(${TRIP_DATES.length} days)`);
    expect(digest).toContain('#id');
  });

  describe('#12: each item encodes as "h:mm AM/PM category Title #id"', () => {
    // The date line now carries a TIME too, so the negative assertions in this block ("no 12:00 AM
    // anywhere") would otherwise depend on the wall-clock minute the suite happened to run at.
    // 12:00Z at the Nepal leg's +345 is 17:45 -> "5:45 PM", which collides with none of them.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    });

    it('emits a 12h time with an AM/PM marker, then the category, then the title, then the #id', () => {
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [
            { id: 'k7-2', title: 'Senso-ji', category: 'sightseeing', startMinutes: 9 * 60 },
            { id: 'a1-3', title: 'Ramen', category: 'food', startMinutes: 19 * 60 },
          ],
        },
      ]);

      const digest = buildTripDigest();
      // The full ordered encoding, not just its pieces: order IS the contract the digest's own
      // header line teaches the model.
      expect(digest).toContain(
        `${TRIP_DATES[0]} Kathmandu: 9:00 AM sightseeing Senso-ji #k7-2; 7:00 PM food Ramen #a1-3`,
      );
      // #12: the whole point. The evening item reads 7:00 PM, and 19:00 is nowhere on the wire.
      expect(digest).toContain('7:00 PM ');
      expect(digest).not.toContain('19:00');
      expect(digest).not.toContain('09:00');
    });

    it('midnight is 12:00 AM and noon is 12:00 PM, the two a naive hour%12 gets wrong', () => {
      // A `% 12` with no 0→12 fix prints "0:00 AM" for midnight, and an `h < 12 ? AM : PM` applied
      // to the wrong side prints "12:00 AM" for noon. Both are exactly 12 hours out, which is the
      // worst kind of wrong for a plan, so they are pinned rather than left to the helper's tests.
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [
            { id: 'm-1', title: 'Midnight ramen', category: 'food', startMinutes: 0 },
            { id: 'n-1', title: 'Noon temple', category: 'sightseeing', startMinutes: 12 * 60 },
          ],
        },
      ]);

      const digest = buildTripDigest();
      expect(digest).toContain('12:00 AM food Midnight ramen #m-1');
      expect(digest).toContain('12:00 PM sightseeing Noon temple #n-1');
      expect(digest).not.toContain('0:00 AM');
      expect(digest).not.toContain('0:00 PM');
    });

    it('a single-digit-minute time still zero-pads the MINUTES (12:05 AM, not 12:5 AM)', () => {
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 'e-1', title: 'Red-eye landing', category: 'transportation', startMinutes: 5 }],
        },
      ]);
      expect(buildTripDigest()).toContain('12:05 AM transportation Red-eye landing #e-1');
    });

    it('an item with NO time emits no time token at all, never a misleading 12:00 AM', () => {
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [
            { id: 'u-1', title: 'Wander Thamel', category: 'free' }, // no startMinutes, no time
            { id: 't-1', title: 'Dinner', category: 'food', startMinutes: 20 * 60 + 30 },
          ],
        },
      ]);

      const digest = buildTripDigest();
      expect(digest).toContain('free Wander Thamel #u-1'); // category leads — no time token
      expect(digest).not.toContain('12:00 AM'); // midnight would be a lie about an untimed item
      expect(digest).toContain('8:30 PM food Dinner #t-1'); // its neighbour still carries one
    });

    it('falls back to the legacy `time` string when `startMinutes` is absent (seed + sync items)', () => {
      // THE case that decides whether this slice does anything at all on a fresh device: the SEED
      // itinerary (core/content/itinerary.ts) is returned VERBATIM by the Vault fallback with no
      // migration, so every seed item has `time: '05:30'` and NO `startMinutes`. Reading the raw
      // field would emit a timeless digest for every first-visit user. D-139's shared parser is
      // the one place that reconciles the two, so the digest must go through it.
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 'legacy-1', title: 'Depart Syracuse', category: 'transportation', time: '05:30' }],
        },
      ]);
      // Parsed from the 24h storage string, emitted as 12h display (#12).
      expect(buildTripDigest()).toContain('5:30 AM transportation Depart Syracuse #legacy-1');
    });

    it('keeps the FULL ISO date on every day line (never shortened to 12-20)', () => {
      // Shortening would save ~160 chars and reintroduce the S342 bug class: a non-ISO date echoed
      // back in an op is dropped silently by validateOps (D-234 rule 4) — reply, but no chip.
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 'd-1', title: 'Arrive', category: 'transportation', startMinutes: 600 }],
        },
      ]);
      const digest = buildTripDigest();
      const dayLine = digest.split('\n').find((l) => l.includes('#d-1'))!;
      expect(dayLine.startsWith(`${TRIP_DATES[0]} `)).toBe(true); // 2026-12-09, all 10 chars
      expect(/^\d{4}-\d{2}-\d{2} /.test(dayLine)).toBe(true);
    });

    it('the header teaches the item format and drops the now-redundant trailing "Items tagged #id."', () => {
      const header = buildTripDigest().split('\n').slice(0, 2);
      expect(header[0]).toContain('Any date not listed below is unplanned.');
      expect(header[0]).not.toContain('Items tagged #id.'); // subsumed by the line below it
      // #12: the line teaches the format the items below ACTUALLY use, so it moved to 12-hour
      // with them. A digest whose header says HH:MM while its lines say 7:00 PM is the mis-parse.
      expect(header[1]).toBe(
        'Each item is "h:mm AM/PM category Title #id". A missing time means no set time yet.',
      );
    });
  });

  describe('S362 — capHistory bounds the outgoing history by CHARACTERS as well as turns', () => {
    const turns = (n: number, len: number): ChatTurn[] =>
      Array.from({ length: n }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as ChatTurn['role'],
        content: `t${i}-${'x'.repeat(len)}`,
      }));

    it('still keeps at most the last 12 turns when they are short', () => {
      const out = capHistory(turns(20, 5));
      expect(out).toHaveLength(12);
      expect(out[out.length - 1].content).toContain('t19-'); // newest survives
      expect(out[0].content).toContain('t8-'); // oldest 8 dropped by the turn cap
    });

    it('drops OLDEST turns first until the serialized history fits HISTORY_CHAR_CAP', () => {
      const out = capHistory(turns(12, 1000)); // 12 turns × ~1000 chars ≫ 4000
      expect(JSON.stringify(out).length).toBeLessThanOrEqual(HISTORY_CHAR_CAP);
      expect(out.length).toBeGreaterThan(0); // never empties the history entirely
      expect(out.length).toBeLessThan(12); // the char bound really bit
      expect(out[out.length - 1].content).toContain('t11-'); // the NEWEST turn is the one kept
      expect(JSON.stringify(out)).not.toContain('t0-'); // the oldest is the one dropped
    });

    it('a single turn larger than the whole budget degrades to empty rather than 413ing', () => {
      expect(capHistory(turns(1, HISTORY_CHAR_CAP * 2))).toEqual([]);
    });
  });

  it('S342: the header states the ISO date format and the exact valid range', () => {
    // Without this, the model echoed human dates ("Dec 20") or the wrong year into an op's `date`
    // and `validateOps` dropped it silently (D-234 rule 4) — no chip, no explanation.
    const digest = buildTripDigest();
    expect(digest).toContain(
      `Dates are YYYY-MM-DD between ${TRIP_DATES[0]} and ${TRIP_DATES[TRIP_DATES.length - 1]}`,
    );
    expect(digest.split('\n')[0]).toContain('2026-12-09'); // it's in the FIRST line (never truncated)
  });

  it('excludes tombstoned items (deleted === true), like visiblePlans', () => {
    seed([
      {
        date: TRIP_DATES[0],
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 'live-1', title: 'Boudhanath Stupa', category: 'sightseeing' },
          { id: 'dead-1', title: 'Cancelled tour', category: 'sightseeing', deleted: true },
        ],
      },
    ]);

    const digest = buildTripDigest();
    expect(digest).toContain('Boudhanath Stupa #live-1');
    expect(digest).not.toContain('Cancelled tour');
    expect(digest).not.toContain('#dead-1');
  });

  it('omits unplanned days entirely (no wasted "unplanned" lines)', () => {
    seed([
      {
        date: TRIP_DATES[0],
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: 'p-1', title: 'Planned thing', category: 'food' }],
      },
      { date: TRIP_DATES[1], city: 'Kathmandu', country: 'nepal', items: [] }, // empty day
    ]);

    const digest = buildTripDigest();
    expect(digest).toContain(`${TRIP_DATES[0]} Kathmandu:`);
    expect(digest).not.toContain(TRIP_DATES[1]); // the empty day's date never appears
    expect(digest).not.toContain('unplanned:'); // no per-day unplanned line
  });

  describe('#12: the current date AND time reach the digest in EVERY case, in or out of the window', () => {
    // The bug: this line hung off `getTodayInTrip()`, which is null outside Dec 9 - Jan 9, so an
    // off-trip conversation shipped a digest with no date at all and the model assumed day one of
    // the trip. All three cases below are the same line now; only the parenthetical differs.
    const dateLine = () => buildTripDigest().split('\n')[2]; // after the two fixed header lines

    it('INSIDE the window: the REAL trip-local day (destination-offset clock, not device-local), plus Day N and the time', () => {
      vi.useFakeTimers();
      // 2026-12-15T12:00:00Z at the Nepal leg's +345 offset is 17:45 -- still Dec 15, nowhere
      // near a day boundary. Day-7/Kathmandu is verified INDEPENDENTLY of the code under test:
      // core/trips/packs/nepal-japan-2026.ts (Nepal leg = Dec9-18) + core/content/itinerary.ts
      // (2026-12-15 -> Kathmandu) + counting Dec9..Dec15 inclusive = 7 -- not by calling
      // getTodayInTrip()/dayInTripFor and echoing back whatever they say. 12:00Z + 345min = 17:45
      // = 5:45 PM, computed the same way and likewise not read back off the code under test.
      vi.setSystemTime(new Date('2026-12-15T12:00:00Z'));
      expect(dateLine()).toBe('Today is 2026-12-15 5:45 PM (Day 7 of 32, Kathmandu).');
    });

    it('BEFORE the window: a real date and time, and it says so -- never silence', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z')); // four months before the trip starts
      expect(dateLine()).toBe('Today is 2026-08-11 5:45 PM (before the trip).');
    });

    it('AFTER the window: same line, other side', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2027-02-01T12:00:00Z')); // three weeks after the trip ends
      // Past the end, `legForDate` clamps to the LAST leg, so the clock reads at Japan's +540:
      // 12:00Z + 9h = 21:00 = 9:00 PM. Not the +345 the before-the-trip case clamps to.
      expect(dateLine()).toBe('Today is 2027-02-01 9:00 PM (after the trip).');
    });

    it('the digest NEVER ships without a date, whatever the clock says', () => {
      // The regression guard stated as the property rather than as three examples: one day before
      // the first trip date, the first, the last, one day after.
      for (const iso of ['2026-12-08', '2026-12-09', '2027-01-09', '2027-01-10']) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(`${iso}T12:00:00Z`));
        expect(dateLine(), `clock ${iso}`).toContain(`Today is ${iso} `);
        vi.useRealTimers();
      }
    });
  });

  it('S362: the fully-planned SAMPLE trip STILL fits under the raised 9500 cap, times and all', () => {
    // key absent => loadPlans() seeds SAMPLE_ITINERARY (items on every trip date). At the OLD 2000
    // cap this truncated mid-trip; S328/S329 raised it to 7000 for the ` #<id>` tags, and S362 to
    // 9500 for the `HH:MM category ` prefixes — the enriched digest MEASURES 9025 chars (asserted
    // exactly in the MEASUREMENT test below), so 7000 would have cut a third of the trip.
    const digest = buildTripDigest();
    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP);
    expect(digest.endsWith('…')).toBe(false); // no truncation — the whole trip fits now
    // sanity: the last trip date's day is present (nothing got cut off the end)
    const lastPlannedDate = [...SAMPLE_ITINERARY].reverse().find((d) => d.items.length > 0)!.date;
    expect(digest).toContain(lastPlannedDate);
    // and it would NOT have fit at the old ceiling — this is what justifies the raise
    expect(digest.length).toBeGreaterThan(7000);

    // #12: the cap has to hold on EVERY day, not just whatever day the suite runs on. The date
    // line is unconditional now and its in-window form ("… (Day 31 of 32, Tokyo).") is the LONGER
    // of the two branches, so the real worst case is inside the trip, not outside it. DIGEST_CAP
    // cannot be raised without the Worker's CONTEXT_TRUNCATE_LENGTH moving with it (they are
    // deliberately equal, see hooks/use-concierge-chat.ts), and that is a separate manual
    // deploy, so an overflow here is a genuine blocker rather than a number to nudge.
    let worst = 0;
    for (const date of TRIP_DATES) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(`${date}T06:00:00Z`)); // mid-day at both leg offsets, no day edge
      const d = buildTripDigest();
      worst = Math.max(worst, d.length);
      expect(d.endsWith('…'), `truncated with the clock on ${date}`).toBe(false);
      vi.useRealTimers();
    }
    expect(worst).toBeLessThanOrEqual(DIGEST_CAP);
    console.log(`[#12] worst-case in-window digest: ${worst} chars, ${DIGEST_CAP - worst} under DIGEST_CAP`);
  });

  it('still enforces the cap: a digest exceeding 9500 chars truncates with an ellipsis', () => {
    // Synthetic over-cap payload: pad every trip date with a long-titled item so the joined digest
    // blows past 9500. Proves the cap guard itself still fires at the new ceiling.
    const bigTitle = 'A very long itinerary item title used to pad the digest well past the cap '.repeat(4);
    seed(
      TRIP_DATES.map((date, di) => ({
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: Array.from({ length: 3 }, (_, ii) => ({
          id: `big-${di}-${ii}`,
          title: bigTitle,
          category: 'sightseeing' as const,
        })),
      })),
    );
    const digest = buildTripDigest();
    expect(digest.length).toBe(DIGEST_CAP); // exactly cap length (cap-1 chars + '…')
    expect(digest.endsWith('…')).toBe(true);
  });

  it('MEASUREMENT (S362) — before/after digest size and the worst-case POST body vs the 16 KB 413', () => {
    // Pin the clock before measuring. `buildTripDigest()` is clock-dependent (the "Today is …"
    // line), so without this the self-check below would pass or fail depending on the calendar
    // day AND the wall-clock minute the suite happened to run at. Freezing to a fixed instant
    // makes the measurement (and the pinned constants it feeds) exactly reproducible year-round,
    // the same discipline the S274 block already uses for TZ determinism.
    // #12: that line is UNCONDITIONAL now, so the reconstruction below models it instead of
    // dodging it with an out-of-window clock. This instant is still out of window, so the number
    // measured here is the SHORTER branch; the in-window branch is longer, and the cap test above
    // is what proves that one fits, on every one of the 32 trip days.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    // Task D of S362: the four numbers below are MEASURED here, never estimated.
    // Rebuild BOTH formats over the same fully-planned SAMPLE trip, using the real header strings
    // and `buildTripDigest`'s own day-selection logic, so the before/after delta is honest.
    const range = `Dates are YYYY-MM-DD between ${TRIP_DATES[0]} and ${TRIP_DATES[TRIP_DATES.length - 1]}.`;
    const oldHeader = `Trip: ${TRIP_DATE_LABEL} (${TRIP_DATES.length} days). ${range} Any date not listed below is unplanned. Items tagged #id.`;
    const nowAt = getNowAtTrip(); // the same clock adapter the builder uses, at the frozen instant
    const newHeader = [
      `Trip: ${TRIP_DATE_LABEL} (${TRIP_DATES.length} days). ${range} Any date not listed below is unplanned.`,
      'Each item is "h:mm AM/PM category Title #id". A missing time means no set time yet.',
      `Today is ${nowAt.date} ${formatTimeAmPm(nowAt.minutes)} (before the trip).`,
    ].join('\n');

    const byDate = new Map(SAMPLE_ITINERARY.map((d) => [d.date, d]));
    const days = TRIP_DATES.map((date) => byDate.get(date)).filter(
      (d): d is DayPlan => !!d && d.items.length > 0,
    );
    const oldDigest = [
      oldHeader,
      ...days.map((d) => `${d.date} ${d.city}: ${d.items.map((i) => `${i.title} #${i.id}`).join('; ')}`),
    ].join('\n');
    const newDigest = [
      newHeader,
      ...days.map(
        (d) =>
          `${d.date} ${d.city}: ${d.items
            .map((i) => {
              const m = effectiveStartMinutes(i);
              return `${m === undefined ? '' : `${formatTimeAmPm(m)} `}${i.category} ${i.title} #${i.id}`;
            })
            .join('; ')}`,
      ),
    ].join('\n');

    // (3) WORST-CASE POST BODY: the digest padded to its cap, a full 12-turn history squeezed
    // through the real `capHistory`, and a 2000-char message — the exact JSON the hook would send.
    const bigHistory = capHistory(
      Array.from({ length: 12 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as ChatTurn['role'],
        content: 'y'.repeat(600),
      })),
    );
    // The pad is REAL digest text repeated to the cap, not 'x'.repeat(): the live digest is full of
    // multi-byte characters (— · → in the seed titles), and content-length counts UTF-8 BYTES, so
    // an ASCII pad would understate the only figure that actually decides a 413.
    //
    // S395: the `trip` descriptor now joins the body on a CUSTOM trip, so the worst case includes
    // it — at its own worst case, a label at the full TRIP_LABEL_MAX of 120 multi-byte characters
    // (the client slices by CODE UNITS, so a 120-char label can weigh up to ~360 UTF-8 bytes; '×'
    // is what a real custom label actually contains, `core/trips/custom.ts` joining destinations).
    // This is a BOUND, not a scenario: no real body can exceed it, which is the only property
    // worth asserting against a hard 413 that runs on raw bytes before any parse.
    const worstTrip = {
      label: '×'.repeat(TRIP_LABEL_MAX),
      start: '2027-03-01',
      end: '2027-03-05',
    };
    const worstBody = JSON.stringify({
      message: 'z'.repeat(2000),
      history: bigHistory,
      context: newDigest.repeat(Math.ceil(DIGEST_CAP / newDigest.length)).slice(0, DIGEST_CAP),
      trip: worstTrip,
    });
    // The Worker checks BOTH the content-length header (bytes) and rawBody.length (chars); bytes
    // is the larger of the two for any non-ASCII payload, so it is the binding constraint.
    const worstBytes = new TextEncoder().encode(worstBody).length;
    const totalItems = days.reduce((n, d) => n + d.items.length, 0);
    const timed = days.reduce(
      (n, d) => n + d.items.filter((i) => effectiveStartMinutes(i) !== undefined).length,
      0,
    );

    console.log(
      `\n[S362 MEASUREMENT — fully-planned 32-day SAMPLE trip, ${totalItems} items (${timed} timed)]\n` +
        `  (1) digest BEFORE (title #id)        : ${oldDigest.length} chars\n` +
        `  (2) digest AFTER  (HH:MM cat title #id): ${newDigest.length} chars  (+${newDigest.length - oldDigest.length}, ~${((newDigest.length - oldDigest.length) / totalItems).toFixed(1)}/item)\n` +
        `      as UTF-8                         : ${new TextEncoder().encode(newDigest).length} bytes (multi-byte titles)\n` +
        `      vs DIGEST_CAP ${DIGEST_CAP}            : ${DIGEST_CAP - newDigest.length} chars of cap unused\n` +
        `  (3) worst-case POST body             : ${worstBody.length} chars / ${worstBytes} bytes\n` +
        `        digest at cap ${DIGEST_CAP} + history ${JSON.stringify(bigHistory).length} (cap ${HISTORY_CHAR_CAP}, ${bigHistory.length}/12 turns kept) + message 2000 + trip ${new TextEncoder().encode(JSON.stringify(worstTrip)).length} bytes (S395, label at TRIP_LABEL_MAX ${TRIP_LABEL_MAX}) + JSON overhead\n` +
        `  (4) headroom under MAX_BODY_BYTES ${MAX_BODY_BYTES}: ${MAX_BODY_BYTES - worstBytes} bytes\n` +
        `  COUPLING: the Worker's CONTEXT_TRUNCATE_LENGTH must be >= ${newDigest.length} (it re-slices\n` +
        `  context server-side), so a 9000 ceiling would silently cut ${newDigest.length - 9000} chars off the last day.\n`,
    );

    // SELF-CHECK: the reconstruction above must reproduce the REAL builder byte-for-byte, or the
    // "before" number it derives is fiction. (localStorage is cleared, so the builder is reading
    // the very same SAMPLE_ITINERARY via the Vault fallback.) Asserted AFTER the log so the
    // instrumentation still prints when it fails.
    expect(newDigest).toBe(buildTripDigest());

    // The enriched digest still fits the raised cap uncut — the point of the 7000 → 9500 raise.
    expect(newDigest.length).toBeLessThanOrEqual(DIGEST_CAP);
    expect(newDigest.length).toBeGreaterThan(oldDigest.length); // times + categories really landed

    // THE TWO ABSOLUTE ASSERTIONS. Everything above is RELATIVE (<= cap, > before), which means a
    // digest that silently became 7000 or 9400 chars would still pass while the printed numbers
    // quietly changed underneath the decisions built on them. These two pin the sizes themselves,
    // EXACTLY and with no tolerance band, so that changing what the digest contains fails here and
    // forces a deliberate re-measure instead of rotting in a console.log nobody reads.
    const REMEASURE =
      'Do NOT widen this assertion or add a tolerance — that just moves the rot. Re-measure from ' +
      'the [S362 MEASUREMENT] block printed above, then update this constant AND every comment ' +
      'that quotes the number: DIGEST_CAP + its slack claim ' +
      '(hooks/use-concierge-chat.ts), and the Worker CONTEXT_TRUNCATE_LENGTH coupling, which must ' +
      'stay >= the new size or the server silently truncates the last day.';
    expect(
      oldDigest.length,
      `S362 (1): the PRE-S362 digest size changed. ${REMEASURE}`,
    ).toBe(MEASURED_DIGEST_BEFORE);
    expect(
      newDigest.length,
      `S362 (2): the live digest size changed. The cost of the per-item "h:mm AM/PM category " ` +
        `prefixes, and the remaining slack under DIGEST_CAP ${DIGEST_CAP}, are both computed ` +
        `from this exact number. ${REMEASURE}`,
    ).toBe(MEASURED_DIGEST_AFTER);

    // ...and the worst case the hook can now emit still clears the Worker's 413 ceiling. LEFT
    // RELATIVE deliberately: this one is genuinely about the limit, not about a fixed body size.
    //
    // S395: `trip` is now inside `worstBody`, so this IS the DoD's "worst-case body under 16 KB
    // WITH the trip field" check. Belt and braces below — the field really is in the serialized
    // string, so a refactor that silently dropped it could not leave this assertion looking green.
    expect(worstBody).toContain('"trip":');
    expect(worstBytes).toBeLessThan(MAX_BODY_BYTES);
  });
});
