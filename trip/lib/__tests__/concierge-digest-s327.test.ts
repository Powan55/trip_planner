// @vitest-environment jsdom
//
// S327 — trip-context digest: stable ids + compact format + cap-to-server-ceiling.
// Directly exercises the now-exported `buildTripDigest` (hooks/use-concierge-chat.ts).
// Proves: planned items carry a compact stable `#<id>`, tombstoned items are excluded,
// unplanned days are omitted (not printed as wasted lines), and the digest is hard-capped
// at the Worker CONTEXT_TRUNCATE_LENGTH ceiling. Also MEASURES a fully-populated trip.
//
// S362 extends it to the enriched per-item encoding `HH:MM category Title #id`, and to the
// body-budget measurement that justifies HISTORY_CHAR_CAP (see the MEASUREMENT test at the
// bottom — it is the source of those numbers, not a guess).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildTripDigest, capHistory, type ChatTurn } from '@/hooks/use-concierge-chat';
import { ITINERARY_STORAGE_KEY } from '../itinerary-storage';
import { SAMPLE_ITINERARY } from '../sample-itinerary';
import { TRIP_DATES, TRIP_DATE_LABEL } from '@/core/dates';
import { effectiveStartMinutes } from '@/core/dates/item-time';
import { minutesToHHMM } from '../time-picker-format';
import type { DayPlan } from '../trip-data';

const DIGEST_CAP = 9500; // must equal the constant in use-concierge-chat.ts (coupled to the Worker; S362 raised 7000→9500)

