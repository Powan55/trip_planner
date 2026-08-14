import { test, expect, assertConciergeWired } from './fixtures';
import type { Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S350 — the FIRST browser coverage the concierge chat has ever had. Requires
 * `NEXT_PUBLIC_CONCIERGE_URL` baked into the build under test (added to the CI test-job env by this
 * same slice — see `.github/workflows/ci.yml` / `deploy.yml`); locally, build with it set:
 *   NEXT_PUBLIC_CONCIERGE_URL=https://concierge.test npm run build
 * Without it, `isConciergeConfigured()` is false and `ConciergeChat` renders null everywhere — every
 * test below would fail on the very first `concierge-trigger` lookup.
 *
 * ROUTE PATTERN NOTE — deliberately NOT `page.route('**\/chat', ...)`: `hooks/use-concierge-chat.ts`
 * posts directly to `CONCIERGE_URL` with no path suffix (unlike `lib/place-resolve.ts`, which
 * correctly treats it as a bare origin and appends `/resolve`). So the dummy env value here is a
 * BARE origin (`https://concierge.test`, matching the `/resolve` convention and real production
 * shape) and the stub below matches that bare origin exactly — a `**\/chat` glob would never see
 * this request. This client/server path mismatch is tracked separately (S350); it is a
 * pre-existing gap, not something this slice's file scope covers.
 *
 * SERVICE WORKERS ARE BLOCKED: the concierge
 * origin is cross-origin from the served app, and blocking removes any chance of a stale-while-
 * revalidate race silently answering instead of this file's stub.
 */

test.use({ serviceWorkers: 'block' });

const CHAT_ORIGIN = /^https:\/\/concierge\.test\/?$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
};

const REPLY_TEXT =
  "Here are a few highlights:\n- **Boudhanath Stupa** -- sunrise views\n- **Pashupatinath Temple** -- riverside rituals\n- **Swayambhunath** -- monkey temple hike";

// A real trip date (2026-12-09 is TRIP_DATES[0], core/trips/packs/nepal-japan-2026.ts) and a real
// category, so `validateOps` accepts this op and the confirm/dismiss chip actually renders.
const OPS = [{ type: 'addItem', date: '2026-12-09', title: 'Ramen night', category: 'food' }];

/**
 * Stub the chat call: answer the CORS preflight, then fulfil the POST with a canned reply.
 * Also RECORDS the request body — S362 asserts on the `context` digest the client actually put on
 * the wire, which is text only the WIRED path can produce (with NEXT_PUBLIC_CONCIERGE_URL unset the
 * concierge short-circuits before any fetch, so this route never fires and the assertion goes RED
 * instead of passing vacuously on a misconfigured run).
 *
 * `model` (S363) is OMITTED from the body by default — that is the real shape the deployed v1.4.0
 * Worker sends today (R3), and every pre-existing test in this file already exercises that shape
 * without knowing it. Pass a value to simulate a model-stamping Worker (S363B+).
 */
async function stubChat(page: Page, model?: string) {
  const hits: { count: number; body: { message?: string; history?: unknown[]; context?: string } } = {
    count: 0,
    body: {},
  };
  await page.route(CHAT_ORIGIN, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    hits.count += 1;
    hits.body = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ reply: REPLY_TEXT, ops: OPS, ...(model ? { model } : {}) }),
    });
  });
  return hits;
}

/**
 * The FAILING counterpart of `stubChat` (S395, open item A). Same bare-origin route, same CORS
 * preflight answer — only the POST leg changes, to the Worker's own both-legs-dead shape
 * (`worker/src/providers.ts` `fetchChatCompletion`: 502 + `{error}`).
 *
 * 🔴 The hook NO LONGER lifts that `error` string into the row (issue #13): the response body is
 * not read at all, and the row shows our own status-class sentence. The stub still sends the
 * Worker's real body precisely so the test can assert that it does NOT appear on screen.
 *
 * 🔴 NOT `context.setOffline(true)`: `hooks/use-concierge-chat.ts` short-circuits on `!online`
 * BEFORE any fetch, so an offline test never reaches a route stub at all — and the error row it
 * produces is a different code path with different text. Inducing the error through the network
 * stub is what makes this test about the row the Worker can actually cause.
 */
const SERVER_ERROR_TEXT = 'concierge temporarily unavailable';

