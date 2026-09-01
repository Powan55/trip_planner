'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import OptimizedImage from '@/components/optimized-image';
import { entranceFor } from '@/lib/motion';

/**
 * The marketing landing — what a LOGGED-OUT visitor sees at `/`.
 *
 * WHERE IT LIVES: this renders inside `TokenGate`'s logged-out branch, as the
 * wall's FIRST view. No new route, no `(marketing)` route group, no root-layout split — in the App
 * Router a route group still nests inside `app/layout.tsx`, so escaping the providers would need the
 * root layout split AND the app home moved off `/`, churning the SW precache list, `lib/nav-items.ts`,
 * `bottom-tab-bar.tsx` and ~30 specs. The landing therefore carries the full app bundle and the
 * design spec's "<120 KB gzip, no providers" budget is explicitly NOT met. That is accepted and
 * deferred — do not "fix" it by adding a route.
 *
 * Living inside the wall is also what makes the focus-trap/Esc contract free: the wall's
 * existing `role="dialog"` panel, Tab-trap and document-level Esc capture wrap this component
 * unchanged. Nothing here re-implements any of it. The one thing this component owes the wall is a
 * labelled title/description, so it takes the wall's `titleId`/`descId` and puts them on the <h1>
 * and the lead paragraph — in the auth view the wall's own heading carries them instead.
 *
 * 🔴 ZERO LIVE TRIP DATA. This file imports nothing from the content pack, the itinerary store or
 * any provider hook, and it must stay that way. A logged-out stranger must not be able to read the
 * trip through the front door. Every string below is static marketing copy from the design spec.
 * The DoD pins this with a grep for those module paths, so this comment deliberately does NOT
 * spell them out — a doc comment that trips the guard trains reviewers to ignore the guard.
 * It is also why no date on this page is finer than a MONTH: `e2e/login.spec.ts` asserts the wall
 * carries no "Dec 9" in any of the three shapes the app renders one, so the chapters below name
 * cities and never days. Every FIGURE on the fact strip is a static literal for the same reason,
 * and each one is checkable against the app rather than invented.
 *
 * 🔴 COLOUR: semantic tokens ONLY (the three ink tiers, the six accents, the two country
 * gradients, `--on-accent`, `border-border`, `ring-ring`). No status-gold class and no raw hex
 * anywhere (same grep rule as above — the literals are omitted on purpose). A NEW file is
 * structurally invisible to every palette sweep whose worklist predates it — that is exactly how
 * `sign-out-confirm.tsx:102` shipped a gold focus ring no sweep could reach.
 *
 * ── THE LAYOUT IS THE PRODUCT, NOT A TEMPLATE ──────────────────────────────────────────────
 *
 * The page it replaced was a generic marketing wireframe: eyebrow, three equal feature cards,
 * two numbered chapters, three screenshots, three numbered steps, a closing block. Strip the
 * paint off that and nothing left on the page says which product it is selling.
 *
 * What is here instead is the INSTRUMENT the app already draws, pointed at itself:
 *   · the fact strip is `.cells` — the same four-up instrument cells /flights and the budget
 *     panel use — carrying the four figures that decide whether this app is for you.
 *   · "what's on board" is `.sys`, the systems annunciator, one row per thing the app holds,
 *     each stating its condition IN WORDS with the struck mark only repeating what the row
 *     already says. Nine ruled rows, not three cards, because the product is nine things.
 *   · the two chapters keep the photographic band and gain the plate's ruled `.capline`.
 *   · the screenshots are a contact sheet: numbered figures under one ruled caption line.
 *   · the "how it works" steps are gone. What a stranger actually does not understand is how a
 *     trip reaches another person, so that section is the two-token model instead — which is
 *     the same thing `trip-join-handshake.tsx` and `user-token-show-once.tsx` have to make
 *     legible at the moment it matters.
 *
 * WHAT WAS FROZEN, and each has teeth:
 * - Log in is the primary CTA and it is FIRST IN THE DOM. `token-gate.tsx`'s focus effect takes
 *   `panel.querySelector('button:not([disabled])')` — the first enabled button — so DOM ORDER is
 *   what moves focus. `e2e/login.spec.ts` and `lib/__tests__/s345-front-door.test.ts` both assert
 *   `document.activeElement`. Nothing above those two buttons may be a <button>: the eyebrow, the
 *   <h1> and the lead are all non-focusable, and the cover carries NO nav bar of its own.
 * - The <h1> copy is unchanged, and that is not laziness. Both specs pin the exact string.
 * - Plain <div>s, NOT <header>/<footer>. Those map to the banner/contentinfo LANDMARKS, and axe
 *   caught the duplicate contentinfo at both breakpoints back when the app's own chrome was still
 *   mounted behind the wall. Landmarks inside a modal dialog buy nothing anyway.
 * - The three screenshot slots keep their testids and their phone aspect ratio, and keep the
 *   distinct alt/caption pair (see the SHOTS comment). They are restyled and not remeasured.
 * - The cover, the two chapters and the closing block keep every pairing
 *   `scripts/contrast-tokens.mjs` measures under "THE FRONT DOOR": the volt eyebrow and join
 *   link, the --text-hi headline, the --text-mid lead, the --border-ui ghost CTA edge, the
 *   marigold/pink chapter numerals at the large-text bar, and the mint block with its INVERTED
 *   button. Restyling around a measured pairing is free; moving one is not, so none moved.
 *   --text-lo is banned outright over photography and appears on this page only on the page
 *   field, below a plate or in a caption line.
 *
 * MOTION. Tier 1, so this surface may have ONE ambient loop and a first-view-per-session entrance
 * (D-293 R1/R7). Both are asked for rather than assumed: `.door-kb` is the single loop (globals.css
 * has the reasoning and the reduced-motion stop), and `entranceFor()` below is the ledger.
 *
 * PHOTOGRAPHY. Three images, all already bundled and already attributed in
 * `public/images/CREDITS.md`; nothing new was fetched and nothing is hotlinked. Each one was OPENED
 * before it was chosen and what it actually shows is recorded beside it — file names in this repo
 * are not evidence, and two of them are actively misleading. `featured/nagarkot.jpg`, which the
 * design spec names for chapter 01, is a hillside of guesthouses under a telecom mast with no
 * mountain in the frame; `featured/patan-durbar.jpg` is a 19th-century watercolour painting, not a
 * photograph at all. Neither is used here.
 */