// The MEASURED sizes of the fully-planned SAMPLE trip digest, before and after S362's per-item
// `HH:MM category ` prefixes. Asserted EXACTLY at the bottom of this file — DIGEST_CAP's slack and
// the Worker's CONTEXT_TRUNCATE_LENGTH coupling are both sized from these, so they are contract,
// not trivia. Adding a field to the digest SHOULD fail that assertion.
// S393 RE-MEASURED (both −1 char): the Dec-9 day line renames 'Kathmandu' → 'Syracuse', one
// character shorter, and each digest carries that day line exactly once. Taken from the
// [S362 MEASUREMENT] block on the run that made this change, not adjusted to fit.
// Both couplings still hold and neither needed an edit: DIGEST_CAP 9500 now has 476 chars of
// slack (was 475 — S395 corrected the matching phrasing in hooks/use-concierge-chat.ts, which
// S393 flagged rather than edited because that file belonged to another lane), and the Worker's
// CONTEXT_TRUNCATE_LENGTH floor RELAXES from 9025 to 9024, so a shrink can never breach it.
const MEASURED_DIGEST_BEFORE = 6610;
const MEASURED_DIGEST_AFTER = 9024;
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

  describe('S362 — each item encodes as "HH:MM category Title #id"', () => {
    it('emits a zero-padded 24h HH:MM, then the category, then the title, then the #id', () => {
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
      // The full ordered encoding, not just its pieces — order IS the contract the Worker's
      // system prompt (S362A-WORKER) is written against.
      expect(digest).toContain(
        `${TRIP_DATES[0]} Kathmandu: 09:00 sightseeing Senso-ji #k7-2; 19:00 food Ramen #a1-3`,
      );
      // zero-padded, 24-hour — 09:00 not 9:00, 19:00 not 7:00 PM
      expect(digest).toContain('09:00 ');
      expect(digest).toContain('19:00 ');
      expect(digest).not.toContain('7:00 PM');
    });

    it('a single-digit-minute time still zero-pads BOTH fields (00:05, not 0:5)', () => {
      seed([
        {
          date: TRIP_DATES[0],
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 'e-1', title: 'Red-eye landing', category: 'transportation', startMinutes: 5 }],
        },
      ]);
      expect(buildTripDigest()).toContain('00:05 transportation Red-eye landing #e-1');
    });

    it('an item with NO time emits no time token at all — never a misleading 00:00', () => {
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
      expect(digest).not.toContain('00:00'); // midnight would be a lie about an untimed item
      expect(digest).toContain('20:30 food Dinner #t-1'); // its neighbour still carries one
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
      expect(buildTripDigest()).toContain('05:30 transportation Depart Syracuse #legacy-1');
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
      expect(header[1]).toBe(
        'Each item is "HH:MM category Title #id". A missing HH:MM means no set time yet.',
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

  describe('S367 — the current trip-local date reaches the digest ("what\'s the plan for tomorrow?")', () => {
    it('adds a "Today is …" line for the REAL trip-local day (destination-offset clock, not device-local)', () => {
      vi.useFakeTimers();
      // 2026-12-15T12:00:00Z at the Nepal leg's +345 offset is 17:45Z -- still Dec 15, nowhere
      // near a day boundary. Day-7/Kathmandu is verified INDEPENDENTLY of the code under test:
      // core/trips/packs/nepal-japan-2026.ts (Nepal leg = Dec9-18) + core/content/itinerary.ts
      // (2026-12-15 -> Kathmandu) + counting Dec9..Dec15 inclusive = 7 -- not by calling
      // getTodayInTrip()/dayInTripFor and echoing back whatever they say.
      vi.setSystemTime(new Date('2026-12-15T12:00:00Z'));

      const digest = buildTripDigest();
      const lines = digest.split('\n');
      // Third line: after the two fixed header lines, before any per-day content.
      expect(lines[2]).toBe('Today is 2026-12-15 (Day 7 of 32, Kathmandu).');
    });

    it('omits the line entirely outside the trip window -- no trip-local "today" to report (stated limit)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2027-02-01T12:00:00Z')); // three weeks after the trip ends
      expect(buildTripDigest()).not.toContain('Today is');
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
    // S367: pin the clock OUTSIDE the trip window before measuring. `buildTripDigest()` is now
    // clock-dependent (it appends a "Today is …" line while inside Dec 9 – Jan 9), and this test's
    // `newDigest` is a hand-rolled reconstruction that intentionally does NOT model that line — so
    // without this, the self-check below would pass or fail depending on which calendar day the
    // suite happened to run on (verified: it fails if simulated inside the window). Freezing to a
    // fixed out-of-window instant makes the measurement (and the pinned constants it feeds) exactly
    // reproducible year-round, the same discipline the S274 block already uses for TZ determinism.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    // Task D of S362: the four numbers below are MEASURED here, never estimated.
    // Rebuild BOTH formats over the same fully-planned SAMPLE trip, using the real header strings
    // and `buildTripDigest`'s own day-selection logic, so the before/after delta is honest.
    const range = `Dates are YYYY-MM-DD between ${TRIP_DATES[0]} and ${TRIP_DATES[TRIP_DATES.length - 1]}.`;
    const oldHeader = `Trip: ${TRIP_DATE_LABEL} (${TRIP_DATES.length} days). ${range} Any date not listed below is unplanned. Items tagged #id.`;
    const newHeader = [
      `Trip: ${TRIP_DATE_LABEL} (${TRIP_DATES.length} days). ${range} Any date not listed below is unplanned.`,
      'Each item is "HH:MM category Title #id". A missing HH:MM means no set time yet.',
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
              return `${m === undefined ? '' : `${minutesToHHMM(m)} `}${i.category} ${i.title} #${i.id}`;
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

    // eslint-disable-next-line no-console
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
      'that quotes the number: DIGEST_CAP + its "476 chars of slack" claim ' +
      '(hooks/use-concierge-chat.ts), and the Worker CONTEXT_TRUNCATE_LENGTH coupling, which must ' +
      'stay >= the new size or the server silently truncates the last day.';
    expect(
      oldDigest.length,
      `S362 (1): the PRE-S362 digest size changed. ${REMEASURE}`,
    ).toBe(MEASURED_DIGEST_BEFORE);
    expect(
      newDigest.length,
      `S362 (2): the live digest size changed — the +2414-char cost of the "HH:MM category " ` +
        `prefixes, and the 476 chars of slack under DIGEST_CAP ${DIGEST_CAP}, are both computed ` +
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
