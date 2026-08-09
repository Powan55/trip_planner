import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S146 — the Settings page (`/settings`, `components/settings-panel.tsx`) E2E pack.
 *
 * Signs in with a real Trip Token EXPLICITLY (mirrors `safety.spec.ts` / `journal-browse.spec.ts`)
 * rather than riding the shared `fixtures.ts` default — every route sits behind the front-door
 * wall (D-241); the signed-in token passes it.
 *
 * Proves, on the served static `out/` build (dormant — no firebase, so every clear is a plain local
 * wipe, D-038; the UNDER-SYNC propagation of each clear is proven at unit level in
 * `lib/__tests__/settings-clear-all.test.ts`):
 *   1. The three groups render; Export/Import is discoverable here (S145/D-156).
 *   2. Sign out clears the Trip Token → the front-door gate returns.
 *   3. The RELOCATED currency toggle + rate override live here and re-express the /plan grand total
 *      (the write path is unchanged `use-budget`, so /plan reads the same store on its next mount).
 *   4. Each per-domain clear wipes its localStorage slot and STAYS cleared on reload (D-018).
 *   5. Zero serious/critical axe violations.
 */

const BUDGET_KEY = 'nepal_japan_budget';
const EXPENSES_KEY = 'nepal_japan_expenses';
const JOURNAL_KEY = 'nepal_japan_journal';
const ITINERARY_KEY = 'nepal_japan_itinerary';
const DOCS_KEY = 'nepal_japan_docs_checklist';

type Seed = {
  budget?: unknown;
  expenses?: unknown;
  journal?: unknown;
  itinerary?: unknown;
  docs?: unknown;
};

/** Sign in as a traveler (before any app script) + optionally seed domain localStorage slots. */
async function gotoSettings(page: Page, seed: Seed = {}, token = 'Powan') {
  await page.addInitScript(
    ({ t, s }: { t: string; s: Seed }) => {
      // S352: ALL seeding below (identity + the domain seedOnce calls) fires ONLY on this test's
      // FIRST navigation, guarded by a sessionStorage marker (sessionStorage outlives a reload but
      // is untouched by wipeAllTripData/clearIdentity, unlike localStorage). `signOut()` now
      // reloads after its full teardown (Ruling 3) — that reload is itself a navigation this
      // addInitScript re-runs on, and "seed only when ABSENT" is exactly the WRONG rule once a real
      // wipe legitimately made a slot absent: it would look identical to "never seeded" and get
      // silently reseeded, masking the teardown in this harness only (a real browser has no
      // addInitScript re-running on reload, so this guard makes the harness match production, not
      // the other way round).
      const FIRST_NAV = '__e2e_settings_identity_seeded__';
      if (window.sessionStorage.getItem(FIRST_NAV) === null) {
        window.sessionStorage.setItem(FIRST_NAV, '1');
        window.localStorage.setItem('tripPlannerToken', t);
        window.localStorage.setItem('tripPlannerUserName', t);
        const seedOnce = (k: string, v: unknown) => {
          if (v !== undefined) window.localStorage.setItem(k, JSON.stringify(v));
        };
        seedOnce('nepal_japan_budget', s.budget);
        seedOnce('nepal_japan_expenses', s.expenses);
        seedOnce('nepal_japan_journal', s.journal);
        seedOnce('nepal_japan_itinerary', s.itinerary);
        seedOnce('nepal_japan_docs_checklist', s.docs);
      }
      window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
      window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
    },
    { t: token, s: seed },
  );
  await page.goto('/settings/', { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
}

async function readKey(page: Page, key: string): Promise<unknown> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

/** Expand a collapsed <details> group by clicking its summary. */
async function expandGroup(page: Page, testId: string) {
  const summary = page.getByTestId(`${testId}-toggle`);
  await summary.click();
}

const BUDGET_100_300 = {
  version: 1,
  homeCurrency: 'USD',
  rates: { NPR: 138, JPY: 155 },
  legBudgets: { nepal: 13800, japan: 31000 }, // 100 + 200 = 300 USD at seed rates
  categoryBudgets: {},
};

test.describe('S146 settings — structure + discoverability', () => {
  test('renders the three groups; export/import is discoverable', async ({ page }) => {
    await gotoSettings(page);
    await expect(page.getByTestId('settings-group-identity')).toBeVisible();
    await expect(page.getByTestId('settings-group-currency')).toBeVisible();
    await expect(page.getByTestId('settings-group-data')).toBeVisible();

    // NO notifications group (D-130 declined).
    await expect(page.getByText('Notifications', { exact: false })).toHaveCount(0);

    // Export/Import (the reused BackupRestore panel) is reachable once the Data group is open.
    await expandGroup(page, 'settings-group-data');
    await expect(page.getByTestId('backup-export-button')).toBeVisible();
    await expect(page.getByTestId('backup-import-trigger')).toBeVisible();
  });
});

// S200's Google sign-in group was REMOVED in S232 (D-209 item 2): the
// capability-token Firestore rules never read request.auth, so Firebase Auth (anonymous +
// Google) is fully vestigial and was stripped. The `settings-group-google` surface no longer
// exists — its former dormant-absence + integration-QA specs are retired with the feature.

test.describe('S146 settings — sign out', () => {
  test('sign out clears the Trip Token and the front-door gate returns', async ({ page }) => {
    await gotoSettings(page);
    await expect(page.getByTestId('settings-identity-name')).toHaveText('Powan');

    // S352 (D-249): sign-out is now a confirm-gated full teardown, not a bare one-click action.
    await page.getByTestId('settings-sign-out').click();
    await expect(page.getByTestId('settings-sign-out-dialog')).toBeVisible();
    await page.getByTestId('settings-sign-out-confirm').click();

    // The token is cleared → the front-door wall reappears. S355: the wall now OPENS on the
    // marketing landing; the boarding-pass auth card is its second view, reached from a CTA. So
    // "the gate returned" is the landing. Asserted by testid, not by copy — this slice is itself a
    // copy rename, and a spec that matches on prose breaks again at the next one.
    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 10_000 });
    expect(await readKey(page, 'tripPlannerToken')).toBeNull();
  });
});