/**
 * The fact strip — the four figures a stranger actually decides on, in the instrument cells the
 * app uses for every other reading. Static literals (the zero-live-trip-data rule above), and each
 * is checkable: 32 days is the same figure `first-run-tour.tsx` and `map-section.tsx` print, the
 * two legs are the two the app ships, there is no invite mechanism at all, and the stack has no
 * paid service in it.
 *
 * These readings are written for a stranger, so they carry no developer vocabulary. "no API key"
 * used to sit here and on the Map row below, where it read as a fault report on the map rather
 * than the boast it was (D-079: the basemap is keyless by design and has never needed a key).
 */
const FACTS = [
  { label: 'Days', value: '32', foot: 'Dec 2026 — Jan 2027' },
  { label: 'Countries', value: '02', foot: 'Nepal, then Japan' },
  { label: 'Invites to send', value: '00', foot: 'One Trip Token instead' },
  { label: 'Price', value: '0', foot: 'Free, no card needed' },
] as const;

/**
 * The annunciator. One row per thing the app actually holds, its condition written out, and a
 * right-hand reading where a real one exists. Every row is STRUCK because every row is built —
 * this is not a roadmap and nothing here is a promise.
 *
 * 🔴 — READ BEFORE "SIMPLIFYING" THE OFFLINE ROW. Its scope has been wrong twice, in both
 * directions, so it is written down:
 * · The plan is fully offline (localStorage + the SW precache).
 * · The map ENGINE ships with the install too, so the "open the map online once" clause this
 *   replaced is obsolete.
 * · The TILES are NOT offline and are not going to be. They come from a cross-origin CDN, which
 *   the SW passes through uncached by design, and bulk-caching a free keyless CDN abuses it. So
 *   offline you get the canvas, your marker circles and the day route line, with no street
 *   imagery. Hence "pins and route" (true) and "the map background needs signal" (true). Do NOT
 *   shorten this to "the map works offline" — that is the claim a user disproves at 35,000 feet.
 */