async function stubChatFailure(page: Page) {
  await page.route(CHAT_ORIGIN, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    await route.fulfill({
      status: 502,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ error: SERVER_ERROR_TEXT }),
    });
  });
}

/**
 * One axe pass, filtered to serious/critical, annotated onto the test. Named + label-taking so a
 * single test can scan more than one STATE and attribute a finding to the right one — the
 * `e2e/share-inbox.spec.ts` shape.
 */
async function runAxe(page: Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page }).analyze();
  // Always printed, even at zero: "0 violations" is only meaningful next to evidence that the rules
  // ran against real nodes. `passes` is a rule-level count of what actually EVALUATED — on the
  // error scan it visibly picks the row up (`aria-roles` and `color-contrast` each gain a node vs
  // the healthy control, and `button-name` covers the retry control).
  console.log(
    `  axe ${label}: ${results.violations.length} violation(s), ${results.passes.length} rules passed, ${results.incomplete.length} incomplete`,
  );
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of results.violations) {
    const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
    console.log(`  axe ${label} ${line}`);
  }
  expect(
    blocking,
    `serious/critical a11y violations on ${label}: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
  ).toEqual([]);
}

test.describe('S350 · concierge panel — starter chips, list rendering, ops chip', () => {
  test('opens with three real starter-chip buttons, and each is a proper 44px keyboard target', async ({
    page,
  }) => {
    await stubChat(page);
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page); // R5 — instant, named failure instead of a 30s timeout below
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();

    const chips = page.getByTestId('concierge-starter-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText("What's the plan for tomorrow?");

    // Real <button>s, not divs with a click handler.
    for (const tag of await chips.evaluateAll((els) => els.map((el) => el.tagName))) {
      expect(tag).toBe('BUTTON');
    }
    // 44px target floor.
    const box = await chips.first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Keyboard-reachable: focus it directly (a real <button> is natively tabbable) and confirm it
    // actually took focus — this is what makes Tab navigation and :focus-visible possible at all.
    await chips.first().focus();
    await expect(chips.first()).toBeFocused();
  });

  test('a 3-bullet reply renders as a real <ul>, and the proposed change becomes a confirmable chip', async ({
    page,
  }) => {
    const hits = await stubChat(page);
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page); // R5 — instant, named failure instead of a 30s timeout below
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();

    // Clicking a starter chip sends it immediately (no need to type it into the input).
    await page.getByTestId('concierge-starter-chip').first().click();
    await expect.poll(() => hits.count).toBeGreaterThan(0);

    // S362 — the digest on the wire really carries the enriched per-item encoding the model is
    // asked to parse. Asserted from a REAL browser POST body, not a unit mock.
    // #12 moved that encoding 24-hour → 12-hour, and this pin moves with it. The Worker's own
    // PLAN_LINES constant still says "HH:MM" and is now stale; the digest carries its own legend
    // directly above the data, which is what the model reads. Deliberate — see the comment on the
    // legend in hooks/use-concierge-chat.ts. The correctness half is unaffected either way: ops
    // carry integer `startMinutes`, never a display string, and `validateOps` enforces that.
    const context = hits.body.context ?? '';
    expect(context).toContain('Each item is "h:mm AM/PM category Title #id".');
    expect(context).toContain('Any date not listed below is unplanned.');
    // A real seed item, timed + categorised: `time: '05:30'` with no `startMinutes` on the day the
    // trip starts. Proves the legacy-time fallback survives the production bundle, not just jsdom.
    // S393 (Q4): the Dec-9 day line now names Syracuse, the city the day is actually spent in.
    // #12: the SEED is still 24-hour ('05:30') — it is the DIGEST that renders 12-hour, so this
    // pin is what proves the conversion happens on the way out rather than in the fixture.
    expect(context).toContain('2026-12-09 Syracuse: 5:30 AM transportation Depart Syracuse');
    // Untimed items get NO token, never a fake midnight. #12 moved what a fake midnight looks
    // like: `formatTimeAmPm(0)` is '12:00 AM', so guarding '00:00 ' would no longer guard anything.
    expect(context).not.toContain('12:00 AM ');
    expect(context.length).toBeLessThanOrEqual(9500); // DIGEST_CAP

    const assistantTurn = page.getByTestId('concierge-turn-assistant').last();
    await expect(assistantTurn).toBeVisible();
    const list = assistantTurn.locator('ul');
    await expect(list).toHaveCount(1);
    await expect(list.locator('li')).toHaveCount(3);
    await expect(list.locator('li').first()).toContainText('Boudhanath Stupa');
    // The old renderer's literal typed bullet glyph must be gone.
    await expect(assistantTurn).not.toContainText('•');

    // The starter chips are gone now that a turn exists (messages.length !== 0).
    await expect(page.getByTestId('concierge-starter-chip')).toHaveCount(0);

    // The ops chip: one proposed change, confirmable.
    const opChip = page.getByTestId('concierge-op-chip');
    await expect(opChip).toBeVisible();
    await expect(opChip).toContainText('Ramen night');
    await expect(page.getByTestId('concierge-op-confirm')).toBeVisible();
    await expect(page.getByTestId('concierge-op-dismiss')).toBeVisible();
  });

  test('axe scan of the open panel — zero serious/critical violations', async ({ page }, testInfo) => {
    await stubChat(page);
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page); // R5 — instant, named failure instead of a 30s timeout below
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();
    // Scan with the starter chips + input in view (the panel's steady empty state).
    await expect(page.getByTestId('concierge-starter-chip')).toHaveCount(3);

    await runAxe(page, 'concierge-panel empty', testInfo);
  });
});

test.describe('S363 · model visibility (R1-R4) + the disclosure copy (R6)', () => {
  test('the panel description discloses a third-party AI, never search, and scopes the storage claim to "here"', async ({
    page,
  }) => {
    // No stubChat — the description is static header chrome, rendered on open with no turn sent.
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page);
    await page.getByTestId('concierge-trigger').click();
    const panel = page.getByTestId('concierge-panel');
    await expect(panel).toBeVisible();

    // S395 (owner ruling Q5) REPLACES the old "AI and search services" assertion. Its comment used
    // to justify "and search" as load-bearing because the search leg was "built + merged, gated
    // only on a runtime secret" — that rationale DIED WITH THE LEG: S392 deleted the leg's code,
    // key binding and wrangler entry outright (D-275), so re-arming it now needs a code change and
    // the disclosure would be describing a capability the Worker no longer has.
    await expect(panel).toContainText('a third-party AI provider');
    // The plural went too, and for a second independent reason: the ladder is ONE provider
    // (two of its models — worker/src/providers.ts GROQ_MODELS), so "services" was its own
    // small untruth once the search vendor was gone.
    await expect(panel).not.toContainText('services');
    // ⚖️ The assertion that makes the reword mean something. If the word ever comes back to this
    // panel — copy, placeholder, a new feature — this goes red and someone re-reads the ruling.
    await expect(panel).not.toContainText('search');
    // "here" — the actual repair to the old sentence, scoping the storage claim to this panel
    // rather than reading as a claim about the whole data path. Unchanged and still load-bearing.
    await expect(panel).toContainText('stored here');
    // S355 retired "User Token" → "your key" and shipped this exact guard pack-wide; this copy is
    // about AI providers and should come nowhere near the term (model-visibility rule R5).
    await expect(panel).not.toContainText('User Token');
  });

  test('S395 — the privacy label sits at the input and is announced as its description', async ({
    page,
  }) => {
    // At the phone breakpoint, where a new line under the input is most likely to overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page);
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();

    const note = page.getByTestId('concierge-privacy-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('Sent to a third-party AI — nothing stored here.');

    // ⚖️ THE POINT OF THIS TEST. The header disclosure is a Radix `SheetDescription`, wired by
    // Radix to the DIALOG via aria-describedby; a second paragraph inherits NOTHING from that. So
    // the label must carry its own association, and the id it points at must actually resolve —
    // a dangling aria-describedby degrades SILENTLY to no description at all.
    const describedBy = await page.getByTestId('concierge-input').getAttribute('aria-describedby');
    expect(describedBy).toBe('concierge-privacy-note');
    await expect(page.locator(`#${describedBy}`)).toHaveCount(1);
    await expect(page.locator(`#${describedBy}`)).toHaveText('Sent to a third-party AI — nothing stored here.');

    // No horizontal overflow at 390px — the label wraps inside the panel instead of widening it.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="concierge-panel"]') as HTMLElement;
      return { scroll: el.scrollWidth, client: el.clientWidth, doc: document.documentElement.scrollWidth };
    });
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    expect(overflow.doc).toBeLessThanOrEqual(390);
  });

  test('R3 — a reply with no `model` renders no badge and does not throw', async ({ page }) => {
    await stubChat(page); // the real deployed (v1.4.0) shape: no `model` field at all
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page);
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();
    await page.getByTestId('concierge-starter-chip').first().click();

    const assistantTurn = page.getByTestId('concierge-turn-assistant').last();
    await expect(assistantTurn).toBeVisible();
    await expect(assistantTurn).toContainText('Boudhanath Stupa'); // the reply still rendered fully
    await expect(page.getByTestId('concierge-turn-model')).toHaveCount(0); // no badge, no placeholder
    expect(pageErrors).toEqual([]); // and no throw along the way
  });

  test('the model id renders, raw and unmapped, under the assistant turn that produced it', async ({
    page,
  }) => {
    await stubChat(page, 'gemini-2.5-flash-lite');
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page);
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();
    await page.getByTestId('concierge-starter-chip').first().click();

    const modelLine = page.getByTestId('concierge-turn-model');
    await expect(modelLine).toBeVisible();
    // Raw id, byte-for-byte — R2 forbids a friendly-name lookup table.
    await expect(modelLine).toHaveText('gemini-2.5-flash-lite');
  });
});