/**
 * S396 (Q3) + S408 — claim everything stamped with a name you used to go by.
 *
 * The owner renamed himself Traveler → Powan and his pre-rename entries kept the old stamp, so he
 * appears as two people. This is the owner-initiated rewrite, NOT a Vault migration: 'Traveler' is
 * also the login placeholder (`DEFAULT_TRAVELER_NAME`), so a stored 'Traveler' is ambiguous, and
 * the COUNT SHOWN BEFORE THE BUTTON is the safety mechanism — this spec asserts that the count is
 * real (it must equal what actually changes) and that the loud no-ops refuse.
 *
 * S408 widened it from itinerary items to THREE stores: itinerary (createdBy/updatedBy/doneBy),
 * expenses (createdBy/updatedBy) and documents (updatedBy).
 *
 * 🔴 AND NOT ONE FIELD FURTHER. `Expense.paidBy` / `Expense.split[]` hold the same display-name
 * strings but are MONEY: `core/budget/settlement.ts` de-duplicates split members before dividing,
 * so renaming into a split that already holds the new name drops the divisor and re-points every
 * balance. The expense seeded below is built to expose exactly that (`paidBy: 'Traveler'`,
 * `split: ['Traveler','Powan']`) — this spec asserts those bytes survive the claim untouched.
 */
