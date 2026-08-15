import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Shared E2E fixtures.
 *
 * DEFAULT IDENTITY = a SIGNED-IN traveler (slice S113E). There is no guest mode (D-241,
 * slice S351): a logged-out visitor sees the front-door wall on EVERY route, with no
 * bypass. Since most specs in this pack navigate to `/plan`, `/nepal`, `/japan`, `/map`,
 * `/flights`, the default identity must be one that can see those pages: a signed-in
 * traveler.
 *
 * We seed the exact keys the real sign-in writes (`lib/token-auth.ts` `signIn` →
 * `identityStore.setToken` + `identityStore.setName`, i.e. `tripPlannerToken` +
 * `tripPlannerUserName`) for the first traveler in `TRAVELERS` (Powan). The wall's
 * decision runs on the client on first paint, so we seed BEFORE any app script via
 * `page.addInitScript` (runs before any other script on every navigation in this
 * context) — the wall never has a chance to open, on any route.
 *
 * S155: the default fixture ALSO pre-seeds the first-run-tour
 * "seen" flag (`nepal_japan_first_run_tour_seen`, gateway key 17) and the install-hint
 * "dismissed" flag (`nepal_japan_install_hint_dismissed`, key 30 — a standing app-wide
 * `duration: Infinity` Sonner toast that would otherwise trip axe's `list` rule on every
 * page). Every spec in this pack gets a FRESH storage context per test and the default
 * identity now passes the gate on first paint — without the tour flag,
 * `components/first-run-tour.tsx` would pop its centered dialog on literally every spec's
 * first navigation (covering the page, stealing focus into its Tab-trap) and break ~200
 * unrelated assertions pack-wide. Specs that actually want to exercise the tour
 * (`e2e/first-run-tour.spec.ts`) explicitly OMIT this flag via their own `addInitScript`
 * (fresh storage → tour shows), the same pattern `gotoSettings`-style per-spec helpers
 * already use to seed/omit other slots.
 */

/** The default traveler identity every spec in the pack rides on (first of TRAVELERS). */
const DEFAULT_TOKEN = 'Powan';

/**
 * ⚠️ VESTIGIAL since issue #8 — the glyphs are SELF-HOSTED now
 * (`lib/map-style.ts` -> `withBasePath('/font/{fontstack}/{range}.pbf')`, PBFs under
 * `public/font/`), so nothing in the app requests this host any more and the route below
 * matches zero requests. Kept, not deleted, because the measured flake notes at its
 * `page.route` call are the reason the CARTO stub underneath it exists — delete the pair
 * together or not at all. Same-origin glyphs are served off disk by `scripts/serve-out.mjs`,
 * so they no longer contribute to the reload-abort noise this stub was for.
 */
const MAPLIBRE_GLYPH_URL = 'https://demotiles.maplibre.org/**';

/**
 * The map style's RASTER BASEMAP endpoints, declared at `lib/map-style.ts:56-61`
 * (`CARTO_DARK_TILES`): `https://{a,b,c,d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`.
 * MapLibre rotates the four subdomains, so the glob wildcards it — Playwright compiles a single
 * `*` to `[^/]*` (it cannot cross a `/`), so this matches every `<sub>.basemaps.cartocdn.com`
 * host and nothing else. This is the abort source that actually drives the flake; see the
 * docblock at its `page.route` call below.
 */
const CARTO_TILE_URL = 'https://*.basemaps.cartocdn.com/**';