const ONBOARD = [
  { name: 'Itinerary', cond: 'Every day, in the order you will do it', n: '32', unit: 'days' },
  { name: 'Map', cond: 'Your stops, pinned and joined in order', n: null, unit: 'street map' },
  { name: 'Guides', cond: 'Where to go, eat, shoot and go out late', n: '4', unit: 'kinds' },
  { name: 'Money', cond: 'Yen and rupees in, who-owes-who out', n: '3', unit: 'currencies' },
  { name: 'Checklists', cond: 'Packing and documents, before you fly', n: '2', unit: 'lists' },
  { name: 'Journal', cond: 'The day in your words, photographs attached', n: null, unit: 'on device' },
  { name: 'Recap', cond: 'The whole trip, read back to you', n: null, unit: 'at the end' },
  {
    name: 'Offline',
    // The one row that may not be shortened further — see the scope note above.
    cond: 'Plan and pins on your phone. Only the map background needs signal',
    n: null,
    unit: 'no signal',
  },
  { name: 'Install', cond: 'Home screen, opening straight into today', n: null, unit: 'home screen' },
] as const;

/**
 * The two chapters — full-bleed photographic bands over `.photo-header`, with the plate's ruled
 * caption line beneath each. It keeps the `landing-split-band` testid because it is the same
 * section doing the same job, and `e2e/login.spec.ts` asserts it is visible.
 *
 * `accent` is the chapter numeral's colour and it is LARGE display text, so its bar is 1.4.3's
 * 3:1 rather than 4.5:1 — measured at that bar over each grade's worst-case pixel. The titles and
 * body copy take the ink tiers and clear 4.5:1 outright.
 *
 * `focus` is the crop knob `.photo-header__media img` reads. A full-bleed band is a much wider
 * crop than any of these sources and each one puts its subject somewhere different, so this is
 * per-photograph and not a constant.
 */
const CHAPTERS = [
  {
    no: '01',
    country: 'np',
    accent: 'var(--marigold)',
    // Swayambhunath, Kathmandu — the whitewashed dome under the gilded spire, the Buddha's
    // painted eyes on the harmika, five lines of prayer flags fanning out to the corners of the
    // frame, pigeons over the dome, pilgrims and small shrines on the paved terrace, hard blue
    // sky. Deliberately NOT the cover's Boudhanath: it is the same city and the same century of
    // architecture, and two white stupas back to back under one grade would read as one picture.
    src: '/images/nepal/na2.jpg',
    focus: 'center 42%',
    eyebrow: 'Leg one',
    title: 'Nepal',
    body: 'Kathmandu valley mornings, momo stops, and the long drive out to the foothills.',
    when: 'Dec 2026',
  },
  {
    no: '02',
    country: 'jp',
    accent: 'var(--pink)',
    // Fushimi Inari, Kyoto — the senbon torii tunnel head-on: two walls of vermilion gateposts
    // in perspective, black bases, carved donor inscriptions down every column, one iron lantern
    // hanging in the near bay, the stone path curving away into the dark. Landscape, and the
    // vanishing point sits mid-frame, so it survives a wide crop better than any other bundled
    // Japan photograph.
    src: '/images/map/jp-fushimi.jpg',
    focus: 'center 50%',
    eyebrow: 'Leg two',
    title: 'Japan',
    body: 'New Year in the cities, early trains, and a fortnight of cold, bright light.',
    when: 'Dec 2026 — Jan 2027',
  },
] as const;

/**
 * The two credentials, side by side, because this is the one thing about the product a stranger
 * has no prior model for and the one place the two are most easily confused (D-239: they are
 * never mixed). `trip-join-handshake.tsx` states the same distinction at the moment a Trip Token
 * is used, and `user-token-show-once.tsx` states it at the moment a key is minted.
 */
const TOKENS = [
  {
    name: 'Your key',
    chip: 'chip--struck',
    what: 'One per person',
    rule: 'Logs you in · never share it',
  },
  {
    name: 'Trip Token',
    chip: '',
    what: 'One per trip',
    rule: 'Opens one trip · this is the one you send',
  },
] as const;

