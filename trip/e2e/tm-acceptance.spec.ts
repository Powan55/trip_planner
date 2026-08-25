import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S191 — Travel Mode acceptance net (TM-1,2,3,4,5,7,8,9,10,12), the evidence Phase 2's DoD rests on.
 *
 * SCOPING: this file runs ONLY on the two real-device-shaped projects `iphone-15-pro` (393×852)
 * and `iphone-15-pro-max` (430×932), both DPR 3 — see `playwright.config.ts` (chromium-engine
 * emulation of the iPhone descriptors; `testMatch` scopes these projects to this file, and the
 * chromium project `testIgnore`s it, so the default net's count is byte-stable). Because BOTH
 * projects use the same `testMatch`, every test below runs on BOTH viewports automatically — that
 * IS the "on both device viewports" requirement (TM-8's per-viewport DPR/overflow assertions read
 * the running project's own viewport). Do NOT add `test.use({ viewport })` here; it would clobber
 * the project viewport and collapse the two device shapes into one.
 *
 * Rides the shared `./fixtures` DEFAULT identity (a SIGNED-IN traveler) so `/travel` is reachable
 * past the front-door wall (D-241). The clock is driven by the D-075 `?today=` override (local NOON of
 * the day) exactly like the existing travel-* packs. Every assertion encodes a DECIDED behavior:
 * post-trip = no forced default (D-188), Back-without-exit leaves the flag active / exit replaces
 * with no history trap (D-194), the high-legibility attribute never leaks off /travel (D-192),
 * `?date=` bounded Dec 9–Jan 9 with an honest empty state (D-164/D-188).
 *
 * S192 adds the two deliberately-deferred items to THIS same file (still iPhone-scoped, so
 * chromium's spec set stays byte-stable — no config/glob change needed, D-195):
 *   - TM-6  (Dec 18/19 TZ-boundary): the D-188 place-offset reinterpretation, pinned two ways —
 *           (a) a deterministic override-noon boundary PAIR (Dec 18 = Kathmandu/NPT vs Dec 19 =
 *           Osaka/JST resolve to the right leg/day-number/essentials for the SAME clock+seed), and
 *           (b) an offset-SENSITIVE real-clock pair (`page.clock` + `timezoneId`, the D-185 idiom)
 *           where the hero/agenda PHASE flips if the per-day place offset regresses (NPT↔JST).
 *   - TM-11 (fully offline incl. reload): warm the SW, cut the network, prove /travel stays fully
 *           functional (hero, agenda, done-toggle → vault, hero-expand) THEN reload offline and
 *           prove it again incl. the persisted edit surviving; weather/currency tiles degrade to
 *           their designed states, no crash. HONEST LIMITATION found + reported (not faked): cross-
 *           day date navigation needs the network offline (Next static-export refetches the route's
 *           RSC `.txt` on `router.replace`) — see the in-test NOTE.
 *   - Per-state TM visual baselines (S192): new device-real screenshots of the designed TM hero
 *           states (pre / nepal / japan / post / empty-date / legibility-ON), one baseline per
 *           device project (the `-projectName` snapshot suffix), following visual.spec.ts's
 *           determinism conventions (frozen `?today=` clock, reduced motion, animations disabled,
 *           tolerant diff ratio) — but at the running project's real DPR-3 device viewport.
 *
 * WHY the two TM-6 flavours (the mechanic, so the assertions are honest): under a `?today=`
 * override "now" is re-interpreted as LOCAL NOON at the previewed day's place (lib/trip-now.ts
 * `getNowUtcMsForPlace`), so within one day the place offset CANCELS in the phase compare
 * (item and now share it) — the override path therefore proves the LEG/day/essentials selection
 * (offset SOURCE = `getCountryForDate(previewedDay)`), not a phase delta. To prove the offset
 * VALUE drives phase, flavour (b) drops the override and pins a real UTC instant with a fixed
 * `timezoneId`, so a wrong offset (NPT↔JST, 3h15m) visibly flips now/upcoming.
 */

const TRAVEL_KEY = 'nepal_japan_travel_mode';
const ITINERARY_KEY = 'nepal_japan_itinerary';

const PRE_TRIP = '2026-12-05';
const NEPAL_DAY = '2026-12-10';
const NEPAL_LAST = '2026-12-18'; // Kathmandu (last Nepal day)
const JAPAN_FIRST = '2026-12-19'; // Osaka (first Japan day)
const POST_TRIP = '2027-02-01';

type SeedItem = {
  id: string;
  title: string;
  category: string;
  startMinutes?: number;
  durationMinutes?: number;
  location?: string;
  done?: boolean;
};
type SeedDay = { date: string; city: string; country: 'nepal' | 'japan'; items: SeedItem[] };

/** Seed the itinerary vault before any app script runs (the S186/S187 idiom). */
async function seedDays(page: Page, days: SeedDay[]) {
  await page.addInitScript((data: SeedDay[]) => {
    window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify(data));
  }, days);
}

/** Navigate to a /travel URL and wait for the shell to be up. */
async function gotoTravel(page: Page, query = '') {
  await page.goto(`/travel/${query}`, { waitUntil: 'load' });
  await expect(page.getByTestId('travel-mode-root')).toBeVisible();
}

const navBtn = (page: Page) => page.getByTestId('navbar-travel-mode');
const root = (page: Page) => page.getByTestId('travel-mode-root');
const exitBtn = (page: Page) => page.getByTestId('travel-exit');

/** A fixture Nepal day (noon-relative phases: now / upcoming / untimed), reused across items. */
const AGENDA_FIXTURE: SeedItem[] = [
  { id: 'ta-now', title: 'Boudhanath walk', category: 'photography', startMinutes: 660, durationMinutes: 120 },
  { id: 'ta-next', title: 'Thamel lunch', category: 'food', startMinutes: 900, location: 'Thamel' },
  { id: 'ta-untimed', title: 'Souvenir hunt', category: 'sightseeing' },
];

// ── TM-1 — every enter state renders a DESIGNED state, never a blank ───────────────────────────
test.describe('TM-1 · designed states at pre / during(nepal+japan) / post trip', () => {
  test('pre-trip → Day-1 preview notice, no blank', async ({ page }) => {
    await gotoTravel(page, `?today=${PRE_TRIP}`);
    await expect(page.getByTestId('travel-pretrip-notice')).toBeVisible();
    await expect(page.getByTestId('day-strip-2026-12-09')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('travel-hero')).toBeVisible();
  });

  test('during, Nepal leg → hero names the Kathmandu day', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}&date=${NEPAL_LAST}`);
    await expect(page.locator('#travel-hero-title')).toContainText('Kathmandu');
  });

  test('during, Japan leg → hero names the Osaka day', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}&date=${JAPAN_FIRST}`);
    await expect(page.locator('#travel-hero-title')).toContainText('Osaka');
  });

  test('post-trip → the off-trip designed card (D-188: no forced default), not a blank', async ({ page }) => {
    await gotoTravel(page, `?today=${POST_TRIP}`);
    const hero = page.getByTestId('travel-hero');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveAttribute('data-phase', 'off-trip');
    await expect(page.getByTestId('travel-hero-offtrip')).toBeVisible();
  });
});