test.describe('S396/S408 settings — claim entries stamped with an old name', () => {
  /** The itinerary slot is a bare array as SEEDED but a versioned Vault envelope once the store
   *  has written it — read both, or the assertion silently inspects the wrong shape. */
  function storedItems(raw: unknown): Array<Record<string, unknown>> {
    const plans = (Array.isArray(raw) ? raw : (raw as { payload?: unknown })?.payload) as
      | Array<{ items?: Array<Record<string, unknown>> }>
      | undefined;
    return plans?.[0]?.items ?? [];
  }

  const CLAIM_DAY = '2026-12-20';
  const STAMP = '2026-12-01T08:00:00.000Z';
  const claimSeed = [
    {
      date: CLAIM_DAY,
      city: 'Tokyo',
      country: 'japan',
      items: [
        {
          id: 'q3-all',
          title: 'Q3 old-name item',
          category: 'sightseeing',
          createdBy: 'Traveler',
          updatedBy: 'Traveler',
          updatedAt: STAMP,
          doneBy: 'Traveler',
          done: true,
        },
        // Only `doneBy` matches — the S390-B field, and the reason the rewrite is per-FIELD.
        {
          id: 'q3-done',
          title: 'Q3 ticked-off item',
          category: 'food',
          createdBy: 'Sushil',
          updatedBy: 'Sushil',
          updatedAt: STAMP,
          doneBy: 'Traveler',
          done: true,
        },
        // Somebody else's item — must survive untouched.
        {
          id: 'q3-other',
          title: 'Q3 someone else',
          category: 'food',
          createdBy: 'Sushil',
          updatedBy: 'Sushil',
          updatedAt: STAMP,
        },
      ],
    },
  ];

  // S408 — two expenses stamped with the old name. `q3-exp-split` is the money trap: the old name
  // is the payer AND a split member, and the CLAIMING name is already the other split member.
  const claimExpenses = [
    {
      id: 'q3-exp-split',
      leg: 'nepal',
      category: 'food',
      amount: 3000,
      createdAt: '2026-12-01T09:00:00.000Z',
      paidBy: 'Traveler',
      split: ['Traveler', 'Powan'],
      createdBy: 'Traveler',
      updatedBy: 'Traveler',
    },
    // Somebody else's expense — must survive untouched.
    {
      id: 'q3-exp-other',
      leg: 'japan',
      category: 'food',
      amount: 4000,
      createdAt: '2026-12-01T10:00:00.000Z',
      paidBy: 'Sushil',
      split: ['Sushil', 'Uttam'],
      createdBy: 'Sushil',
      updatedBy: 'Sushil',
    },
  ];

  // S408 — the docs checklist. `updatedBy` is the only identity field a DocItem carries.
  const claimDocs = [
    {
      id: 'passport-validity',
      section: 'critical',
      label: 'Passport valid 6+ months beyond Jan 2027',
      checked: true,
      updatedBy: 'Traveler',
      updatedAt: STAMP,
    },
    {
      id: 'online-checkin',
      section: 'dayzero',
      label: 'Online check-in completed',
      checked: true,
      updatedBy: 'Sushil',
      updatedAt: STAMP,
    },
  ];

  const fullSeed = { itinerary: claimSeed, expenses: claimExpenses, docs: claimDocs };

  test('the previewed count is real: claiming rewrites all three author fields, spares everyone else, and persists', async ({ page }) => {
    await gotoSettings(page, { itinerary: claimSeed });

    // The count preview — the entire safety gate — is visible BEFORE anything mutates. With no
    // expense or document carrying the name, NEITHER store appears in the copy (S408: a store with
    // nothing stamped is left out entirely, never rendered as "0 expenses").
    await expect(page.getByTestId('settings-claim-name-input')).toHaveValue('Traveler');
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      '2 itinerary items are stamped “Traveler”. Claim them as yours?',
    );
    await expect(page.getByTestId('settings-claim-name-submit')).toHaveText('Claim 2 entries');

    await page.getByTestId('settings-claim-name-submit').click();
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      'Claimed 2 entries as “Powan”.',
    );

    // What actually landed on disk — and the count matches the number he approved.
    const byId = Object.fromEntries(storedItems(await readKey(page, ITINERARY_KEY)).map((i) => [i.id as string, i]));
    expect(byId['q3-all'].createdBy).toBe('Powan');
    expect(byId['q3-all'].updatedBy).toBe('Powan');
    expect(byId['q3-all'].doneBy).toBe('Powan');
    // Per FIELD: Sushil keeps the authorship that is genuinely his.
    expect(byId['q3-done'].doneBy).toBe('Powan');
    expect(byId['q3-done'].createdBy).toBe('Sushil');
    expect(byId['q3-done'].updatedBy).toBe('Sushil');
    expect(byId['q3-other'].createdBy).toBe('Sushil');
    expect(byId['q3-other'].updatedBy).toBe('Sushil');
    // updatedAt preserved — a claim must not float old items to the top of the activity feed.
    expect(byId['q3-all'].updatedAt).toBe(STAMP);
    expect(byId['q3-done'].updatedAt).toBe(STAMP);
    // The claimed name is recorded so FUTURE arrivals still match "My edits" (S390-C mechanism).
    expect(await readKey(page, 'tripPlannerPriorNames')).toEqual(['Traveler']);

    // Survives a reload, and there is then nothing left to claim.
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      'Nothing is stamped “Traveler”. There is nothing to claim.',
    );
    await expect(page.getByTestId('settings-claim-name-submit')).toBeDisabled();
  });

  test('the no-op cases refuse loudly: your own current name, and a name nobody carries', async ({ page }) => {
    await gotoSettings(page, { itinerary: claimSeed });

    await page.getByTestId('settings-claim-name-input').fill('Powan');
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      '“Powan” is your current name. Enter the name you used before.',
    );
    await expect(page.getByTestId('settings-claim-name-submit')).toBeDisabled();

    await page.getByTestId('settings-claim-name-input').fill('Nobody');
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      'Nothing is stamped “Nobody”. There is nothing to claim.',
    );
    await expect(page.getByTestId('settings-claim-name-submit')).toBeDisabled();

    // Mobile (375px): the card stacks and nothing overflows the viewport horizontally.
    await page.setViewportSize({ width: 375, height: 720 });
    const card = page.getByTestId('settings-claim-old-name');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // Nothing was written by any of that.
    expect(storedItems(await readKey(page, ITINERARY_KEY)).map((i) => i.updatedBy)).toEqual([
      'Traveler',
      'Sushil',
      'Sushil',
    ]);
    expect(await readKey(page, 'tripPlannerPriorNames')).toBeNull();
  });

  test('S408 — the claim reaches expenses and documents, and stops dead at paidBy/split', async ({
    page,
  }) => {
    await gotoSettings(page, fullSeed);

    // The preview names each store that has a match, with its own count, in plain English.
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      '2 itinerary items, 1 expense and 1 document are stamped “Traveler”. Claim them as yours?',
    );
    await expect(page.getByTestId('settings-claim-name-submit')).toHaveText('Claim 4 entries');

    await page.getByTestId('settings-claim-name-submit').click();
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      'Claimed 4 entries as “Powan”.',
    );

    // ── Expenses: attribution claimed … ──────────────────────────────────────────────────────
    const expenses = (await readKey(page, EXPENSES_KEY)) as Array<Record<string, unknown>>;
    const expById = Object.fromEntries(expenses.map((e) => [e.id as string, e]));
    expect(expById['q3-exp-split'].createdBy).toBe('Powan');
    expect(expById['q3-exp-split'].updatedBy).toBe('Powan');
    // 🔴 … and the money is byte-identical. Had the rewrite widened, `split` would read
    // ['Powan','Powan'], settlement's `uniq` would collapse it to ONE member, and the 3000 NPR
    // bill would divide by 1 instead of 2 — every balance and transfer on the leg re-pointed.
    expect(expById['q3-exp-split'].paidBy).toBe('Traveler');
    expect(expById['q3-exp-split'].split).toEqual(['Traveler', 'Powan']);
    expect(expById['q3-exp-split'].createdAt).toBe('2026-12-01T09:00:00.000Z'); // never re-dated
    expect(expById['q3-exp-other']).toEqual(claimExpenses[1]); // untouched, byte for byte

    // ── Documents: `updatedBy` is the only identity field, and the only one that moved ───────
    const docs = (await readKey(page, DOCS_KEY)) as Array<Record<string, unknown>>;
    const docById = Object.fromEntries(docs.map((d) => [d.id as string, d]));
    expect(docById['passport-validity'].updatedBy).toBe('Powan');
    expect(docById['passport-validity'].updatedAt).toBe(STAMP); // not re-stamped
    expect(docById['passport-validity'].checked).toBe(true);
    expect(docById['online-checkin']).toEqual(claimDocs[1]); // Sushil's row, untouched

    // The itinerary half still works alongside the two new stores.
    const byId = Object.fromEntries(
      storedItems(await readKey(page, ITINERARY_KEY)).map((i) => [i.id as string, i]),
    );
    expect(byId['q3-all'].doneBy).toBe('Powan');
    expect(byId['q3-other'].createdBy).toBe('Sushil');

    // Survives a reload (the client-side hard guarantee) with nothing left to claim anywhere.
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-claim-name-status')).toHaveText(
      'Nothing is stamped “Traveler”. There is nothing to claim.',
    );
    await expect(page.getByTestId('settings-claim-name-submit')).toBeDisabled();
    const afterReload = (await readKey(page, EXPENSES_KEY)) as Array<Record<string, unknown>>;
    expect(afterReload.find((e) => e.id === 'q3-exp-split')?.split).toEqual(['Traveler', 'Powan']);
  });
});