/**
 * The screenshot slots. `src` is the manifest key (see lib/image-manifest.json); regenerate
 * the rasters with `PLAYWRIGHT_SHOOT=1 npx playwright test e2e/landing-shots.spec.ts` followed by
 * `npm run gen:images`.
 *
 * 🔴 `alt` IS DELIBERATELY NOT `caption`. The obvious move is to reuse the caption as the
 * alt; measured, that costs an axe violation — `image-redundant-alt` × 3 nodes at BOTH 390 and 1440
 * ("Alternative text of images should not be repeated as text"), because a screen reader then hears
 * the same sentence twice per shot: once from the <img>, once from the <figcaption> right under it.
 * It is only `minor`, so this pack's serious/critical/moderate gate stayed green either way — which
 * is exactly why it would have shipped unnoticed. So the caption keeps its marketing job (what the
 * feature IS) and the alt does the alt job (what is IN the picture). Non-redundant, and a
 * non-sighted visitor gets strictly more.
 *
 * When re-shooting: RE-READ these three strings against the new pixels. They describe specific
 * on-screen content and nothing automated can tell you when they have gone stale.
 *
 * Issue #34 re-shot all three and read them back against the result. Two were wrong, in the two
 * different ways this rot happens:
 *   · shot 2's alt said "costs in yen and rupees" while every row in frame was yen. The list does
 *     hold both, so the sentence was true of the FEATURE and false of the PICTURE — and the alt's
 *     job, per the rule above, is the picture.
 *   · shot 3's caption said "offline trip map". D-271/D-274 retired that: the installed PWA does
 *     not carry the map engine, and the basemap was never in it at all. The app had stopped doing
 *     the thing the landing page was still promising.
 * Shot 1 was accurate and is unchanged.
 *
 * The v7 re-shoot moved shots 1 and 2 again, both times because the PICTURE changed under the
 * sentence: the planner's rows lost the coloured cards the shot-1 alt described (and only Morning
 * is in frame now), and the Nepal row is back inside shot 2's crop, so "yen and rupees" is true of
 * the picture again — the exact reverse of the correction above.
 *
 * Shot 3 is NOT from that re-shoot and is deliberately older than the other two: CARTO now stamps
 * "API KEY REQUIRED" across the free dark-matter tiles `lib/map-style.ts` requests, so a fresh
 * capture shows the watermark. Re-shoot it once the basemap serves clean tiles again.
 */
const SHOTS = [
  {
    id: 'landing-shot-1',
    fig: '01',
    src: '/images/landing/shot-1-day-planner.png',
    caption: 'The day planner, showing a morning in Kathmandu.',
    alt: 'A phone screen: the day planner with the trip’s days in a strip across the top and the first one selected, a quick-add field under it, and the day’s stops listed below a Morning heading — each one a row carrying its time, its place and a note.',
  },
  {
    id: 'landing-shot-2',
    fig: '02',
    src: '/images/landing/shot-2-expenses.png',
    caption: 'The shared expense list, splitting a dinner in Tokyo.',
    alt: 'A phone screen: the Expenses tab listing costs in yen and rupees, each row carrying a category tag, a note of what it was for, who logged it, and a “split 3” marker where the bill was shared.',
  },
  {
    id: 'landing-shot-3',
    fig: '03',
    src: '/images/landing/shot-3-map.png',
    caption: 'The trip map, showing one day’s stops in the order you planned them.',
    alt: 'A phone screen: the trip map over Kathmandu with Day 1 selected, its stops numbered along a dashed route, and coloured pins for places to see, eat and stay.',
  },
] as const;

/**
 * The closing block's INVERTED button, which is the one control on this page that is not the
 * shared `.btn` recipe: the ink becomes the fill and the chrome accent becomes the label, so it
 * has no lip and no gradient to inherit. Geometry is the recipe's (tap floor, r-1, the machine
 * label), and the ring keeps its OFFSET — the offset colour is --surface, so the indicator is a
 * volt ring on a dark gap: 11.56:1 ring-to-gap, and the gap is 11.17:1 against the mint fill.
 * "Tidying" the offset to match the block would paint volt straight onto mint at 1.03:1, an
 * invisible focus ring on the page's loudest button. The bad pairing is kept as a guard in
 * scripts/contrast-tokens.mjs.
 */
const CTA_INVERTED =
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-r1 px-6 font-machine text-t-label font-semibold uppercase tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** A raster that never decoded renders the SHAPE it was going to fill, hollow, and says so. */
function ShotFallback() {
  return (
    <span className="empty-frame absolute inset-0 flex items-end p-gut">
      <span className="pr pr--lo">Screen did not load</span>
    </span>
  );
}