// ── TM-2 — exit restores the prior route with no history trap (the S190 model, on device) ──────
test.describe('TM-2 · exit restores the prior route, no history trap', () => {
  test('exit returns to the EXACT prior in-app route and restores chrome', async ({ page }) => {
    await page.goto('/nepal/', { waitUntil: 'load' });
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();

    await exitBtn(page).click();
    await page.waitForURL('**/nepal/**');
    await expect(page.getByTestId('navbar')).toBeVisible();
    const flag = await page.evaluate((k) => localStorage.getItem(k), TRAVEL_KEY);
    expect(flag).toBe('seen'); // exit downgrades 'active' → 'seen' (D-194)
  });

  test('after EXIT, browser Back does NOT bounce back into /travel (replace-on-exit, D-194)', async ({ page }) => {
    await page.goto('/nepal/', { waitUntil: 'load' });
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();
    await exitBtn(page).click();
    await page.waitForURL('**/nepal/**');

    await page.goBack();
    expect(page.url()).not.toContain('/travel');
  });
});

// ── TM-3 — TM flag + picked date survive a reload ──────────────────────────────────────────────
test.describe('TM-3 · travelMode flag + picked ?date survive reload', () => {
  test('enter → pick a day → reload: the chip stays selected and the flag stays active', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), TRAVEL_KEY)).toBe('active');

    // Pick a specific in-window day → ?date in the URL.
    await page.getByTestId('day-strip-2026-12-12').click();
    await expect(page).toHaveURL(/[?&]date=2026-12-12/);
    await expect(page.getByTestId('day-strip-2026-12-12')).toHaveAttribute('aria-pressed', 'true');

    await page.reload({ waitUntil: 'load' });
    await expect(root(page)).toBeVisible();
    await expect(page.getByTestId('day-strip-2026-12-12')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((k) => localStorage.getItem(k), TRAVEL_KEY)).toBe('active');
  });
});