test.describe('S352 — sign-out is a full local teardown, not just an identity clear', () => {
  test('sign out wipes default-pack trip data (budget/expenses/journal) too, not only the Trip Token', async ({
    page,
  }) => {
    await gotoSettings(page, {
      budget: BUDGET_100_300,
      expenses: [{ id: 'e1', leg: 'nepal', category: 'food', amount: 10, createdAt: 'x' }],
      journal: [{ date: '2026-12-10', text: 'Trip so far' }],
    });
    await expect(page.getByTestId('settings-identity-name')).toHaveText('Powan');

    await page.getByTestId('settings-sign-out').click();
    await page.getByTestId('settings-sign-out-confirm').click();

    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 10_000 }); // S355 — see above
    expect(await readKey(page, BUDGET_KEY)).toBeNull();
    expect(await readKey(page, EXPENSES_KEY)).toBeNull();
    expect(await readKey(page, JOURNAL_KEY)).toBeNull();
    expect(await readKey(page, 'tripPlannerToken')).toBeNull();
  });

  test('negative control: a signed-in RELOAD survives untouched — the wipe fires on sign-out only', async ({
    page,
  }) => {
    await gotoSettings(page, { budget: BUDGET_100_300 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    expect(await readKey(page, BUDGET_KEY)).toEqual(BUDGET_100_300);
    // tripPlannerToken is a plain string (not JSON) — read it directly, not via the JSON-parsing readKey.
    expect(await page.evaluate(() => window.localStorage.getItem('tripPlannerToken'))).toBe('Powan');
  });
});