/**
 * S395 · open item A — the concierge ERROR ROW, axe-scanned for the first time.
 *
 * 🔴 WHY THIS DID NOT ALREADY EXIST, AND WHY THE OLD SCAN DOES NOT COVER IT. The S350 scan above
 * runs on the panel's steady EMPTY state: starter chips + input, no turn sent, therefore no
 * assistant bubble, no model line, no op chip and — the point here — no `role="alert"` row. The
 * only error-row coverage anywhere in the repo is jsdom
 * (`lib/__tests__/concierge-op-feedback.test.ts`, the S389-C describe), and jsdom does not run axe.
 *
 * ⚖️ PRECEDENT NOTE, because this is the pack's FIRST axe scan of an error state (`weather.spec.ts`
 * and `travel-essentials.spec.ts` both induce errors and then scan only healthy states). The shape
 * to copy is here: induce the error through the feature's EXISTING network stub, assert the error
 * node is on screen, then scan — and scan the healthy state in the same test so any finding is
 * attributable to the error row rather than to the page it sits on.
 */
test.describe('S395 · open item A — the error row is a11y-scanned, not just rendered', () => {
  test('a 502 renders the alert row, and axe finds nothing serious/critical on it', async ({
    page,
  }, testInfo) => {
    await stubChatFailure(page);
    await page.goto('/', { waitUntil: 'load' });
    await assertConciergeWired(page);
    await page.getByTestId('concierge-trigger').click();
    await expect(page.getByTestId('concierge-panel')).toBeVisible();

    // CONTROL SCAN — the same panel with NO error row. Any violation reported by the second scan
    // and not this one belongs to the error row.
    await expect(page.getByTestId('concierge-error')).toHaveCount(0);
    await runAxe(page, 'concierge-panel healthy (control)', testInfo);

    await page.getByTestId('concierge-starter-chip').first().click();

    // 🔴 THE ANTI-VACUITY GUARD. Everything below is worthless if the row is not on screen, so the
    // row is asserted VISIBLE — and asserted to be the real thing, carrying real failure copy and
    // the retry control — immediately before axe runs. Remove the failure stub, rename the testid,
    // or let the row render empty, and this fails here rather than reporting a reassuring
    // "0 violations" about a state that was never on the page.
    //
    // #13, changed deliberately: this used to assert the row contained SERVER_ERROR_TEXT — the
    // Worker's own `{error}` body, rendered verbatim. The body is no longer read, so the pair of
    // assertions below is the stronger form of the same guard: our sentence IS on screen, and the
    // upstream string is NOT.
    const errorRow = page.getByTestId('concierge-error');
    await expect(errorRow).toBeVisible();
    await expect(errorRow).toHaveAttribute('role', 'alert');
    await expect(errorRow).toContainText('The concierge is having trouble right now.');
    await expect(errorRow).not.toContainText(SERVER_ERROR_TEXT);
    const retry = page.getByTestId('concierge-retry');
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    // The specific shape nobody had ever checked: a live region that WRAPS an interactive control,
    // whose only accessible name is its visible text.
    await expect(retry).toHaveAccessibleName('Try again');

    await runAxe(page, 'concierge-panel ERROR row', testInfo);
  });
});
