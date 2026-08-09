import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S383 (INTAKE-07) — "filter by name" must empty the whole calendar surface, not just the list.
 *
 * Reported: *"when i click on the filter by name all everything thats not related to that person should
 * dessipear from the calander etc."* Before this slice exactly ONE consumer filtered (the day's
 * item list); every other piece of chrome read the unfiltered stored day. With "Sushil" selected
 * the list showed 2 rows under a pill reading "5 items", a month cell with 5 dots and an
 * `aria-label` announcing "5 activities planned", and a map plotting all 5.
 *
 * THIS PACK HAS TWO HALVES AND THE SECOND ONE IS THE IMPORTANT ONE:
 *
 *  1. PROPAGATION — with a name selected, every number narrows together.
 *  2. 🔴 NON-REGRESSION — with NO filter selected, every one of those numbers is byte-identical to
 *     the pre-S383 build. `NO_FILTER_BASELINE` below is not a guess or a self-capture: it was
 *     recorded by running this exact spec against the UNMODIFIED `calendar-planner.tsx` /
 *     `trip-timeline.tsx` and pasting the printed snapshot in. So it is a genuine before/after
 *     comparison, and a future change that quietly filters the no-filter path fails here.
 *
 * Harness conventions are `sort-clash.spec.ts`'s verbatim: the shared signed-in fixture (which
 * also dismisses the app-wide `duration:Infinity` install toast), `domcontentloaded` +
 * `waitForPlannerReady`, never `networkidle` (D-093).
 *
 * D-018 / D-142 are load-bearing here: the filter is presentational, so nothing below writes to
 * the store, and NO assertion may depend on items being reordered — filtering narrows, never sorts.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

/** Two real trip dates inside NEPAL_START..NEPAL_END, reserved for this spec's fixtures. */
const FIXTURE_DAY = '2026-12-15';
const SPAN_DAY = '2026-12-16';

/** The fixture identity (`e2e/fixtures.ts` signs in as Powan). "Sushil" is the other author. */
const ME = 'Powan';
const OTHER = 'Sushil';

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/**
 * The controlled two-author day. Every item carries a lat/lng so `buildItineraryStops` synthesizes
 * one marker PER ITEM (`pinMarker` uses `item.id`) — that way the map readout's numerator moves
 * with the filter too, not just its denominator.
 *
 * Deliberate shape:
 *   · the EARLIEST item is mine, so filtering to Sushil must MOVE the "From" pill, not just keep it;
 *   · the one clashing PAIR is cross-author, so filtering to either name must drop BOTH badges —
 *     a filter that narrowed the list but not the clash set would leave a badge warning about a
 *     collision with something not on screen;
 *   · one multi-day span is mine and starts on FIXTURE_DAY, running into SPAN_DAY, so the band is
 *     exercised on its start day AND on a day it merely covers.
 */
async function seedTwoAuthorDays(page: Page) {
  await page.evaluate(
    ({ key, day, spanDay, me, other }) => {
      const item = (
        id: string,
        title: string,
        createdBy: string,
        startMinutes: number,
        extra: Record<string, unknown> = {},
      ) => ({
        id,
        title,
        category: 'sightseeing',
        startMinutes,
        durationMinutes: 60,
        createdBy,
        lat: 27.7 + startMinutes / 100000,
        lng: 85.3 + startMinutes / 100000,
        ...extra,
      });
      window.localStorage.setItem(
        key,
        JSON.stringify([
          {
            date: day,
            city: 'Kathmandu',
            country: 'nepal',
            items: [
              item('af-p1', 'Powan Morning', me, 480), // 08:00 — the earliest, and MINE
              item('af-p2', 'Powan Clash', me, 600), // 10:00-11:00 ┐ cross-author
              item('af-s1', 'Sushil Clash', other, 630), // 10:30-11:30 ┘ overlap
              item('af-s2', 'Sushil Afternoon', other, 840), // 14:00
              item('af-p3', 'Powan Span', me, 1080, { endDate: spanDay }), // 18:00, spans
            ],
          },
          {
            date: spanDay,
            city: 'Kathmandu',
            country: 'nepal',
            items: [item('af-s3', 'Sushil Next Day', other, 540)],
          },
        ]),
      );
    },
    { key: ITINERARY_KEY, day: FIXTURE_DAY, spanDay: SPAN_DAY, me: ME, other: OTHER },
  );
}

/**
 * Every calendar-chrome number on one screen, read in ONE `page.evaluate` so the whole surface is
 * sampled from a single committed render (a per-locator read could straddle two).
 *
 * These are exactly the seven rows of the reviewer's INTAKE-07 inventory plus the item list.
 */
type ChromeSnapshot = Awaited<ReturnType<typeof chromeSnapshot>>;