// ── TM-4 — the agenda renders EXACTLY the seeded vault (count + per-row phase) ──────────────────
test.describe('TM-4 · agenda rows are exact against a seeded vault', () => {
  test('one row per seeded item, phases match the shared machine', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoTravel(page, `?today=${NEPAL_DAY}`);

    await expect(page.getByTestId('travel-agenda')).toBeVisible();
    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(3);
    await expect(page.getByTestId('travel-done-toggle-ta-now')).toHaveAttribute('data-row-phase', 'now');
    await expect(page.getByTestId('travel-done-toggle-ta-next')).toHaveAttribute('data-row-phase', 'upcoming');
    await expect(page.getByTestId('travel-done-toggle-ta-untimed')).toHaveAttribute('data-row-phase', 'untimed');
    // Exact titles, not just counts.
    await expect(page.getByTestId('travel-agenda')).toContainText('Boudhanath walk');
    await expect(page.getByTestId('travel-agenda')).toContainText('Souvenir hunt');
  });
});

// ── TM-5 — the date picker is bounded Dec 9 – Jan 9; out-of-range → the designed empty state ────
test.describe('TM-5 · date picker bounded Dec 9 – Jan 9 with an empty state', () => {
  test('the strip spans exactly the trip window; endpoints exist, neighbours do not', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await expect(page.getByTestId('day-strip-2026-12-09')).toBeVisible(); // first day
    await expect(page.getByTestId('day-strip-2027-01-09')).toHaveCount(1); // last day (may be off-screen in the scroller)
    await expect(page.getByTestId('day-strip-2026-12-08')).toHaveCount(0); // day before the trip
    await expect(page.getByTestId('day-strip-2027-01-10')).toHaveCount(0); // day after the trip
  });

  test('a well-formed but out-of-window ?date → the "not a trip day" empty state + one-tap return', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}&date=2099-01-01`);
    await expect(page.getByTestId('travel-date-empty')).toBeVisible();
    await expect(page.getByTestId('travel-hero')).toHaveCount(0);
    await page.getByTestId('travel-date-empty-return').click();
    await expect(page).not.toHaveURL(/date=/);
    await expect(page.getByTestId('travel-hero')).toBeVisible();
  });
});

// ── TM-7 — a TM edit persists to the vault and is visible on /plan after navigation ────────────
test.describe('TM-7 · a TM done-toggle persists to the vault and reflects on /plan', () => {
  test('toggle done in TM → localStorage updated → the same item shows on /plan', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoTravel(page, `?today=${NEPAL_DAY}`);

    const toggle = page.getByTestId('travel-done-toggle-ta-next');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Persisted to the vault as done:true.
    const doneOnDisk = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const days = Array.isArray(parsed) ? parsed : parsed.payload;
      const item = days
        .flatMap((d: { items: { id: string; done?: boolean }[] }) => d.items)
        .find((i: { id: string }) => i.id === 'ta-next');
      return item ? item.done === true : null;
    }, ITINERARY_KEY);
    expect(doneOnDisk).toBe(true);

    // /plan reads the SAME vault (D-018 one source of truth): under the same in-trip clock it
    // defaults to NEPAL_DAY and renders that day's items — the toggled item is present there.
    await page.goto(`/plan/?today=${NEPAL_DAY}`, { waitUntil: 'load' });
    await expect(page.getByTestId('calendar-item-ta-next')).toBeVisible();
  });
});

// ── TM-8 — DPR 3, no horizontal overflow on any TM state, safe-area padding present ────────────
test.describe('TM-8 · DPR 3, no horizontal overflow, safe-area padding', () => {
  test('the running project is DPR 3 at its device width', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(dpr).toBe(3);
    const width = page.viewportSize()!.width;
    expect([393, 430]).toContain(width);
  });

  test('no horizontal overflow across pre/nepal/japan/post + preview banner + legibility-on + hero expanded', async ({ page }) => {
    await seedDays(page, [
      { date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE },
      { date: '2026-12-12', city: 'Kathmandu', country: 'nepal', items: [] },
    ]);

    const noOverflow = async (label: string) => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${label}: scrollWidth-innerWidth`).toBeLessThanOrEqual(0);
    };

    await gotoTravel(page, `?today=${PRE_TRIP}`);
    await noOverflow('pre-trip');

    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await noOverflow('nepal');

    await gotoTravel(page, `?today=${NEPAL_DAY}&date=${JAPAN_FIRST}`);
    await noOverflow('japan');

    await gotoTravel(page, `?today=${POST_TRIP}`);
    await noOverflow('post-trip');

    // Preview banner open (a non-today in-window ?date).
    await gotoTravel(page, `?today=${NEPAL_DAY}&date=2026-12-12`);
    await expect(page.getByTestId('travel-preview-banner')).toBeVisible();
    await noOverflow('preview banner');

    // High-legibility ON (the retuned tokens + root type bump — the widest-content state).
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await noOverflow('legibility on');

    // Essentials expanded (S317: opening the collapsed <details> — the widest inner content now).
    await page.getByTestId('travel-essentials').evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await expect(page.getByTestId('travel-essentials-safety')).toBeVisible();
    await noOverflow('essentials expanded');
  });

  test('the arrival toast (a TM overlay) does not overflow either', async ({ page }) => {
    await page.goto(`/?today=${NEPAL_DAY}`, { waitUntil: 'load' });
    await expect(page.getByTestId('travel-arrival-toast')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, 'arrival-toast: scrollWidth-innerWidth').toBeLessThanOrEqual(0);
  });

  test('the TM root carries the S184 safe-area padding contract', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    const pad = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-testid="travel-mode-root"]')!);
      return { top: parseFloat(cs.paddingTop), left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
    });
    // max(20px, env(inset-top)) and max(1rem, env(inset-left/right)) floors — env resolves to 0 in
    // emulation, so the hardcoded floors are what render: ≥20px top, ≥16px sides.
    expect(pad.top).toBeGreaterThanOrEqual(20);
    expect(pad.left).toBeGreaterThanOrEqual(16);
    expect(pad.right).toBeGreaterThanOrEqual(16);
  });
});