test.describe('S146 settings — relocated currency & rates re-express the /plan grand total', () => {
  test('home-currency toggle persists and re-expresses the /plan grand total', async ({ page }) => {
    await gotoSettings(page, { budget: BUDGET_100_300 });

    await expandGroup(page, 'settings-group-currency');
    await page.getByTestId('budget-currency-jpy').click();
    await expect(page.getByTestId('budget-currency-jpy')).toHaveAttribute('aria-checked', 'true');

    // Persisted (write path is the unchanged use-budget commit — S143 unaffected).
    await expect
      .poll(async () => (await readKey(page, BUDGET_KEY) as { homeCurrency: string }).homeCurrency)
      .toBe('JPY');

    // /plan reads the same store on its next mount → grand total re-expressed: 300 USD × 155 = ¥46,500.
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('¥46,500', { timeout: 15_000 });
  });

  test('rate override persists and re-expresses the /plan grand total', async ({ page }) => {
    await gotoSettings(page, {
      budget: { ...BUDGET_100_300, legBudgets: { nepal: 13800, japan: 0 } }, // just Nepal = 100 USD at seed
    });

    await expandGroup(page, 'settings-group-currency');
    await page.getByTestId('budget-rate-npr').fill('100'); // 13800 / 100 = 138 USD

    await expect
      .poll(async () => (await readKey(page, BUDGET_KEY) as { rates: { NPR: number } }).rates.NPR)
      .toBe(100);

    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$138', { timeout: 15_000 });
  });
});

