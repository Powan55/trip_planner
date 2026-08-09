# live-v5-vault fixture

Acceptance backbone for the v4 -> v5 migration (M19 Phase 0, slice S172). This
directory holds a REAL captured `localStorage`/`sessionStorage` dump from
the owner's live browser session, plus the loader that seeds it into a
Playwright context — this is what proves a migration step "survives
byte-for-byte" on real user data, not a hand-authored fixture.

## Current status

**The REAL dump has landed: `live-dump.json`** (captured 2026-07-19 from
the owner's live browser via S171's DevTools snippet — schemaVersion 5, 32 days,
8 localStorage keys). It is real trip data: it stays in this private repo
and its contents must never be copied into spec files beyond tiny
assertions (e.g. one known itinerary title).

Real-data acceptance runs against it in `e2e/live-vault-acceptance.spec.ts`
(S193): boot + two reloads, byte-for-byte survival of every seeded key,
real data rendered, quarantine key absent, zero console errors.

`PLACEHOLDER-synthetic-dump.json` remains in this directory as the
harness-only smoke fixture for `e2e/live-v5-vault-loader.spec.ts`. It is
SYNTHETIC — never cite it as migration acceptance evidence.

## Expected dump format

A single JSON object, produced by S171's DevTools capture snippet, of the
shape:

```json
{
  "localStorage": {
    "<key>": "<raw string value>",
    "...": "..."
  },
  "sessionStorage": {
    "<key>": "<raw string value>"
  }
}
```

- Values are **raw strings exactly as stored** (JSON-shaped slots — itinerary,
  budget, expenses, journal, favorites, sync-outbox, photos, weather-cache —
  are themselves JSON-stringified, i.e. the value is a string containing
  JSON, not a nested object). No re-encoding, no re-shaping.
- A dump may omit any key. An omitted key seeds nothing for that slot (same
  as a fresh install never having written it).
- Keys must match `core/storage/gateway.ts`'s `STORAGE_KEYS` registry
  (D-097 LOCKED — the single key registry) plus the two itinerary keys owned
  by `lib/itinerary-storage.ts` (`nepal_japan_itinerary`,
  `nepal_japan_itinerary_corrupt`), since those predate the gateway and stay
  outside it by design. As of S172 the known slots are:

  **localStorage:** `tripPlannerUserName`, `tripPlannerToken`,
  `nightlife_section_visible`, `nepal_japan_weather_cache`,
  `nepal_japan_budget`, `nepal_japan_expenses`, `nepal_japan_journal`,
  `chunk_reload_once` is session (see below), `nepal_japan_favorites`,
  `nepal_japan_sync_outbox`, `nepal_japan_photos`,
  `nepal_japan_first_run_tour_seen`, `nepal_japan_itinerary`,
  `nepal_japan_itinerary_corrupt` (only present if a corrupt payload was ever
  quarantined).

  **sessionStorage:** `tripPlannerTodayOverride`, `chunk_reload_once`.

## Using the loader

```ts
import { seedLiveVault, PLACEHOLDER_DUMP_PATH } from './fixtures/live-v5-vault/loader';

test('...', async ({ page }) => {
  await seedLiveVault(page, PLACEHOLDER_DUMP_PATH); // or the real live-dump.json path
  await page.goto('/');
  // ...
});
```

`seedLiveVault` reads the dump file, validates its shape, and seeds both
storages via `page.addInitScript` — i.e. before any app script runs on any
navigation in that browser context, matching the idiom `e2e/fixtures.ts`
already uses for the default-traveler / first-run-tour seeds. It
throws a clear synchronous error if the dump file is missing or malformed —
it never seeds a partial or silently-wrong dump.

## Why this matters

`core/storage/gateway.ts` is the single, byte-identical-on-disk key registry
(D-097 LOCKED). A migration step is only proven safe when it survives a real
user's actual stored bytes — synthetic fixtures can't catch a real-world edge
case (a legacy pre-migration shape, an unusual currency string, an old
schema version) that only exists in a real browser profile. This fixture
directory is where that real proof will live once S171's capture lands.