// ── TM-9 — zero chrome leakage (DOM absence + a focus walk that never reaches chrome) ──────────
test.describe('TM-9 · zero chrome leakage', () => {
  test('navbar / footer / tab-bar / FAB are absent from /travel', async ({ page }) => {
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await expect(page.getByTestId('navbar')).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    await expect(page.getByTestId('quick-add-fab')).toHaveCount(0);
    // The command palette (D-182: intentionally still MOUNTED) exposes no open dialog on load.
    await expect(page.getByTestId('command-palette-dialog')).toHaveCount(0);
  });

  test('a Tab walk stays inside the TM root — no focus ever lands on app chrome', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const insideRoot = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return true; // nothing focused / body is fine
        return !!el.closest('[data-testid="travel-mode-root"]');
      });
      expect(insideRoot, `focus step ${i} landed outside the TM root (chrome leak)`).toBe(true);
    }
  });
});

// ── TM-10 — every interactive target on /travel clears 44×44 ───────────────────────────────────
test.describe('TM-10 · interactive targets are ≥44×44', () => {
  test('toggle, exit X, every day-strip chip, every agenda control clear the 44px floor', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await expect(page.getByTestId('travel-agenda')).toBeVisible();

    const testids = [
      'travel-legibility-toggle',
      'travel-exit',
      'day-strip-2026-12-09',
      'day-strip-2026-12-10',
      'travel-done-toggle-ta-now',
      'travel-done-toggle-ta-next',
      'travel-done-toggle-ta-untimed',
    ];
    for (const id of testids) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} has a layout box`).not.toBeNull();
      expect(box!.width, `${id} width ≥ 44`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${id} height ≥ 44`).toBeGreaterThanOrEqual(44);
    }
  });
});