async function chromeSnapshot(page: Page, date: string) {
  return page.evaluate((d: string) => {
    const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const cell = document.querySelector(`[data-testid="calendar-day-${d}"]`);
    const strip = document.querySelector(`[data-testid="day-strip-${d}"]`);
    const map = document.querySelector('[data-testid="plan-day-map"]');
    return {
      // The item list itself. `calendar-item-edit-<id>` is exactly one per rendered card, so it
      // counts cards without also matching the nested `calendar-item-time-*` / `-clash-*` nodes.
      rowIds: Array.from(document.querySelectorAll('[data-testid^="calendar-item-edit-"]')).map(
        (el) => el.getAttribute('data-testid')!.replace('calendar-item-edit-', ''),
      ),
      // 1d row 1 — the day-glance "N items" pill.
      glanceCount: text('[data-testid="calendar-day-glance-count"]'),
      // 1d row 2 — the "From <first start>" pill.
      firstStart: text('[data-testid="calendar-day-glance-first-start"]'),
      // 1d row 3 — clash badges.
      clashIds: Array.from(document.querySelectorAll('[data-testid^="calendar-item-clash-"]')).map(
        (el) => el.getAttribute('data-testid')!.replace('calendar-item-clash-', ''),
      ),
      // 1d row 4 — the mobile day-strip count (it lives in the chip's accessible name).
      stripLabel: strip?.getAttribute('aria-label') ?? null,
      // 1d row 5 — month-grid dots, and the cell's own a11y announcement.
      monthDots: cell?.querySelectorAll('.absolute.bottom-1 > div').length ?? null,
      monthLabel: cell?.getAttribute('aria-label') ?? null,
      // 1d row 6 — the split-view day map. `data-total-count` is the denominator the host is
      // handed; the readout carries both numbers.
      mapTotalAttr: map?.getAttribute('data-total-count') ?? null,
      mapCountText: text('[data-testid="plan-day-map-count"]'),
      // 1d row 7 — multi-day span bands.
      spanBandIds: Array.from(
        document.querySelectorAll('[data-testid^="calendar-span-band-"]'),
      ).map((el) => el.getAttribute('data-testid')!.replace('calendar-span-band-', '')),
      // The empty state, and WHICH of its two copies is showing.
      emptyStateCopy: text('[data-testid="calendar-empty-state"]'),
    };
  }, date);
}