test.describe('S146 settings — per-domain clears wipe the slot and stay cleared (dormant, D-018)', () => {
  test('budget reset restores the seeded default', async ({ page }) => {
    await gotoSettings(page, { budget: BUDGET_100_300 });
    await expandGroup(page, 'settings-group-data');

    await page.getByTestId('settings-clear-budget').click();
    await page.getByTestId('settings-clear-budget-confirm').click();

    await expect
      .poll(async () => (await readKey(page, BUDGET_KEY) as { legBudgets: unknown }).legBudgets)
      .toEqual({ nepal: 0, japan: 0 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect((await readKey(page, BUDGET_KEY) as { legBudgets: unknown }).legBudgets).toEqual({
      nepal: 0,
      japan: 0,
    });
  });

  test('expenses clear empties the slot', async ({ page }) => {
    const expenses = [
      { id: 'e1', leg: 'nepal', category: 'food', amount: 100, createdAt: '2026-12-10T00:00:00.000Z' },
    ];
    await gotoSettings(page, { expenses });
    await expandGroup(page, 'settings-group-data');

    await page.getByTestId('settings-clear-expenses').click();
    await page.getByTestId('settings-clear-expenses-confirm').click();

    await expect.poll(async () => await readKey(page, EXPENSES_KEY)).toEqual([]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await readKey(page, EXPENSES_KEY)).toEqual([]);
  });

  test('journal clear empties the slot (LOCAL only — D-152)', async ({ page }) => {
    const journal = [{ date: '2026-12-10', text: 'Landed', createdAt: '2026-12-10T00:00:00.000Z' }];
    await gotoSettings(page, { journal });
    await expandGroup(page, 'settings-group-data');

    await page.getByTestId('settings-clear-journal').click();
    await page.getByTestId('settings-clear-journal-confirm').click();

    await expect.poll(async () => await readKey(page, JOURNAL_KEY)).toEqual([]);
  });

  test('itinerary clear empties every day', async ({ page }) => {
    const itinerary = [
      { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [{ id: 'a', title: 'Temple', category: 'cultural' }] },
    ];
    await gotoSettings(page, { itinerary });
    await expandGroup(page, 'settings-group-data');

    await page.getByTestId('settings-clear-itinerary').click();
    await page.getByTestId('settings-clear-itinerary-confirm').click();

    // Dormant: every day physically emptied — zero items remain across all days. The itinerary
    // slot is a Vault envelope once the app writes it, so unwrap `.payload` when present.
    await expect
      .poll(async () => {
        const raw = (await readKey(page, ITINERARY_KEY)) as unknown;
        const days = (Array.isArray(raw) ? raw : (raw as { payload?: unknown[] })?.payload) as
          | Array<{ items: unknown[] }>
          | undefined;
        return days ? days.flatMap((d) => d.items).length : -1;
      })
      .toBe(0);
  });

  test('cancelling a clear leaves the data intact', async ({ page }) => {
    await gotoSettings(page, { budget: BUDGET_100_300 });
    await expandGroup(page, 'settings-group-data');

    await page.getByTestId('settings-clear-budget').click();
    await page.getByTestId('settings-clear-budget-cancel').click();

    // Untouched.
    expect((await readKey(page, BUDGET_KEY) as { legBudgets: unknown }).legBudgets).toEqual({
      nepal: 13800,
      japan: 31000,
    });
  });
});

test.describe('S174 (FU-37) — expenses JSON backup/restore (own schema, D-098)', () => {
  test('export downloads a versioned expenses-only envelope', async ({ page }) => {
    const expenses = [
      { id: 'e1', leg: 'nepal', category: 'food', amount: 100, note: 'Momo', createdAt: '2026-12-10T00:00:00.000Z' },
    ];
    await gotoSettings(page, { expenses });
    await expandGroup(page, 'settings-group-data');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('settings-export-expenses-json').click(),
    ]);
    // S228: this real Chromium supports CompressionStream, so the export is gzip-compressed
    // (shared `core/vault/compression.ts` helper) — filename carries the `.gz` marker.
    expect(download.suggestedFilename()).toBe('nepal-japan-expenses.json.gz');

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const zlib = await import('node:zlib');
    const rawGz = await fs.readFile(path as string);
    const raw = zlib.gunzipSync(rawGz).toString('utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.updatedAt).toBe('string');
    expect(parsed.payload.some((e: { id: string }) => e.id === 'e1')).toBe(true);
  });

  test('restore: known-good file replaces expenses and survives reload (round-trip)', async ({ page }) => {
    const expenses = [
      { id: 'orig', leg: 'nepal', category: 'food', amount: 100, note: 'Original', createdAt: '2026-12-10T00:00:00.000Z' },
    ];
    await gotoSettings(page, { expenses });
    await expandGroup(page, 'settings-group-data');

    const backupEnvelope = {
      schemaVersion: 1,
      updatedAt: '2026-07-16T00:00:00.000Z',
      payload: [
        { id: 'restored-1', leg: 'japan', category: 'transportation', amount: 2000, note: 'Restored fare', createdAt: '2026-12-20T00:00:00.000Z' },
      ],
    };
    await page.getByTestId('settings-import-expenses-input').setInputFiles({
      name: 'nepal-japan-expenses.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backupEnvelope), 'utf-8'),
    });
    await expect(page.getByTestId('settings-import-expenses-dialog')).toBeVisible();
    await page.getByTestId('settings-import-expenses-confirm').click();
    await expect(page.getByTestId('settings-import-expenses-dialog')).toHaveCount(0);
    await expect(page.getByTestId('settings-import-expenses-status')).toBeVisible();

    await expect
      .poll(async () => (await readKey(page, EXPENSES_KEY)) as Array<{ id: string }>)
      .toEqual([expect.objectContaining({ id: 'restored-1', note: 'Restored fare' })]);

    // Survives reload (the persistence hard guarantee).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expandGroup(page, 'settings-group-data');
    const onDisk = (await readKey(page, EXPENSES_KEY)) as Array<{ id: string; note?: string }>;
    expect(onDisk).toEqual([expect.objectContaining({ id: 'restored-1', note: 'Restored fare' })]);
  });

  test('restore: corrupt file fails safe, quarantines the blob, and the current expenses survive', async ({ page }) => {
    const expenses = [
      { id: 'safe', leg: 'nepal', category: 'food', amount: 100, note: 'Must survive', createdAt: '2026-12-10T00:00:00.000Z' },
    ];
    await gotoSettings(page, { expenses });
    await expandGroup(page, 'settings-group-data');
    const before = await readKey(page, EXPENSES_KEY);

    await page.getByTestId('settings-import-expenses-input').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ not valid json', 'utf-8'),
    });
    await expect(page.getByTestId('settings-import-expenses-dialog')).toBeVisible();
    await page.getByTestId('settings-import-expenses-confirm').click();
    await expect(page.getByTestId('settings-import-expenses-dialog')).toHaveCount(0);
    await expect(page.getByTestId('settings-import-expenses-error')).toBeVisible();

    expect(await readKey(page, EXPENSES_KEY)).toEqual(before);
    const quarantined = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      'nepal_japan_expenses_corrupt',
    );
    expect(quarantined).toBe('{ not valid json');
  });

  test('cancelling the restore confirm dialog leaves expenses untouched', async ({ page }) => {
    const expenses = [
      { id: 'keep', leg: 'nepal', category: 'food', amount: 100, note: 'Keep me', createdAt: '2026-12-10T00:00:00.000Z' },
    ];
    await gotoSettings(page, { expenses });
    await expandGroup(page, 'settings-group-data');
    const before = await readKey(page, EXPENSES_KEY);

    await page.getByTestId('settings-import-expenses-input').setInputFiles({
      name: 'nepal-japan-expenses.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, updatedAt: 'x', payload: [] }), 'utf-8'),
    });
    await expect(page.getByTestId('settings-import-expenses-dialog')).toBeVisible();
    await page.getByTestId('settings-import-expenses-cancel').click();
    await expect(page.getByTestId('settings-import-expenses-dialog')).toHaveCount(0);

    expect(await readKey(page, EXPENSES_KEY)).toEqual(before);
  });
});

test.describe('S146 axe — /settings (run twice for determinism)', () => {
  for (const run of [1, 2] as const) {
    test(`axe run ${run}: /settings has zero serious/critical violations`, async ({ page }, testInfo) => {
      await gotoSettings(page);
      // Expand all groups so axe scans the full interactive surface, not just the collapsed shells.
      await expandGroup(page, 'settings-group-currency');
      await expandGroup(page, 'settings-group-data');

      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of results.violations) {
        const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
        testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
        // eslint-disable-next-line no-console
        console.log(`  axe /settings (run ${run}) ${line}`);
      }
      expect(
        blocking,
        `serious/critical a11y violations on /settings: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
      ).toEqual([]);
    });
  }
});