// ── TM-12 — axe serious/critical = 0 in both legibility states + reduced-motion neutralizes ────
test.describe('TM-12 · axe clean in both legibility states + reduced motion', () => {
  test('zero serious/critical OFF then ON', async ({ page }, testInfo) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoTravel(page, `?today=${NEPAL_DAY}`);

    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of results.violations) {
        testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `${label} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})` });
      }
      expect(blocking, `${label}: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`).toEqual([]);
    };

    await scan('legibility OFF');
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await scan('legibility ON');
  });

  test('reduced motion renders the spring-free hero branch (D-007/D-185)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await expect(page.getByTestId('travel-hero-flip')).toHaveAttribute('data-flip-animated', 'false');
  });
});

// ── TM-6 — Dec 18/19 TZ-boundary day pinned (D-188 place-offset reinterpretation) ──────────────
//
// The trip crosses the NPT→JST boundary between Dec 18 (Kathmandu, UTC+5:45) and Dec 19 (Osaka,
// UTC+9). D-188: a previewed/lived day resolves its country/city/day-number AND its "now" place
// offset from the DAY ITSELF (`getCountryForDate(date)`), never today's country — the fix for the
// latent S185/S186 seam bug. This describe pins that boundary from both angles (see the file
// header). The seed spans both boundary days with the SAME item shape so any leg/offset regression
// shows as a diverging assertion between the two sides.
const BOUNDARY_SEED: SeedDay[] = [
  // Dec 18 — last Nepal day (Kathmandu). Noon-relative phases under the override-noon clock:
  // 11:00–13:00 = now, 15:00 = upcoming, untimed.
  { date: NEPAL_LAST, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE },
  // Dec 19 — first Japan day (Osaka). Same three-item shape, distinct ids.
  {
    date: JAPAN_FIRST,
    city: 'Osaka',
    country: 'japan',
    items: [
      { id: 'jp-now', title: 'Dotonbori stroll', category: 'sightseeing', startMinutes: 660, durationMinutes: 120 },
      { id: 'jp-next', title: 'Kuromon Market', category: 'food', startMinutes: 900, location: 'Kuromon' },
      { id: 'jp-untimed', title: 'Find a konbini', category: 'sightseeing' },
    ],
  },
];