export default function LandingPage({
  titleId,
  descId,
  notice,
  onCreate,
  onLogin,
  onJoin,
}: {
  /** The wall's `aria-labelledby` target — this view's <h1> carries it. */
  titleId: string;
  /** The wall's `aria-describedby` target — the lead paragraph carries it. */
  descId: string;
  /**
   * The wall's `?trip=` invitation acknowledgement, rendered FIRST inside the cover.
   *
   * It is a slot rather than a sibling because the cover bleeds to the panel's top edge: anything
   * the wall put above the landing would be covered by the photograph. Taking it here also puts
   * it where it belongs for that visitor — first thing, on the first fold. Nothing focusable may
   * be passed in: this renders above the log-in CTA, which must stay the panel's first button.
   */
  notice?: ReactNode;
  onCreate: () => void;
  onLogin: () => void;
  onJoin: () => void;
}) {
  /**
   * D-293 R7 — the entrance plays on the FIRST view of this surface per browser session and
   * never again. Asked of the motion system rather than decided here: `entranceFor` consults
   * reduced motion first (so there is no path through it that animates for someone who asked for
   * less), then the tier gate, then the session ledger.
   *
   * 🔴 THE ARGUMENT IS THE LITERAL `'/'`, NOT `usePathname()`, AND THAT IS THE POINT. The wall
   * shows on EVERY route for a logged-out visitor — it has no pathname term at all (see the mount
   * comment in itinerary-provider.tsx) — so the current path describes the page this surface is
   * covering, not the surface being rendered. Passing it would hand the front door whatever tier
   * the covered route happens to have, and a logged-out visitor arriving on a Tier-3 link would
   * silently get a different front door from one arriving at the root. The front door IS the `/`
   * surface, wherever it is shown.
   *
   * Lazy `useState` initialiser, not a bare call: the ledger write must happen once for the
   * mount, not once per render, and the answer has to survive a re-render (every CTA press sets
   * state in the parent) without the entrance re-firing.
   */
  const [entrance] = useState(() => entranceFor('/'));
  // `.animate-reveal-up` rests at opacity 1 (the keyframe supplies the entrance FROM 0), so the
  // 'present' branch is simply the class being absent — never an element held invisible.
  const reveal = entrance === 'animate' ? 'animate-reveal-up' : '';

  return (
    <div data-testid="landing-page" className="flex flex-col">
      {/* ── A · The cover ────────────────────────────────────────────────────────────────
          Full-bleed to the wall panel's border box, which is what the negative margins are:
          the panel carries p-6 / sm:p-8, so -mx-6 -mt-6 / sm:-mx-8 -mt-8 puts the photograph
          on the panel's own edge. `.door-cover` supplies the matching top radius, because a
          square corner would sit outside the panel's rounded one.

          BOTTOM-ALIGNED, and that is `.photo-header`'s `justify-content: flex-end` doing the
          work: it puts every text pixel in the dark end of the ramp. It is a legibility
          mechanism, not a layout preference. Do not centre this content. ── */}
      <div
        className="door-cover photo-header -mx-6 -mt-6 sm:-mx-8 sm:-mt-8"
        data-country="np"
        style={{ ['--photo-focus']: 'center 38%' } as CSSProperties}
      >
        {/* Boudhanath, Kathmandu — the great whitewashed dome, the gilded spire above it with
            the Buddha's eyes painted on the harmika, prayer-flag lines running from the finial
            out past the corners of the frame, a hard blue sky with high cloud, the shrine wall
            and its brass-topped niches across the foreground. The trip's first place, and the
            one photograph in the repo that reads as "this is where you are going" at a glance.

            DECORATIVE: alt="" plus aria-hidden on the wrapper, which is the ruled treatment for
            a duotone-graded, scrimmed backdrop. The <h1> beside it carries the meaning, and a
            screen reader announcing "Boudhanath stupa" over a headline about the trip would be
            adding noise. No `fallback` is passed deliberately: if the raster fails, the duotone
            layers collapse onto the page field and the cover degrades to a flat dark masthead,
            which is DARKER than the graded worst case the harness measures — the thing that made
            that case worst was the highlight cap the photograph supplied. ── */}
        <div className="photo-header__media" aria-hidden="true">
          {/* The Ken Burns wrapper — the image only, never the layers below it. `.photo-header__media
              > span` gives it inset:0; scaling anything that contains the scrim would slide the ramp
              relative to the text and the measured floor with it. */}
          <span className="door-kb">
            {/* `sizes` is the panel's real width, not `100vw`: the wall panel caps at max-w-5xl,
                which is 64rem on a 17px root = 1088px, so above ~1120px of viewport the cover box
                stops growing. Left at 100vw it would fetch the 1200px original on a desktop for a
                1088px box. `priority` because this is the LCP image of the first screen anyone
                sees. */}
            <OptimizedImage
              src="/images/featured/boudhanath.jpg"
              alt=""
              fill
              sizes="(min-width: 1120px) 1088px, 100vw"
              priority
            />
          </span>
          <span className="photo-header__duo-lo" />
          <span className="photo-header__duo-hi" />
          <span className="photo-header__scrim" />
        </div>

        <div className="photo-header__body">
          <div className={`mx-auto flex w-full max-w-[1200px] flex-col items-start gap-4 px-gut ${reveal}`}>
            {notice}
            <p className="pr pr--l text-primary">Dec 2026 &mdash; Jan 2027</p>
            {/* Instrument Serif at the editorial display step. WEIGHT 400 IS NOT AN OMISSION:
                the family ships 400 only, and pairing `font-display` with a bold utility gets a
                browser-synthesised bold. The step pins the weight so nobody has to remember. */}
            <h1
              id={titleId}
              className="max-w-[13ch] font-display text-editorial-xl text-ink-hi"
            >
              Every day of the trip, in one place.
            </h1>
            <p id={descId} className="max-w-[46ch] text-t-lead leading-relaxed text-ink-mid">
              {/*-D: was "Twenty-two days" — the trip is Dec 9 → Jan 9, i.e. 32 days, which is what
                  `first-run-tour.tsx` and `map-section.tsx` already say. NOT derived from the trip-date
                  source on purpose: the ZERO-LIVE-TRIP-DATA rule above (and the grep guard that pins it)
                  forbids this file importing the content pack, so a literal is the only correct fix here. */}
              Kathmandu in December, Japan for New Year. Thirty-two days, two countries, one plan your
              whole group can see &mdash; and it still works when you have no signal.
            </p>

            {/* (INTAKE-03) — LOG IN IS THE PRIMARY PATH, and it is FIRST IN THE DOM.
                Both facts are load-bearing and neither is cosmetic:
                  · the filled `.btn` vs the `.btn--2` outline is the decided visual demotion
                    ("log in becomes the primary CTA, Create an account demotes to secondary").
                  · DOM ORDER is what actually moves FOCUS. The wall's focus effect
                    (`token-gate.tsx`) takes `panel.querySelector('button:not([disabled])')` — the
                    FIRST enabled button in the panel — so a keyboard/screen-reader visitor entered on
                    "Create an account" purely because it was written first. Swapping the two <button>
                    elements (not just their classes) is the fix; `e2e/login.spec.ts` and
                    `lib/__tests__/s345-front-door.test.ts` both assert `document.activeElement`, so a
                    future edit that reorders these back fails rather than silently regressing.
                Signup is NOT removed: it is still one click here, still the closing CTA below, and
                still the always-rendered toggle inside the auth card. */}
            <div className="mt-2 flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onLogin}
                data-testid="landing-cta-login"
                className="btn px-6"
              >
                I have a key &mdash; log in
              </button>
              {/* The secondary's edge is --border-ui, not --border — that is `.btn--2`'s own
                  border, and it is why the outline shape is legal over a photograph. --border is
                  DECORATIVE (1.99:1 on the page field) and this edge is the only thing saying
                  "control": over the cover it is also the only thing separating the button from
                  the picture, so it is measured against the graded worst-case pixel at 1.4.11's
                  3:1. */}
              <button
                type="button"
                onClick={onCreate}
                data-testid="landing-cta-create"
                className="btn btn--2 px-6"
              >
                Create an account
              </button>
            </div>
            {/* (#70) — THIS CTA IS THE SIGNUP PATH, and the line under it is load-bearing copy.
                It names an audience holding a TRIP TOKEN. The auth card's key field takes a USER
                TOKEN — two different credentials that are never mixed (D-239) — so pointing this at
                log in asked a visitor for the one credential they cannot have: the D-296 probe rejects
                it, and on a dormant/offline build it instead admits them to a working-but-empty
                account. A Trip Token is entered on the Trips page, which is exactly where the create
                path lands, so the honest route is "make an account, then add the trip".
                The note says that BEFORE the click and is wired to the button with `aria-describedby`,
                so a screen reader hears it as part of the control rather than as stray text after it.
                Do NOT drop the note and keep the routing: on its own the routing looks like the CTA
                ignoring what it just promised.
                The note is ink-MID and not the floor tier: it sits over the photograph, where the
                floor tier is banned outright (the rule issue #26 added, measured, and guarded).
                Hover goes to --text-hi rather than to a dimmer volt: `text-primary` resolves through
                a bare `var()`, so an opacity modifier on it emits no rule at all. */}
            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={onJoin}
                data-testid="landing-cta-join"
                aria-describedby="landing-join-note"
                className="inline-flex min-h-tap items-center rounded-r1 px-1 font-machine text-t-label font-semibold uppercase tracking-[0.11em] text-primary underline underline-offset-4 transition-colors hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Someone shared a trip with me
              </button>
              <p
                id="landing-join-note"
                className="max-w-md px-1 text-t-sm leading-relaxed text-ink-mid"
              >
                Make an account first &mdash; then add their Trip Token on your Trips page.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── B · The fact strip. Four readings, in the app's own instrument cells, ruled straight
          onto the bottom edge of the cover. ── */}
      <dl className="cells cells--4 -mx-6 sm:-mx-8" data-testid="landing-facts">
        {FACTS.map(({ label, value, foot }) => (
          <div key={label} className="cell">
            <dt className="l">{label}</dt>
            <dd className="v">{value}</dd>
            <dd className="f">{foot}</dd>
          </div>
        ))}
      </dl>

      {/* ── C · What's on board. The systems annunciator, not a feature grid. Every row states
          its condition in words, which is what makes the mark redundant by design rather than
          the only cue. ── */}
      <section
        aria-labelledby="landing-features-heading"
        data-testid="landing-onboard"
        className="-mx-6 mt-12 sm:-mx-8"
      >
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-features-heading">What&rsquo;s on board</h2>
          <span className="sub">{ONBOARD.length} tools &middot; one trip</span>
        </div>
        <ul className="sys sm:grid sm:grid-cols-2">
          {ONBOARD.map(({ name, cond, n, unit }) => (
            <li key={name} className="r" data-s="struck" aria-label={`${name}. ${cond}. ${n ? `${n} ` : ''}${unit}.`}>
              <span aria-hidden="true" className="mk mk--struck" />
              <span className="min-w-0">
                <span className="nm block">{name}</span>
                <span className="cond block break-words">{cond}</span>
              </span>
              <span className="val">
                {n && <b>{n}</b>}
                <i>{unit}</i>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── D · The two chapters. The ONE place country hue is allowed. ────────────────
          Full-bleed to the panel edge and radius 0 — these two do touch what passes for the
          viewport edge here, so there is nothing to round. A 1px gap over the border fill is
          what draws the divider between them at sm and up: the "border" is the background
          showing through, so there is no edge that can drift from the surface it sits on. ── */}
      <section aria-labelledby="landing-legs-heading" className="-mx-6 mt-12 sm:-mx-8">
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-legs-heading">Two countries, one trip</h2>
          <span className="sub">Two plates</span>
        </div>
        <div
          data-testid="landing-split-band"
          className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2"
        >
          {CHAPTERS.map(({ no, country, accent, src, focus, eyebrow, title, body, when }) => (
            <div key={no} className="bg-surface">
              <div
                className="photo-header"
                data-country={country}
                style={{ ['--photo-focus']: focus } as CSSProperties}
              >
                <div className="photo-header__media" aria-hidden="true">
                  {/* Half the capped panel above 640px — see the cover's note on why this is a px
                      figure and not a vw one. No `priority`: these are below the fold. */}
                  <OptimizedImage src={src} alt="" fill sizes="(min-width: 640px) 544px, 100vw" />
                  <span className="photo-header__duo-lo" />
                  <span className="photo-header__duo-hi" />
                  <span className="photo-header__scrim" />
                </div>
                <div className="photo-header__body">
                  <div className={`px-gut ${reveal}`}>
                    <p className="pr">{eyebrow}</p>
                    {/* The numeral is the chapter's identity mark and it is large display text, so
                        its bar is 3:1 — measured there, over the worst-case pixel each grade can
                        produce, in scripts/contrast-tokens.mjs. It is not a heading and carries no
                        meaning the title beside it does not, so it is hidden from assistive tech
                        rather than read out as a stray number. */}
                    <p
                      aria-hidden="true"
                      className="mt-1 font-display text-editorial-lg leading-none"
                      style={{ color: accent }}
                    >
                      {no}
                    </p>
                    <h3 className="text-display-lg text-ink-hi">{title}</h3>
                    <p className="mt-2 max-w-[42ch] text-t-sm leading-relaxed text-ink-mid">
                      {body}
                    </p>
                  </div>
                </div>
              </div>
              {/* The caption is a ruled line BENEATH the plate, never over it — so it sits on the
                  page field, where the floor tier is legal again. */}
              <div className="capline">
                <span className="pr">Plate {no}</span>
                <span className="pr pr--lo">{title}</span>
                <span className="pr pr--lo">{when}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── E · The contact sheet ──────────────────────────────────── */}
      <section aria-labelledby="landing-shots-heading" className="-mx-6 mt-12 sm:-mx-8">
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-shots-heading">What it looks like</h2>
          <span className="sub">{SHOTS.length} figures</span>
        </div>
        <ul className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 px-gut sm:grid-cols-3">
          {SHOTS.map(({ id, fig, src, caption, alt }) => (
            <li key={id}>
              <figure data-testid={id}>
                {/* The `${id}-slot` testid stays on the BOX, not the <img> — `e2e/login.spec.ts`
                    measures this element's boundingBox and asserts height > width. Keeping
                    `aspect-[390/844]` here (rather than relying on the image's intrinsic size)
                    means the box is phone-shaped before the lazy image decodes, so the check is
                    measuring the reserved layout and CLS stays at zero.
                    `aria-hidden` is GONE: it was right for an empty placeholder and wrong for a
                    real image with meaningful alt text, which assistive tech must reach.
                    A raster that never decodes falls back to the hollow frame at FULL SIZE with
                    its condition in words — OptimizedImage drops the <img> on error. No broken
                    image icon, no empty hole, and no silent grey box either. */}
                <div
                  data-testid={`${id}-slot`}
                  className="relative aspect-[390/844] w-full overflow-hidden rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low"
                >
                  <OptimizedImage
                    src={src}
                    alt={alt}
                    fill
                    className="h-full w-full object-cover"
                    fallback={<ShotFallback />}
                  />
                </div>
                <figcaption className="capline items-baseline px-0">
                  <span className="pr">Fig {fig}</span>
                  <span className="text-t-sm leading-relaxed text-ink-mid">{caption}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>

      {/* ── F · How a trip reaches another person ─────────────────────────────────────── */}
      <section
        aria-labelledby="landing-token-heading"
        data-testid="landing-tokens"
        className="-mx-6 mt-12 sm:-mx-8"
      >
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-token-heading">Trips move as a token</h2>
          <span className="sub">No member list</span>
        </div>
        <div className="mx-auto max-w-[1200px] px-gut">
          <p className="max-w-[64ch] text-t-body leading-relaxed text-ink-mid">
            There is nobody to invite and no list to be added to. A trip has one string attached to
            it, and whoever holds that string opens the same plan you are looking at &mdash; so you
            send it the way you already talk to each other. Two keys, two jobs, and they are never
            the same key.
          </p>
        </div>
        <ul className="list mt-4">
          {TOKENS.map(({ name, chip, what, rule }) => (
            <li key={name} className="r" style={{ ['--cols']: '7.5rem 1fr' } as CSSProperties}>
              <span className={`chip ${chip}`}>{name}</span>
              <div className="min-w-0">
                <h3>{what}</h3>
                <span className="mt">{rule}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── G · The closing CTA ──────────────────────────────────────────────────────────
          A flat mint plate, full-bleed to the panel edge. Everything on it is --on-accent,
          never white, and the button INVERTS — see CTA_INVERTED for the focus-ring geometry
          that pairing depends on. ── */}
      <div
        className="-mx-6 mt-12 flex flex-col items-center gap-4 px-gut py-10 text-center sm:-mx-8"
        style={{ background: 'var(--mint)', color: 'var(--on-accent)' }}
      >
        <span className="font-machine text-t-micro font-semibold uppercase tracking-[0.14em]">
          No subscription &middot; no card
        </span>
        <p className="text-display-xl">Start the countdown.</p>
        <p className="max-w-[38ch] text-t-body leading-relaxed">
          No email, no password. Just a key you keep.
        </p>
        <button
          type="button"
          onClick={onCreate}
          data-testid="landing-cta-create-footer"
          className={CTA_INVERTED}
          style={{ background: 'var(--on-accent)', color: 'var(--volt)' }}
        >
          Create an account
        </button>
      </div>

      {/* ── H · The sign-off. A plain <div>, NOT <footer> — see the landmark note at the top.
          No date finer than a month, for the reason recorded there. ── */}
      <div className="mt-10 text-center">
        <span className="pr pr--lo">
          Nepal &times; Japan &middot; Dec 2026 &mdash; Jan 2027
        </span>
      </div>
    </div>
  );
}