/** Open the split-view day map so the map row of the snapshot is populated. */
async function openMap(page: Page) {
  const toggle = page.getByTestId('plan-map-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await page.getByTestId('plan-day-map').waitFor({ state: 'visible', timeout: 20_000 });
}

async function selectDay(page: Page, date: string) {
  await page.getByTestId(`calendar-day-${date}`).click();
}

/**
 * The PLANNER's filter control, scoped.
 *
 * Scoped deliberately, and the reason matters: before S383 this control was mounted TWICE on
 * `/plan` (planner toolbar + timeline), so an unscoped `getByTestId` is a strict-mode violation on
 * the old build. An unscoped locator would therefore fail every test in this file for the WRONG
 * reason ("resolved to 2 elements"), masking the propagation defect the pack exists to measure.
 * Scoping keeps each test failing for its own reason; the duplicate itself has its own test below,
 * which is deliberately NOT scoped.
 */
function plannerFilter(page: Page) {
  return page.getByTestId('calendar-toolbar-panel');
}

async function pickAuthor(page: Page, name: string) {
  await plannerFilter(page).getByTestId(`author-filter-author-${name}`).click();
  await expect(
    plannerFilter(page).getByTestId(`author-filter-author-${name}`),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function pickMine(page: Page) {
  await plannerFilter(page).getByTestId('author-filter-mine').click();
  await expect(plannerFilter(page).getByTestId('author-filter-mine')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. PROPAGATION — a selected name empties the chrome, not just the list
// ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe('S383 — a selected author narrows the WHOLE calendar surface', () => {
  test('every chrome number agrees with the filtered set (pill, From, clashes, dots, a11y label, strip, map, bands)', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await selectDay(page, FIXTURE_DAY);
    await openMap(page);

    // ── Unfiltered: the whole stored day. This is also the control for the narrowing below —
    // if these five were not all present, the filtered assertions could pass vacuously.
    const all = await chromeSnapshot(page, FIXTURE_DAY);
    expect(all.rowIds).toEqual(['af-p1', 'af-p2', 'af-s1', 'af-s2', 'af-p3']);
    expect(all.glanceCount).toBe('5 items');
    expect(all.firstStart).toBe('From 8:00 AM');
    expect(all.clashIds.sort()).toEqual(['af-p2', 'af-s1']);
    expect(all.monthDots).toBe(3); // the grid caps its dot run at 3
    expect(all.monthLabel).toContain('5 activities planned');
    expect(all.stripLabel).toContain('5 activities');
    expect(all.mapTotalAttr).toBe('5');
    expect(all.mapCountText).toBe('5 of 5 stops shown');
    expect(all.spanBandIds).toEqual(['af-p3']);

    // ── Filter to Sushil. He owns 2 of the 5, neither of them the earliest, and his clash
    // partner is Powan's — so EVERY number below has to move, in a different way each.
    await pickAuthor(page, OTHER);
    const mine = await chromeSnapshot(page, FIXTURE_DAY);

    expect(mine.rowIds).toEqual(['af-s1', 'af-s2']);
    expect(mine.glanceCount).toBe('2 items'); // 🔴 the headline defect: this read "5 items"
    expect(mine.firstStart).toBe('From 10:30 AM'); // moved off Powan's 8:00
    expect(mine.clashIds).toEqual([]); // the pair was cross-author
    expect(mine.monthDots).toBe(2);
    expect(mine.monthLabel).toContain('2 activities planned');
    expect(mine.stripLabel).toContain('2 activities');
    expect(mine.mapTotalAttr).toBe('2');
    expect(mine.mapCountText).toBe('2 of 2 stops shown');
    expect(mine.spanBandIds).toEqual([]); // the span is Powan's

    // D-142: filtering NARROWS, it never reorders. Sushil's two rows keep their stored
    // order relative to each other, which is also their order in the unfiltered list.
    expect(mine.rowIds).toEqual(all.rowIds.filter((id) => mine.rowIds.includes(id)));

    // ── Back to All: everything returns, in the same order it left.
    await plannerFilter(page).getByTestId('author-filter-all').click();
    await expect(plannerFilter(page).getByTestId('author-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await chromeSnapshot(page, FIXTURE_DAY)).toEqual(all);
  });

  test('a day the filtered person does not appear on empties completely, and the span band goes with them', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await selectDay(page, SPAN_DAY);

    // SPAN_DAY holds one Sushil item, and is COVERED (not owned) by Powan's span band.
    const all = await chromeSnapshot(page, SPAN_DAY);
    expect(all.rowIds).toEqual(['af-s3']);
    expect(all.spanBandIds).toEqual(['af-p3']);

    // Filter to ME: Sushil's item goes, and so does the day's only row — but Powan's span band
    // stays, because it IS his. A band is filtered by its own author, not by the day it covers.
    await pickMine(page);
    const asMe = await chromeSnapshot(page, SPAN_DAY);
    expect(asMe.rowIds).toEqual([]);
    expect(asMe.spanBandIds).toEqual(['af-p3']);
    expect(asMe.glanceCount).toBeNull(); // the pill hides at zero, same as an unplanned day
    expect(asMe.monthLabel).toContain('no activities planned');
    // The strip announces "no activities" at zero (its own copy, shorter than the month cell's).
    // Measured, not assumed — the first draft asserted the label simply omitted the word.
    expect(asMe.stripLabel).toContain('no activities');
    expect(asMe.monthDots).toBe(0);
  });

  test('the filtered-empty state still says "match this filter", NOT "no activities planned"', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await selectDay(page, SPAN_DAY);
    await pickMine(page);

    // 🔴 The regression this slice could most easily have caused. The empty-state branch is
    // decided by the day's UNFILTERED count; routing that through the filtered set collapses
    // both branches into "No activities planned for this day" — telling a traveller their day
    // is empty when it is not. Both strings are asserted so neither can drift into the other.
    const copy = (await chromeSnapshot(page, SPAN_DAY)).emptyStateCopy ?? '';
    expect(copy).toContain('No activities match this filter');
    expect(copy).not.toContain('No activities planned for this day');

    // ...and a genuinely unplanned day still gets the OTHER copy, under the same filter.
    await selectDay(page, '2026-12-11'); // not in the fixture at all
    const unplanned = (await chromeSnapshot(page, '2026-12-11')).emptyStateCopy ?? '';
    expect(unplanned).toContain('No activities planned for this day');
    expect(unplanned).not.toContain('No activities match this filter');
  });

  test('"Clear day" still counts the items the filter is HIDING (a destructive action must not lie)', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await selectDay(page, FIXTURE_DAY);
    await pickAuthor(page, OTHER); // 2 of 5 visible

    // The action stays OFFERED (a filtered-empty day still has stored items to clear)...
    await page.getByTestId('calendar-clear-day').click();
    // ...and its warning counts all FIVE, not the two on screen.
    await expect(page.getByTestId('calendar-clear-confirm')).toContainText('all 5 items');
    await page.getByTestId('calendar-clear-cancel').click();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. 🔴 NON-REGRESSION — with no filter selected, nothing moved
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Recorded by running this spec against the PRE-S383 build (`calendar-planner.tsx` and
 * `trip-timeline.tsx` at HEAD, with only the inert testid additions applied so the spec could
 * run at all). Do not "update" these to make a run go green — if they move, the no-filter path
 * changed, and that is the thing this slice promised not to do.
 */
const NO_FILTER_BASELINE = {
  rowIds: ['af-p1', 'af-p2', 'af-s1', 'af-s2', 'af-p3'],
  glanceCount: '5 items',
  firstStart: 'From 8:00 AM',
  clashIds: ['af-p2', 'af-s1'],
  // Note the day-strip's label format is SHORTER than the month cell's (no year) — recorded,
  // not guessed. Writing what looked right here produced a real failure on the pre-S383 run.
  stripLabel: 'Tuesday, December 15, 5 activities',
  monthDots: 3,
  monthLabel: 'Tuesday, December 15, 2026, 5 activities planned',
  mapTotalAttr: '5',
  mapCountText: '5 of 5 stops shown',
  spanBandIds: ['af-p3'],
  emptyStateCopy: null,
} satisfies ChromeSnapshot;

test.describe('S383 — NON-REGRESSION: no filter selected means nothing changed', () => {
  test('the whole chrome snapshot equals the pre-S383 recording, byte for byte', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await selectDay(page, FIXTURE_DAY);
    await openMap(page);

    // The filter defaults to "All" on every load (it is in-memory only, D-018) — assert that
    // rather than assume it, or this test silently becomes "some filter, some numbers".
    await expect(plannerFilter(page).getByTestId('author-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const snap = await chromeSnapshot(page, FIXTURE_DAY);
    // eslint-disable-next-line no-console
    console.log('S383 NO-FILTER SNAPSHOT:', JSON.stringify(snap));
    expect(snap).toEqual(NO_FILTER_BASELINE);
  });

  test('the SHIPPED itinerary renders /plan unchanged — and shows no filter control at all', async ({
    page,
  }) => {
    // No seeding: the real content pack. It carries ZERO attribution (measured in S383: 0
    // createdBy / 0 updatedBy / 0 doneBy across 158 items), so `distinctAuthors` is empty and
    // the control renders nothing. That makes a fresh install the strongest possible
    // non-regression case: the filter cannot even be selected, so every number on this page
    // must be exactly what it was before this slice.
    await gotoSettled(page, '/plan/');
    await selectDay(page, '2026-12-09');
    await expect(page.getByTestId('author-filter')).toHaveCount(0);

    const snap = await chromeSnapshot(page, '2026-12-09');
    // eslint-disable-next-line no-console
    console.log('S383 SHIPPED-SEED SNAPSHOT:', JSON.stringify(snap));
    // Recorded from the pre-S383 build by running this very test against it, same as
    // NO_FILTER_BASELINE above. The map fields are null because this test does not open the
    // map pane; the seeded case above covers those.
    expect(snap).toEqual({
      rowIds: ['n1-1', 'n1-2', 'n1-3'],
      glanceCount: '3 items',
      firstStart: 'From 5:30 AM',
      clashIds: [],
      stripLabel: 'Wednesday, December 9, 3 activities',
      monthDots: 3,
      monthLabel: 'Wednesday, December 9, 2026, 3 activities planned',
      mapTotalAttr: null,
      mapCountText: null,
      spanBandIds: [],
      emptyStateCopy: null,
    } satisfies ChromeSnapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. The duplicated control (the discoverability half)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe('S383 — the "Filter by" row renders once on /plan', () => {
  test('exactly one control, even with the timeline island scrolled into view', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);

    // 🔴 The scroll is load-bearing. `TripTimeline` is a `LazyVisible` island, so before S383 a
    // test that never scrolled counted ONE control and passed on the broken build. Mounting the
    // timeline is what makes this check able to fail.
    await page.locator('#timeline').scrollIntoViewIfNeeded();
    await page.locator('#timeline').getByRole('button', { name: /Day \d+/ }).first().waitFor();

    await expect(page.getByTestId('author-filter')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Filter itinerary items by author' })).toHaveCount(
      1,
    );
  });

  test('the surviving control still narrows the TIMELINE too (one selection, both surfaces)', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedTwoAuthorDays(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);

    // Deleting the timeline's own copy must not orphan it: the selection is a shared
    // module-level value, so the planner's control still drives it.
    await pickAuthor(page, OTHER);
    await page.locator('#timeline').scrollIntoViewIfNeeded();
    await page.locator('#timeline').getByRole('button', { name: /Day \d+, .*Dec 15/ }).click();

    const timelineIds = await page
      .locator('[data-testid^="timeline-item-af-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(timelineIds).toEqual(['timeline-item-af-s1', 'timeline-item-af-s2']);
  });
});