/**
 * 1×1 fully transparent RGBA PNG (68 bytes), built with zlib + correct chunk CRCs and verified
 * by decoding it back (signature, all three chunk CRCs via `zlib.crc32`, IHDR 1×1/8-bit/RGBA,
 * IDAT inflating to the expected 5 bytes). A WELL-FORMED image matters: MapLibre decodes raster
 * tiles with `createImageBitmap`, and a malformed body would trade one console error for another.
 */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
);

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((token: string) => {
      window.localStorage.setItem('tripPlannerToken', token);
      window.localStorage.setItem('tripPlannerUserName', token);
      window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep the tour dormant pack-wide
      window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss the app-wide install-to-Home toast (duration:Infinity would poison every axe scan)
    }, DEFAULT_TOKEN);
    /**
     * S363 regression hunt (2026-08-01) — HARNESS ARTIFACT, not app behaviour. Kept as the
     * historical record of WHY the raster stub below exists; the glyph half no longer fires
     * (see the vestigial note on `MAPLIBRE_GLYPH_URL`).
     *
     * `lib/map-style.ts` then declared a cross-origin glyph endpoint. MapLibre issued it hundreds of
     * ms AFTER `map-shell` becomes visible, so a spec that calls `page.reload()` in that
     * window CANCELS the in-flight request: `net::ERR_ABORTED` → the fetch promise rejects
     * with a bare `TypeError: Failed to fetch`, and `Evented.fire` logs that error object
     * VERBATIM via `console.error(event.error)` when no `error` listener is attached. It
     * lands in the page console and trips the "no console errors" guards in the pack.
     *
     * `KNOWN_TILE_FETCH_NOISE` cannot catch that BY CONSTRUCTION: it matches `AJAXError:
     * Failed to fetch`, and MapLibre wraps only NON-2XX RESPONSES in `AJAXError` — never
     * aborts. An aborted fetch's message is the bare string `Failed to fetch`, with NO URL in
     * it. Stubbing is therefore the right shape of fix (kill the request, don't loosen the
     * assertion): an empty body is a valid ZERO-GLYPH PBF range, GL symbol layers just draw no
     * label text, no spec asserts on canvas text, and the axe scans already `.exclude()` the
     * GL canvas. On the shared fixture rather than per-spec because the race is latent in
     * every spec that reloads with a map mounted.
     *
     * ⚠️ MEASURED, AND NOT SUFFICIENT ON ITS OWN — it needs the raster stub below.
     * `map-favorites-offline.spec.ts -g "survives a reload" --repeat-each=10`:
     *   with ONLY this stub:  2/10 and 1/10 failed
     *   with NO stub:         3/10 failed
     * — i.e. within noise of each other. A trace of one WITH-stub failure shows ZERO demotiles
     * requests on the wire (this route fulfilled them all) and 16 aborted
     * `*.basemaps.cartocdn.com/dark_all/*.png` RASTER TILE requests, `_resourceType: "fetch"`,
     * `_failureText: "net::ERR_ABORTED"`. The glyph endpoint is one abort source among ~17, not
     * "the" cause. Kept because it removes a real one cheaply.
     */
    await page.route(MAPLIBRE_GLYPH_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' }),
    );
    /**
     * The OTHER ~16 abort sources, and the ones that actually move the failure rate: the CARTO
     * raster basemap tiles from `lib/map-style.ts`'s `CARTO_DARK_TILES` (see `CARTO_TILE_URL`).
     *
     * MapLibre fetches raster tiles with `fetch` (not `<img src>`), so a tile cancelled by
     * `page.reload()` rejects with the SAME bare `TypeError: Failed to fetch` the glyph abort
     * produces, and `Evented.fire` logs that error object verbatim via `console.error(event.error)`
     * when no `error` listener is attached.
     *
     * 🔴 CLASS DISTINCTION — why `KNOWN_TILE_FETCH_NOISE` (in `map-favorites-offline.spec.ts` and
     * `map-day-assign.spec.ts`) structurally cannot filter this: it matches on `AJAXError: Failed
     * to fetch` and on the literal substring `basemaps.cartocdn.com`. MapLibre wraps only NON-2XX
     * RESPONSES in `AJAXError`; an ABORT is forwarded as the raw `TypeError`, whose message is the
     * bare string `Failed to fetch` with NO URL in it. So the `basemaps\.cartocdn\.com` branch —
     * which looks like it covers exactly this — can never match the aborted-tile message. The
     * filter is not missing a case; it applies to a different error class. Do NOT "fix" that by
     * widening it: `TypeError: Failed to fetch` is also what a genuine app-code fetch bug logs.
     *
     * SAFE HERE because this box has NO OUTBOUND INTERNET (`curl` to these hosts exits 35), so
     * these tiles NEVER load in this harness either way. Stubbing changes only HOW they fail, not
     * what renders: zero basemap pixels before, zero after (the transparent tile composites onto
     * the `brand-navy-underlay` background layer, which is what visual baselines already captured).
     * Fulfilled with a valid tiny PNG rather than an abort/404 so the raster source gets a
     * well-formed answer instead of trading one console error for another.
     *
     * ⚠️ MEASURED BY COUNTING, NOT BY INSPECTION — a single green run cannot see a ~10% coin.
     * `-g "survives a reload"`, same build, same port, back to back (2026-08-01):
     *   BOTH STUBS:  1 failed / 20, then 2 failed / 40  →  3 / 60  (5%)
     *   NEITHER:                      2 failed / 20     →  2 / 20  (10%)
     *
     * 🔴 READ THAT HONESTLY — this pair of stubs is NOT a proven fix, and this spec is NOT
     * deterministic. What the counts do support: the TARGET signature (`console/page errors:
     * TypeError: Failed to fetch`) was 2/20 without and 0/60 with (Fisher one-sided p ≈ 0.06).
     * What they do NOT support: a lower OVERALL failure rate — 3/60 vs 2/20 is p ≈ 0.37, i.e.
     * indistinguishable. All 3 residual failures wore signatures NOT seen in the control
     * (1× `map-shell` not visible 5s after reload; 2× `page.reload: net::ERR_ABORTED; maybe
     * frame was detached?` at the 30s test timeout). Whether the stubs cause those or merely
     * uncover them is UNRESOLVED at n=60 — the one mechanism that was testable was tested and
     * ruled out: request volume is identical either way (24 tiles pre-reload, 24 post, stub or
     * no stub, measured with a request counter). Do not add repeat-until-green retries on the
     * strength of this comment; the residual is real.
     */
    await page.route(CARTO_TILE_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }),
    );
    await use(page);
  },
});