test.describe('TM-6 · Dec 18/19 TZ-boundary — leg/day/essentials resolve to the previewed day (D-188)', () => {
  // (a) Deterministic override-noon PAIR. Same `?today=` clock + same seed; only the previewed
  // `?date=` differs across the boundary. Proves the offset/leg SOURCE is the previewed day.
  test('Dec 18 previews the Kathmandu (Nepal) leg — day 10, Nepal essentials', async ({ page }) => {
    await seedDays(page, BOUNDARY_SEED);
    await gotoTravel(page, `?today=${NEPAL_DAY}&date=${NEPAL_LAST}`);

    // Hero header derives from the PREVIEWED day (Dec 18 = Kathmandu, trip day 10).
    await expect(page.locator('#travel-hero-title')).toContainText('Kathmandu');
    await expect(page.locator('#travel-hero-title')).toContainText('Day 10');
    // Agenda phases are derived at the Dec 18 (NPT) place — noon-relative: now / upcoming / untimed.
    await expect(page.getByTestId('travel-done-toggle-ta-now')).toHaveAttribute('data-row-phase', 'now');
    await expect(page.getByTestId('travel-done-toggle-ta-next')).toHaveAttribute('data-row-phase', 'upcoming');
    // Essentials context is the Nepal leg (synchronous, network-free copy).
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    await expect(page.getByTestId('travel-essentials-safety')).toContainText('Emergency — Nepal');
    await expect(page.getByTestId('travel-essentials-weather')).toContainText('Weather — Kathmandu');
  });

  test('Dec 19 previews the Osaka (Japan) leg — day 11, Japan essentials (SAME clock+seed)', async ({ page }) => {
    await seedDays(page, BOUNDARY_SEED);
    await gotoTravel(page, `?today=${NEPAL_DAY}&date=${JAPAN_FIRST}`);

    // The SAME `?today=${NEPAL_DAY}` instant now resolves to the OTHER leg because the previewed
    // day flipped across the boundary (D-188): Dec 19 = Osaka, trip day 11.
    await expect(page.locator('#travel-hero-title')).toContainText('Osaka');
    await expect(page.locator('#travel-hero-title')).toContainText('Day 11');
    await expect(page.getByTestId('travel-done-toggle-jp-now')).toHaveAttribute('data-row-phase', 'now');
    await expect(page.getByTestId('travel-done-toggle-jp-next')).toHaveAttribute('data-row-phase', 'upcoming');
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    await expect(page.getByTestId('travel-essentials-safety')).toContainText('Emergency — Japan');
    await expect(page.getByTestId('travel-essentials-weather')).toContainText('Weather — Osaka');
  });

  // (b) Offset-SENSITIVE real-clock pair. No `?today=` override → "now" is the real (faked) UTC
  // instant, so the place offset does NOT cancel: a wrong offset shifts the item's instant by
  // 3h15m (NPT 345 vs JST 540) and FLIPS the phase. Each side pins one real instant on its own day
  // and asserts the phase the CORRECT offset produces — the assertion fails if the offset regresses.
  test.describe('TM-6b · the boundary day\'s OWN place offset drives the phase (regression catcher)', () => {
    test.use({ timezoneId: 'Asia/Kathmandu' });

    test('Dec 18 @ 04:30Z → NPT makes the noon item UPCOMING (JST would make it NOW)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); // fake clock + spring-free branch (D-185)
      // 04:30Z Dec 18 = 10:15 NPT (before the 12:00 item). The noon item's NPT instant is 06:15Z
      // (still ahead) → upcoming. Under a wrong JST offset it would be 03:00Z (behind) → now.
      await page.clock.install({ time: new Date('2026-12-18T04:30:00Z') });
      await seedDays(page, [
        { date: NEPAL_LAST, city: 'Kathmandu', country: 'nepal', items: [
          { id: 'npt-noon', title: 'Swayambhunath climb', category: 'sightseeing', startMinutes: 720 },
        ] },
      ]);
      await gotoTravel(page); // lived Dec 18 — no ?today/?date

      await expect(page.locator('#travel-hero-title')).toContainText('Kathmandu');
      await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'upcoming');
      await expect(page.getByTestId('travel-done-toggle-npt-noon')).toHaveAttribute('data-row-phase', 'upcoming');
    });
  });

  test.describe('TM-6b · Osaka side', () => {
    test.use({ timezoneId: 'Asia/Tokyo' });

    test('Dec 19 @ 04:30Z → JST makes the noon item NOW (NPT would make it UPCOMING)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // 04:30Z Dec 19 = 13:30 JST. The noon item's JST window is [03:00Z, 05:00Z) (noon +120 cap)
      // → 04:30Z is inside → now. Under a wrong NPT offset the window starts 06:15Z → upcoming.
      await page.clock.install({ time: new Date('2026-12-19T04:30:00Z') });
      await seedDays(page, [
        { date: JAPAN_FIRST, city: 'Osaka', country: 'japan', items: [
          { id: 'jst-noon', title: 'Osaka Castle', category: 'sightseeing', startMinutes: 720 },
        ] },
      ]);
      await gotoTravel(page); // lived Dec 19

      await expect(page.locator('#travel-hero-title')).toContainText('Osaka');
      await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'now');
      await expect(page.getByTestId('travel-done-toggle-jst-noon')).toHaveAttribute('data-row-phase', 'now');
    });
  });
});

