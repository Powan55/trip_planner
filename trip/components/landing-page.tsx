'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarRange, Coins, PlaneTakeoff } from 'lucide-react';
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
 * cities and never days.
 *
 * 🔴 COLOUR: semantic tokens ONLY (the three ink tiers, the six accents, the two country
 * gradients, `--on-accent`, `border-border`, `ring-ring`). No status-gold class and no raw hex
 * anywhere (same grep rule as above — the literals are omitted on purpose). A NEW file is
 * structurally invisible to every palette sweep whose worklist predates it — that is exactly how
 * `sign-out-confirm.tsx:102` shipped a gold focus ring no sweep could reach.
 *
 * ── ISSUE #25, THE REDESIGN, AND WHAT IT DID NOT TOUCH ─────────────────────────────────────
 *
 * The structure was sound and was RESTYLED, not rebuilt. What was wrong with it was that every
 * surface on it was the same near-black rectangle with a 1.24:1 hairline, the only colour was one
 * cyan CTA, and the ~84 MB of genuine photography already in the repo was not on it at all.
 *
 * The cover and the two chapters REUSE `.photo-header` from globals.css — the recipe issue #3
 * built for the Tier-2 page headers — element for element: the same media stack, the same duotone
 * pair, the same two-ramp scrim, the same 92px-padding/68px-stop contract that makes "every text
 * pixel lands at floor alpha >= .62" a number instead of a layout hope. Deliberately NOT a third
 * scrim system: the composites that recipe produces (`npHdrMin` / `jpHdrMin` in
 * scripts/contrast-tokens.mjs) are already measured, so every pairing this page adds is measured
 * against them there rather than asserted here. The only CSS this page adds is `.door-cover`
 * (taller, and rounded at the top because the "viewport edge" here is a rounded dialog panel) and
 * `.door-kb` (the one loop).
 *
 * WHAT WAS FROZEN, and each has teeth:
 * - Log in is the primary CTA and it is FIRST IN THE DOM. `token-gate.tsx`'s focus effect takes
 *   `panel.querySelector('button:not([disabled])')` — the first enabled button — so DOM ORDER is
 *   what moves focus. `e2e/login.spec.ts` and `lib/__tests__/s345-front-door.test.ts` both assert
 *   `document.activeElement`. Nothing above those two buttons may be a <button>: the eyebrow, the
 *   <h1> and the lead are all non-focusable, and the cover carries NO nav bar of its own (the
 *   design spec's cover nav puts a "Log in" ghost button above the fold, which would take entry
 *   focus off the primary CTA — it is the one part of the spec's cover that is not built).
 * - The <h1> copy is unchanged, and that is not laziness. Both specs pin the exact string; the
 *   spec's own headline is the prototype's, and the prototype is not the live contract.
 * - Plain <div>s, NOT <header>/<footer>. Those map to the banner/contentinfo LANDMARKS, and axe
 *   caught the duplicate contentinfo at both breakpoints back when the app's own chrome was still
 *   mounted behind the wall. Landmarks inside a modal dialog buy nothing anyway.
 * - The three screenshot slots keep their testids, their phone aspect ratio and their distinct
 *   alt/caption pair (see the SHOTS comment). They are restyled and not remeasured.
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
 * The three colour blocks — the loudest device on the page, and the main answer to "bland".
 * Each fill is a country/celebration gradient token and every text node on them is `--on-accent`,
 * never white: white on marigold measures 1.59:1 and this is the rule that stops it. Every stop of
 * every gradient here is measured against the ink in scripts/contrast-tokens.mjs, and it is the
 * STOPS that are measured rather than an average, because a gradient under a glyph is whichever
 * stop happens to fall there.
 *
 * The lucide icons stay (they are already a dependency and already imported); what changed is that
 * they no longer paint `text-primary` — marigold on a marigold gradient — but the ink, like every
 * other mark on the block.
 */
const FEATURES = [
  {
    icon: CalendarRange,
    fill: 'var(--grad-nepal)',
    title: 'Plan each day',
    body: "Drag things into the order you'll actually do them.",
  },
  {
    icon: Coins,
    fill: 'var(--grad-japan)',
    title: 'Split the money',
    body: 'Log what you paid in yen or rupees; see who owes who.',
  },
  {
    icon: PlaneTakeoff,
    fill: 'var(--grad-celebrate)',
    // 🔴 — READ BEFORE "SIMPLIFYING" THIS SENTENCE. It has been wrong twice in both
    // directions, so the exact scope is written down:
    // · The plan is fully offline (localStorage + the SW precache).
    // · The map ENGINE now ships with the install too, so the
    // "open the map online once" clause this replaced is obsolete.
    // · The TILES are NOT offline and are not going to be. They come from
    // basemaps.cartocdn.com — cross-origin, which the SW passes through uncached by
    // design, and bulk-caching a free keyless CDN abuses it. So offline you get the
    // navy canvas, your marker circles and the day route line, with no street imagery.
    // Hence "pins and route" (true) and "the map background needs signal" (true). Do NOT
    // shorten this to "the map works offline" — that is the claim a user disproves at
    // 35,000 feet.
    title: 'Works on the plane',
    body: 'Your plan and the map are saved on your phone. Offline you still get your pins and your route — only the map background needs signal.',
  },
] as const;

/**
 * The two chapters — the country split band, restyled from a 14 % tint into two photographic
 * bands. It keeps the `landing-split-band` testid because it is the same section doing the same
 * job, and `e2e/login.spec.ts` asserts it is visible.
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
  },
] as const;

const STEPS = [
  { title: 'Make an account', body: '10 seconds, no email.' },
  { title: 'Add your days and places', body: 'One day at a time, or all at once.' },
  { title: 'Share one link with your friends', body: 'They see the same plan you do.' },
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
 */
const SHOTS = [
  {
    id: 'landing-shot-1',
    src: '/images/landing/shot-1-day-planner.png',
    caption: 'The day planner, showing a morning in Kathmandu.',
    alt: 'A phone screen: the day planner for Day 1 in Kathmandu, with a quick-add field at the top and the day’s timed stops below it, grouped under Morning and Afternoon, each on its own coloured card.',
  },
  {
    id: 'landing-shot-2',
    src: '/images/landing/shot-2-expenses.png',
    caption: 'The shared expense list, splitting a dinner in Tokyo.',
    alt: 'A phone screen: the Expenses tab listing costs in yen, each row carrying a category tag, a note of what it was for, who logged it, and a “split 3” marker where the bill was shared.',
  },
  {
    id: 'landing-shot-3',
    src: '/images/landing/shot-3-map.png',
    caption: 'The trip map, showing one day’s stops in the order you planned them.',
    alt: 'A phone screen: the trip map over Kathmandu with Day 1 selected, its stops numbered along a dashed route, and coloured pins for places to see, eat and stay.',
  },
] as const;

const CTA_BASE =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/**
 * Section headings. One place, so the three of them cannot drift apart.
 *
 * 🔴 NO `font-display` HERE, and it is a correction rather than an omission. `display-lg` is a
 * SANS display step and pins weight 800; Instrument Serif ships weight 400 and nothing else, so
 * `font-display text-display-lg` asks the browser to SYNTHESISE a bold — the live defect
 * tailwind.config.ts warns about beside these keys. The serif face is used on this page in exactly
 * the two places its own steps exist for (`editorial-xl` on the <h1>, `editorial-lg` on the chapter
 * numerals), both of which pin weight 400. Everything else is Geist, which really has an 800.
 */
const SECTION_H2 = 'text-display-lg text-ink-hi';

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
    <div data-testid="landing-page" className="flex flex-col gap-12 sm:gap-16">
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
          <div className={`mx-auto flex w-full max-w-[1200px] flex-col items-start gap-4 px-gutter ${reveal}`}>
            {notice}
            <p className="text-eyebrow uppercase text-primary">Dec 2026 &mdash; Jan 2027</p>
            {/* Instrument Serif at the editorial display step. WEIGHT 400 IS NOT AN OMISSION:
                the family ships 400 only, and pairing `font-display` with a bold utility gets a
                browser-synthesised bold. The step pins the weight so nobody has to remember. */}
            <h1
              id={titleId}
              className="max-w-[13ch] font-display text-editorial-xl text-ink-hi"
            >
              Every day of the trip, in one place.
            </h1>
            <p id={descId} className="max-w-[46ch] text-base leading-relaxed text-ink-mid">
              {/*-D: was "Twenty-two days" — the trip is Dec 9 → Jan 9, i.e. 32 days, which is what
                  `first-run-tour.tsx` and `map-section.tsx` already say. NOT derived from the trip-date
                  source on purpose: the ZERO-LIVE-TRIP-DATA rule above (and the grep guard that pins it)
                  forbids this file importing the content pack, so a literal is the only correct fix here. */}
              Kathmandu in December, Japan for New Year. Thirty-two days, two countries, one plan your
              whole group can see &mdash; and it still works when you have no signal.
            </p>

            {/* (INTAKE-03) — LOG IN IS THE PRIMARY PATH, and it is FIRST IN THE DOM.
                Both facts are load-bearing and neither is cosmetic:
                  · `bg-primary` vs the outline is the decided visual demotion ("log in becomes
                    the primary CTA, Create an account demotes to secondary").
                  · DOM ORDER is what actually moves FOCUS. The wall's focus effect
                    (`token-gate.tsx`) takes `panel.querySelector('button:not([disabled])')` — the
                    FIRST enabled button in the panel — so a keyboard/screen-reader visitor entered on
                    "Create an account" purely because it was written first. Swapping the two <button>
                    elements (not just their classes) is the fix; `e2e/login.spec.ts` and
                    `lib/__tests__/s345-front-door.test.ts` both assert `document.activeElement`, so a
                    future edit that reorders these back fails rather than silently regressing.
                    #25 inherits the constraint whole: the marigold fill moved onto the log-in button
                    and the outline onto create, in place, with the elements where they were.
                Signup is NOT removed: it is still one click here, still the closing CTA below, and
                still the always-rendered toggle inside the auth card. */}
            <div className="mt-2 flex flex-col gap-3 self-stretch sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onLogin}
                data-testid="landing-cta-login"
                className={`${CTA_BASE} bg-primary text-primary-foreground hover:bg-primary/90`}
              >
                I have a key &mdash; log in
              </button>
              {/* The secondary's edge is --border-ui, not --border. --border is DECORATIVE (1.99:1
                  on the page field) and this edge is the only thing saying "control" — over a
                  photograph it is also the only thing separating the button from the picture, so it
                  takes the interactive boundary token and is measured against the graded worst-case
                  pixel at 1.4.11's 3:1. */}
              <button
                type="button"
                onClick={onCreate}
                data-testid="landing-cta-create"
                className={`${CTA_BASE} border border-[color:var(--border-ui)] text-ink-hi hover:bg-muted/40`}
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
                floor tier is banned outright (the rule issue #26 added, measured, and guarded). */}
            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={onJoin}
                data-testid="landing-cta-join"
                aria-describedby="landing-join-note"
                className="inline-flex min-h-[44px] items-center rounded-lg px-1 text-sm font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Someone shared a trip with me
              </button>
              <p
                id="landing-join-note"
                className="max-w-md px-1 text-sm leading-relaxed text-ink-mid"
              >
                Make an account first &mdash; then add their Trip Token on your Trips page.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── B · What you get. The three colour blocks. ────────────────────────────────── */}
      <section aria-labelledby="landing-features-heading" className="flex flex-col gap-5">
        <h2 id="landing-features-heading" className="sr-only">
          What the planner does
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, fill, title, body }) => (
            <li
              key={title}
              className="flex min-h-[148px] flex-col rounded-2xl p-6 sm:min-h-[206px]"
              style={{ background: fill, color: 'var(--on-accent)' }}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <h3 className="mt-4 text-display-md">{title}</h3>
              <p className="mt-2 max-w-[34ch] text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── C · The two chapters. The ONE place country hue is allowed. ────────────────
          Full-bleed to the panel edge and radius 0 — these two do touch what passes for the
          viewport edge here, so there is nothing to round. A 1px gap over the border fill is
          what draws the divider between them at sm and up: the "border" is the background
          showing through, so there is no edge that can drift from the surface it sits on. ── */}
      <section aria-labelledby="landing-legs-heading" className="flex flex-col gap-5">
        <h2 id="landing-legs-heading" className={SECTION_H2}>
          Two countries, one trip
        </h2>
        <div
          data-testid="landing-split-band"
          className="-mx-6 grid grid-cols-1 gap-px bg-border sm:-mx-8 sm:grid-cols-2"
        >
          {CHAPTERS.map(({ no, country, accent, src, focus, eyebrow, title, body }) => (
            <div
              key={no}
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
                <div className={`px-gutter ${reveal}`}>
                  <p className="text-eyebrow uppercase text-ink-mid">{eyebrow}</p>
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
                  <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-ink-mid">{body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── D · Screenshot slots ──────────────────────────────────────── */}
      <section aria-labelledby="landing-shots-heading" className="flex flex-col gap-5">
        <h2 id="landing-shots-heading" className={SECTION_H2}>
          What it looks like
        </h2>
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {SHOTS.map(({ id, src, caption, alt }) => (
            <li key={id}>
              <figure data-testid={id} className="flex flex-col gap-2">
                {/* The `${id}-slot` testid stays on the BOX, not the <img> — `e2e/login.spec.ts`
                    measures this element's boundingBox and asserts height > width. Keeping
                    `aspect-[390/844]` here (rather than relying on the image's intrinsic size)
                    means the box is phone-shaped before the lazy image decodes, so the check is
                    measuring the reserved layout and CLS stays at zero.
                    `aria-hidden` is GONE: it was right for an empty placeholder and wrong for a
                    real image with meaningful alt text, which assistive tech must reach.
                    gradient stays on the BOX, so a raster that fails to load degrades to
                    exactly the old placeholder — OptimizedImage drops the <img> on error
                    and the box's own fill shows through. No broken-image icon, no empty hole. */}
                <div
                  data-testid={`${id}-slot`}
                  className="relative aspect-[390/844] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-muted/50 to-muted/10"
                >
                  <OptimizedImage src={src} alt={alt} fill className="h-full w-full object-cover" />
                </div>
                <figcaption className="text-xs leading-relaxed text-ink-mid">{caption}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>

      {/* ── E · How it works ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="landing-steps-heading" className="flex flex-col gap-5">
        <h2 id="landing-steps-heading" className={SECTION_H2}>
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map(({ title, body }, i) => (
            <li key={title} className="glass-subtle rounded-2xl p-5">
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border font-display text-lg text-primary"
              >
                {i + 1}
              </span>
              <h3 className="mt-3 text-base font-semibold text-ink-hi">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-mid">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── F · The closing CTA ──────────────────────────────────────────────────────────
          A mint block at the loudest container radius, and one of only two --r-xl containers in
          the product. Everything on it is --on-accent, and the button INVERTS: the ink becomes
          the fill and marigold becomes the label, which is the one place on this page a saturated
          accent is used as text on a dark fill rather than as a fill under the ink. Both
          directions are measured. ── */}
      <div
        className="flex flex-col items-center gap-4 rounded-3xl px-6 py-9 text-center"
        style={{ background: 'var(--mint)', color: 'var(--on-accent)' }}
      >
        <p className="text-display-xl">Start the countdown.</p>
        <p className="max-w-[38ch] text-sm leading-relaxed">
          No email, no password. Just a key you keep.
        </p>
        <button
          type="button"
          onClick={onCreate}
          data-testid="landing-cta-create-footer"
          // CTA_BASE unchanged, ring OFFSET included, and that is deliberate rather than
          // inherited. The offset colour is --surface, so the focus indicator is a marigold ring
          // on a dark gap: 12.13:1 ring-to-gap, and the gap is 11.06:1 against the mint fill.
          // "Tidying" the offset to match the block would paint marigold straight onto mint —
          // 1.10:1, an invisible focus ring on the page's loudest button. Measured in
          // scripts/contrast-tokens.mjs, where the bad pairing is kept as a guard.
          className={CTA_BASE}
          style={{ background: 'var(--on-accent)', color: 'var(--marigold)' }}
        >
          Create an account
        </button>
      </div>

      {/* ── G · The sign-off. A plain <div>, NOT <footer> — see the landmark note at the top.
          No date finer than a month, for the reason recorded there. ── */}
      <div className="text-center text-eyebrow uppercase text-ink-lo">
        Nepal &times; Japan &middot; Dec 2026 &mdash; Jan 2027
      </div>
    </div>
  );
}