/**
 * R5 (S363A) — fail-fast guard for a spec that assumes a WIRED build, i.e. `NEXT_PUBLIC_
 * CONCIERGE_URL` baked in at build time so `ConciergeChat` actually mounts (see
 * `e2e/concierge.spec.ts`'s header for the exact local build command). Without this, a wired-only
 * spec meeting an inert (unconfigured) build produces either a ~30s timeout on the first
 * `concierge-trigger` lookup, or — in a spec checked the other direction — a pass that doesn't
 * prove what it looks like it proves. Five such failures observed, in both directions, two inside
 * verification runs themselves.
 *
 * Call as the FIRST thing after `page.goto(...)` in a wired-only test. Bounded 5s wait, NOT a
 * one-shot `.count()`: `ConciergeChat`'s gate is `useSyncExternalStore` (`useActiveTraveler`)
 * with an inert SERVER_SNAPSHOT, so on the static-exported HTML the trigger is legitimately
 * absent until the client re-render after hydration resolves it — a one-shot read races that and
 * false-fails on a perfectly-wired build (caught by actually running this, not by inspection).
 * 5s is still ~6x faster than the 30s default action timeout this replaces, with a message that
 * names the variable instead of a generic "locator not found".
 *
 * TWO FORMS, ONE PROBE (the wait above is the part worth sharing):
 *   • `isConciergeWired(page)` → boolean, for a spec that must BRANCH on which build it met
 *     (assert-present when wired / skip-with-reason when not — `custom-trip-gating.spec.ts`).
 *   • `assertConciergeWired(page)` → throws, for a spec that is wired-only end to end
 *     (`concierge.spec.ts`).
 * Prefer either over a bare `.count()`, which races the hydration re-render described above and
 * can quietly report "not wired" on a wired build. The boolean form takes an optional timeout for
 * the same reason: when a false "not wired" would SKIP a check rather than fail it, buy more
 * certainty than the 5s default (measured: a cold first navigation in this sandbox can spend the
 * whole 15s SW wait before the app is even interactive).
 */
export function isConciergeWired(page: Page, timeoutMs = 5_000): Promise<boolean> {
  return page
    .getByTestId('concierge-trigger')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

export async function assertConciergeWired(page: Page): Promise<void> {
  if (!(await isConciergeWired(page))) {
    throw new Error(
      'NEXT_PUBLIC_CONCIERGE_URL is not baked into this build, so ConciergeChat never mounts ' +
        '(isConciergeConfigured() is false) — this spec requires a WIRED build. Rebuild with ' +
        'NEXT_PUBLIC_CONCIERGE_URL=https://concierge.test npm run build, then re-run.',
    );
  }
}

export { expect };