// ── TM-11 — fully offline including reload (SW active) ─────────────────────────────────────────
//
// Warm the hand-rolled SW (D-073, precaches /travel/ per D-170), cut the network, and prove /travel
// stays fully functional — then RELOAD while still offline and prove it again. The vault (localStorage,
// D-018) is inherently offline-durable; this asserts the whole route (shell + hero + agenda + date
// pick + done-toggle) survives a cold offline reload with no crash. Weather/currency tiles degrade to
// their designed loading/cached/unavailable states (their fetches fail gracefully — the browser logs
// a network-level "failed to load resource" for the dead request, which is expected offline and NOT an
// app error; we assert no uncaught pageerror and no APP console.error, filtering only that network noise).
test.describe('TM-11 · fully offline incl. reload', () => {
  /** Poll until the SW is activated AND controlling (rides through the D-073 first-load reload). */
  async function waitForControllingSW(page: Page) {
    await page.waitForFunction(
      () => 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null,
      null,
      { timeout: 25_000 },
    );
  }

  test('enter → offline → still functional → reload offline → still functional', async ({ page, context }) => {
    // Only browser-level network-load failures are tolerated offline; a real app error still fails.
    const appErrors: string[] = [];
    const NET_NOISE = /failed to load resource|net::ERR|ERR_INTERNET_DISCONNECTED|fetch/i;
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !NET_NOISE.test(msg.text())) appErrors.push(msg.text());
    });
    page.on('pageerror', (err) => appErrors.push(`pageerror: ${String(err)}`));
    // Reduced motion so the day-strip's auto-centre is an instant jump (behavior:'auto') — no
    // smooth-scroll animation to fight chip actionability, and the spring-free hero branch (D-185).
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // GUARDED seed: only write the vault when it is ABSENT. `addInitScript` re-runs on every
    // navigation incl. the reload — an unconditional seed would clobber the offline edit and mask
    // exactly what TM-11 must prove. Guarding it means the first load seeds, the toggle writes the
    // vault envelope, and the reload's init-script no-ops, so the offline edit genuinely survives.
    await page.addInitScript((day: SeedDay) => {
      const KEY = 'nepal_japan_itinerary';
      if (!window.localStorage.getItem(KEY)) window.localStorage.setItem(KEY, JSON.stringify([day]));
    }, { date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE } satisfies SeedDay);

    // 1) Warm online: SW installs, activates, precaches the /travel shell.
    await gotoTravel(page, `?today=${NEPAL_DAY}`);
    await waitForControllingSW(page);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const pre = names.find((n) => n.startsWith('trip-precache-'));
          if (!pre) return 0;
          return (await caches.open(pre)).keys().then((k) => k.length);
        }),
      )
      .toBeGreaterThan(20);

    // 2) Cut the network entirely.
    await context.setOffline(true);

    // 3) Offline, no reload yet: the route is fully interactive — hero + full agenda.
    await expect(page.getByTestId('travel-hero')).toBeVisible();
    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(3);
    // A TM edit persists to the vault offline (the client-side hard guarantee).
    const toggle = page.getByTestId('travel-done-toggle-ta-next');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const doneOffline = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const days = Array.isArray(parsed) ? parsed : parsed.payload; // bare seed OR the vault envelope
      return days.flatMap((d: { items: { id: string; done?: boolean }[] }) => d.items).find((i: { id: string }) => i.id === 'ta-next')?.done === true;
    }, ITINERARY_KEY);
    expect(doneOffline).toBe(true);

    // 4) COLD RELOAD while still offline — the SW serves the precached shell; the vault rehydrates.
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('travel-mode-root')).toBeVisible();
    await expect(page.getByTestId('travel-hero')).toBeVisible();
    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(3);
    // The done-toggle written offline survived the offline reload.
    await expect(page.getByTestId('travel-done-toggle-ta-next')).toHaveAttribute('aria-pressed', 'true');
    // Essentials still renders its designed (collapsed, S317) shell offline (no crash).
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    // The current day stays fully interactive offline — the now/next strip renders without network.
    await expect(page.getByTestId('travel-hero-flip')).toBeVisible();

    // 5) Cross-day date picking works OFFLINE (S192 real-defect fix in travel-date-picker.tsx:
    //    `router.replace` fetched the route's RSC payload on every same-page `?date=` change —
    //    offline that failed and Next hard-navigated to the SW nav-fallback. Now a same-document
    //    `history.replaceState`, network-free). Pick an unseeded day → empty state; pick back →
    //    the agenda returns, still on /travel, no navigation.
    await page.getByTestId('day-strip-2026-12-12').click();
    await expect(page).toHaveURL(/[?&]date=2026-12-12/);
    await expect(page.getByTestId('travel-mode-root')).toBeVisible();
    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(0);
    await page.getByTestId(`day-strip-${NEPAL_DAY}`).click();
    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(3);
    await expect(page.getByTestId('travel-done-toggle-ta-next')).toHaveAttribute('aria-pressed', 'true');

    await context.setOffline(false); // teardown hygiene
    expect(appErrors, `app errors offline: ${appErrors.join(' | ')}`).toEqual([]);
  });
});

// ── Per-state TM visual baselines (S192) ──────────────────────────────────────────────────────
//
// Device-real screenshots of the designed TM hero states, one baseline per device project (the
// `-projectName` snapshot suffix distinguishes 393×852 from 430×932). Determinism follows
// visual.spec.ts: a frozen `?today=` clock (no ticking), reduced motion (no mid-flight springs),
// `animations:'disabled'`, and no diff budget — every pixel must match (#135). We shoot the `travel-hero` element
// only — it is fully deterministic under the frozen clock + seeded vault and contains NO network
// tile (weather/currency live in the separate essentials card below), so no masking is needed.
const TM_SHOT = { animations: 'disabled', scale: 'css' } as const;

test.describe('TM visual · per-state hero baselines (device-real)', { tag: '@visual' }, () => {
  /** Frozen-clock + reduced-motion nav that settles past the D-073 first-load SW reload and fonts. */
  async function gotoHeroShot(page: Page, query: string) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/travel/${query}`, { waitUntil: 'load' });
    await page
      .waitForFunction(() => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null, null, { timeout: 15_000 })
      .catch(() => {});
    await expect(page.getByTestId('travel-hero')).toBeVisible();
    await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready).catch(() => {});
  }

  test('pre-trip (Day-1 preview)', async ({ page }) => {
    await gotoHeroShot(page, `?today=${PRE_TRIP}`);
    await expect(page.getByTestId('travel-hero')).toHaveScreenshot('tm-hero-pretrip.png', TM_SHOT);
  });

  test('in-trip nepal (now phase)', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoHeroShot(page, `?today=${NEPAL_DAY}`);
    await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'now');
    await expect(page.getByTestId('travel-hero')).toHaveScreenshot('tm-hero-nepal.png', TM_SHOT);
  });

  test('in-trip japan (Osaka, now phase)', async ({ page }) => {
    await seedDays(page, [{ date: JAPAN_FIRST, city: 'Osaka', country: 'japan', items: AGENDA_FIXTURE }]);
    await gotoHeroShot(page, `?today=${JAPAN_FIRST}`);
    await expect(page.locator('#travel-hero-title')).toContainText('Osaka');
    await expect(page.getByTestId('travel-hero')).toHaveScreenshot('tm-hero-japan.png', TM_SHOT);
  });

  test('post-trip (off-trip card)', async ({ page }) => {
    await gotoHeroShot(page, `?today=${POST_TRIP}`);
    await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'off-trip');
    await expect(page.getByTestId('travel-hero')).toHaveScreenshot('tm-hero-posttrip.png', TM_SHOT);
  });

  test('empty-date (trip day, nothing planned)', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: [] }]);
    await gotoHeroShot(page, `?today=${NEPAL_DAY}`);
    await expect(page.getByTestId('travel-hero-empty')).toBeVisible();
    await expect(page.getByTestId('travel-hero')).toHaveScreenshot('tm-hero-empty.png', TM_SHOT);
  });

  test('legibility-ON (outdoor high-legibility, D-192)', async ({ page }) => {
    await seedDays(page, [{ date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: AGENDA_FIXTURE }]);
    await gotoHeroShot(page, `?today=${NEPAL_DAY}`);
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('travel-hero')).toHaveScreenshot('tm-hero-legibility.png', TM_SHOT);
  });
});
