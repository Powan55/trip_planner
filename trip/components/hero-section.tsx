'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { m, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { Calendar, Compass, ChevronDown, Plane } from 'lucide-react';
import { TRIP_START, TRIP_DATE_LABEL, formatDateLong } from '@/lib/trip-data';
import { computeCountdown, type Countdown } from '@/lib/countdown';
import { FADE_FLOOR } from '@/lib/motion';
import { ringFraction } from '@/lib/countdown-ring';
import { getNow, getTodayInTrip, getNowAtTrip, type TripToday } from '@/lib/trip-now';
import { heroImageForLeg, HERO_DEFAULT, HERO_JAPAN } from '@/lib/hero-image';
import { isDefaultTrip } from '@/core/trips';
import { isPostTrip } from '@/core/recap/model';
import { getKnownTrip } from '@/core/trips/registry';
import { vibeFor } from '@/core/trips/custom';
import { getActiveTripId } from '@/core/storage/gateway';
import OptimizedImage from '@/components/optimized-image';
import CountdownRing from '@/components/countdown-ring';
import { useCountUp } from '@/hooks/use-count-up';
import { useEnterTravelMode } from '@/hooks/use-travel-mode';
import { haptic } from '@/lib/haptics';
import { crossedIntoComplete } from '@/lib/celebration';
import CelebrationBurst from '@/components/celebration-burst';

// The calendar buckets. A unit that is ZERO is not rendered (issue #11). The producer
// carries maximally and reports the true value of every unit, and dropping the zeros is
// this surface's job. That is what killed "29 days, 0 weeks".
const COUNTDOWN_DATE_UNITS = [
  { key: 'months', label: 'Months' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'days', label: 'Days' },
] as const;

// The clock. Always rendered, zero or not: it ticks, so a cell reading 00 corrects itself
// within the minute, while dropping it would reflow the whole row every minute. A running
// clock reading 00 is a clock, not the stale zero the issue is about.
const COUNTDOWN_CLOCK_UNITS = [
  { key: 'hours', label: 'Hours' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'seconds', label: 'Seconds' },
] as const;

/**
 * One-time eased count-up reveal for a single hero countdown number, then a clean
 * handoff to the LIVE value. PRESENTATIONAL ONLY — `live` is the exact value
 * computed by `computeCountdown`; this never recomputes anything.
 *
 * While revealing, the eased fraction tracks the current `live` value so the final
 * frame lands on it exactly; once `done`, we render `live` directly so the ticking
 * value (e.g. seconds) passes through with no desync (the live tick is never
 * throttled or delayed). Under reduced motion the hook reports `done` immediately,
 * so `live` shows at once with no count-up.
 *
 * `format` keeps each surface's exact presentation — `padStart(2,'0')` for the
 * six unit cells, identity for `totalDays`.
 */
function CountUpNumber({
  live,
  active,
  format,
}: {
  live: number;
  active: boolean;
  format: (n: number) => string | number;
}) {
  const { value, done } = useCountUp(live, active);
  return <>{format(done ? live : value)}</>;
}

const padUnit = (n: number) => String(n).padStart(2, '0');
const identity = (n: number) => n;

/**
 * Per-FRAME crop and highlight cap for the hero photograph (issue #89), keyed by the
 * resolved `src` so there is exactly ONE answer to "which leg is this" — the same
 * `heroImageForLeg()` call drives the photograph, the crop and the cap colour.
 *
 * `narrow`/`wide` feed --hero-focus-narrow / --hero-focus, the `object-position` knob
 * `.hero-photo-wrap img` reads (globals.css). It is the same mechanism
 * `.photo-header__media img` uses via --photo-focus, deliberately: two crop knobs with
 * different names doing the same job is how one of them silently rots.
 *
 * WHY EACH NUMBER. `object-cover` on a landscape source in a portrait box crops
 * HORIZONTALLY; in a wide desktop box it crops VERTICALLY. So the two breakpoints are
 * not the same photograph tightened, they are two different axes, and one value cannot
 * serve both.
 *
 *  - Ama Dablam (1920x1280, peak at x 50% / y 11%): measured off contact sheets against
 *    the vertically-centred content block. `center 38%` at >= 768 lifts the vertical
 *    window off the valley floor and onto the summit — measured in the browser, a
 *    1440x900 window shows source y 7.5%-87.8% instead of 14.9%-95.2%. `center 32%`
 *    below 768 is the same correction for a tighter box. Note that on a PORTRAIT phone
 *    the vertical value is inert (the 1.5-aspect source is taller than the box needs,
 *    so the crop is entirely horizontal and the peak is already at x 50%); it earns its
 *    keep in landscape and on short wide windows.
 *
 *  - Shinjuku (1920x1023): Fuji occupies x 23.4%-40.6% (peak 31.8%). MEASURED IN THE
 *    BROWSER at 390x844, the hero box is 390x715 and shows a 29.0%-wide slice of the
 *    source — at the default `center` that slice is x 35.5%-64.5%, so all but the last
 *    5 points of the mountain is outside the frame. That is what the design review
 *    objected to. x=30% moves the window to 21.3%-50.3% and the whole cone is in. It
 *    costs the Mode Gakuen Cocoon tower (x 51%-55%), and that is the compromise — the
 *    mountain is why this frame was chosen at all. Also checked at 320 (21.7%-49.3%)
 *    and 430 (21.4%-50.0%): the cone survives across the phone range.
 *    At >= 768 the box is wide enough to hold both (768x1024 measures 22.8%-68.5%), so
 *    `42% center` only nudges the composition left of dead centre; past the source's
 *    1.88 aspect the horizontal value goes inert entirely (1440x900 measures
 *    0.2%-99.7%) because the full width is on screen and the crop moves to y.
 *
 * `cap` is the --duo-*-high brightness clamp `.hero-cap` paints. Both values already
 * exist as tokens; this adds no colour.
 */
const HERO_FRAME: Record<string, { narrow: string; wide: string; cap: string }> = {
  [HERO_DEFAULT]: { narrow: 'center 32%', wide: 'center 38%', cap: 'var(--duo-np-high)' },
  [HERO_JAPAN]: { narrow: '30% center', wide: '42% center', cap: 'var(--duo-jp-high)' },
};

/**
 * — Hero entrance reveal variants.
 *
 * A single cohesive, staggered reveal for the hero content block, replacing the
 * old per-element `delay` props. The container staggers its direct children; each
 * child rises a few px while fading in with a premium ease.
 *
 * Reduced-motion: a scroll/translate reveal is NOT gated by
 * the app's declarative `<MotionConfig reducedMotion="user">` automatically for
 * the `y` offset we author here, so we swap to opacity-only variants when the user
 * prefers reduced motion (`hiddenReduced`/`showReduced`) — no translate, instant
 * settle. Either way the content ends in the exact same resting position.
 */
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const itemVariants = {
  // FLOORED fade (was a opacity PIN at 1 — a slide that never
  // faded). The reveal now runs FADE_FLOOR → 1 instead of 1 → 1. The axe-race guarantee
  // bought is intact: the scan runs WITHOUT reduced motion and could sample this
  // mid-animation (it once flagged the "/plan/" CTA at color-contrast 1.49 on a real
  // post- run), but the darkest frame is now FADE_FLOOR, not ~0.5, which holds ≥AA
  // for the muted copy in this subtree. Reduced-motion branch below is untouched.
  hidden: { opacity: FADE_FLOOR, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: REVEAL_EASE },
  },
};

// Opacity-only fallback for prefers-reduced-motion: no translate, quick settle.
const itemVariantsReduced = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4 } },
};

export default function HeroSection() {
  const [mounted, setMounted] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);
  // Seeded from the REAL clock in a lazy initializer, not from a zeroed placeholder that the
  // mount effect then corrects (issue #54 D). A zeroed countdown renders no months/weeks/days
  // cells at all (they are dropped when zero, issue #11), so the first frame was ~212px
  // shorter than the second and the whole vertically-centred block jumped — measured 0.11 of
  // cold CLS on its own. This component is `dynamic({ssr:false})`, so its first render is
  // already client-side: there is no server HTML to mismatch, and `getNow()` is a cached,
  // window-guarded read that is safe during render. The 1s interval below still owns every
  // subsequent value.
  const [timeLeft, setTimeLeft] = useState<Countdown>(() => computeCountdown(TRIP_START, getNow()));
  // Travel mode: when the app clock lands inside the trip window the hero
  // swaps the countdown grid for a "Day N — {city}" panel. Seeded from the same first clock
  // read (see above) so an in-trip load paints the Day-N panel directly instead of showing
  // the countdown grid for a frame; recomputed on the same 1s tick as the countdown so it
  // self-corrects at midnight without a reload.
  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(() => getTodayInTrip());
  // — countdown-hits-zero micro-celebration + haptic pulse. Fires only on an OBSERVED
  // "not arrived" → "arrived" edge (the countdown grid → Day-N panel swap, live, while
  // watching). The ref starts null and the effect skips until `mounted` (the first real clock
  // read), so a page loaded ALREADY mid-trip only seeds the baseline — it must not celebrate
  // on every Home visit for the whole trip window — and later 1s ticks never re-fire
  //.
  const hadArrivedRef = useRef<boolean | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // the Home hero entry surfaces (the always-present CTA + the on-trip card) share
  // the one entry path — records the origin route, arms the gateway flag, pushes.
  const enterTravel = useEnterTravelMode();

  useEffect(() => {
    setMounted(true);
    // Clock reads flow through getNow() so `?today=` drives the hero. computeCountdown
    // stays pure — we pass the clock in.
    setTimeLeft(computeCountdown(TRIP_START, getNow()));
    setTodayInTrip(getTodayInTrip());
    const timer = setInterval(() => {
      setTimeLeft(computeCountdown(TRIP_START, getNow()));
      setTodayInTrip(getTodayInTrip());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // — arrival edge detection (see hadArrivedRef above), separate from the 1s clock tick.
  // `mounted` and `todayInTrip` are set together in the mount effect (batched), so the first
  // run past this guard sees the REAL clock state and only seeds the null baseline.
  useEffect(() => {
    if (!mounted) return;
    const arrived = todayInTrip != null;
    if (crossedIntoComplete(hadArrivedRef.current, arrived)) {
      setCelebrate(true);
      haptic();
      const t = setTimeout(() => setCelebrate(false), 650);
      hadArrivedRef.current = arrived;
      return () => clearTimeout(t);
    }
    hadArrivedRef.current = arrived;
  }, [mounted, todayInTrip]);

  // Scroll-linked parallax. `scrollYProgress` runs 0 → 1 as the hero scrolls
  // from "pinned at the top of the viewport" to "fully scrolled out the top"
  // (offset ['start start','end start']). Each decorative backdrop layer is driven
  // off this single progress value at a DIFFERENT rate, so they drift apart for a
  // sense of depth — deeper layers move less, foreground chrome more.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  // Reduced-motion: collapse every parallax range to [0,0] so the layers
  // never translate/scale/fade on scroll — the MotionValues are still created
  // unconditionally (hooks order is stable), they just resolve to a constant.
  // Tasteful, GPU-friendly displacements (transform/opacity only — no layout
  // props). Positive `y` = the layer drifts DOWN slower than the page scrolling
  // up, reading as "behind"; the foreground glows/orbs lift slightly for contrast.
  const photoY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, 60]);
  const photoScale = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [1, 1] : [1, 1.08]);
  const silhouetteY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, 90]);
  const glowY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, -40]);
  const glowOpacity = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [1, 1] : [1, 0.55]);
  const orbsY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, -70]);

  const reveal = prefersReducedMotion ? itemVariantsReduced : itemVariants;

  // #98 — the third hero state, POST-trip. Pre-trip and post-trip both leave `todayInTrip`
  // null, so without this the countdown-grid branch below ran for both and post-trip showed
  // a permanently zeroed clock ("00:00:00", 0 total days) under "Countdown to day one" —
  // wrong once the trip is over. Mount-gated for the same hydration reason as `custom` above.
  // Reuses `getNowAtTrip().date` (the SAME destination-local trip-day source A-22's
  // `trip-recap.tsx` fix and `trip-story-recap.tsx`/`core/recap/wrapped.ts` already read) —
  // no new device-local date helper.
  const postTrip = mounted && !todayInTrip && isPostTrip(getNowAtTrip().date);

  // — custom (non-default-pack) trips get a versatile vibe hero: no Nepal×Japan art/copy.
  // Mount-gated (SSR always renders the default pack's prerendered content,/SSG hydration
  // note) so `isDefaultTrip()` — a client-only gateway read — never causes a hydration mismatch.
  const custom = mounted && !isDefaultTrip();
  const customMeta = custom ? getKnownTrip(getActiveTripId()) : undefined;
  const customVibe = custom ? vibeFor(customMeta?.config?.vibe) : undefined;
  const customName = customMeta?.name ?? 'Your Trip';
  const customDestinations = customMeta?.config?.destinations?.join(' × ') ?? '';

  // — the two states with NO photograph behind the hero (issue #26): a custom trip, which
  // has none by rule (D8), and the default pack when the raster fails to load. Those are
  // the only two states the decorative CSS/SVG art is for; with a photograph present it is
  // a competing layer, not a backdrop. One flag so the glow layer and the silhouette can
  // never disagree about which state they are in.
  const artOnly = custom || heroImgError;

  // The hero photograph follows the LEG you are actually on: the Himalaya peak through the Nepal
  // leg (and every day outside the trip window), the Tokyo skyline through the Japan leg. Mapping
  // lives in `lib/hero-image.ts` so it is testable without React.
  //
  // Mount-gated exactly like `custom` above, and for the same reason: `todayInTrip` comes from a
  // clock read whose `?today=` override only resolves CLIENT-side, so the server and the first
  // paint must both render the default, or hydration mismatches.
  //
  // WHAT THIS COSTS, STATED HONESTLY. Every Japan-leg pageview still renders `hero.jpg` with
  // `priority` on the server, Next emits the preload for it, and the browser fetches it — then
  // mount swaps the src and that raster is NEVER PAINTED. Roughly 242 KiB (the 1920w AVIF)
  // downloaded and thrown away, once per cold load, for the 14 days of the Japan leg. It is
  // unavoidable with a client-only clock: the server cannot know which leg you are on, and the
  // alternative — dropping `priority` — would cost the LCP on all 351 other days. Do not "fix"
  // this by removing the mount gate; that trades a wasted fetch for a hydration mismatch.
  //
  // `todayInTrip` is refreshed on the same 1s tick as the countdown, so a leg change mid-session
  // swaps the photo on its own.
  //
  // DELIBERATE DEVIATION FROM ISSUE #89, recorded here because it is nowhere else. #89 asked for
  // a replacement chosen from photography the repo already ships, and this change fetched two new
  // Wikimedia files instead. The reason is resolution: the hero is the one FULL-BLEED surface in
  // the app, so it is the one place the pixels are actually spent, and the best bundled candidate
  // is 1200px native — upscaled across a 1440+ desktop it is visibly soft, which is the same
  // "the top looks bad" complaint #89 opened with. `scripts/fetch-images.mjs` already carries a
  // per-entry `width` knob, so the two hero entries take HERO_WIDTH = 1920 while the gallery
  // stays at 1280; no pipeline change, two rows of config. Both files are CC BY / CC BY-SA
  // Wikimedia, credited in public/images/CREDITS.md, and the no-new-assets rule elsewhere
  // (`lib/__tests__/content-validation.test.ts`) is scoped to the inspiration gallery and is
  // untouched by this.
  const heroSrc = heroImageForLeg(mounted ? todayInTrip?.country : undefined);
  // Crop + cap for whichever frame that resolved to. Keyed off `heroSrc`, NOT off a second read
  // of `todayInTrip.country`: two independent answers to "which leg" is how the cap ends up
  // Nepal-warm over the Tokyo skyline for one render.
  const heroFrame = HERO_FRAME[heroSrc] ?? HERO_FRAME[HERO_DEFAULT];

  return (
    // `flex-1 min-h-0` (NOT `min-h-[100svh]`): the hero is not the whole fold — the trip
    // strip sits above it, so a full-viewport hero pushed 129px of its own reserved height
    // BELOW the fold, and since the content block is vertically centred everything inside it
    // moved at half rate (issue #54 E2). Home now wraps strip + hero in ONE `min-h-[100svh]`
    // column and the hero takes the space that is actually left. Its single consumer is
    // `app/page.tsx`, so the sizing lives entirely there.
    <section ref={sectionRef} id="hero" aria-labelledby="hero-heading" className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
      {/* Decorative CSS + SVG backdrop — Himalayan warmth blending into Japan
          winter-neon. Purely decorative and aria-hidden; no external imagery. */}
      <div className="absolute inset-0" aria-hidden="true">
        {/* Base multi-stop gradient: warm gold/himalaya dawn at the horizon → deep navy night sky.
            a custom (non-default-pack) trip re-tints this SAME div with its vibe's gradient
            stops instead — no separate layer, per D8 ("reuse the existing base-gradient div"). */}
        <div
          className="absolute inset-0"
          style={{
            background: custom
              ? `linear-gradient(180deg, ${customVibe!.gradient.join(', ')})`
              : 'linear-gradient(180deg, #0b1020 0%, #15203c 32%, #2a3252 52%, #6e5a78 70%, #b9786b 82%, #e8a86a 92%, #f4cf8e 100%)',
          }}
        />
        {/* Bundled Himalayan photo layer — at FULL strength (issue #26). It used to be
            held at `opacity:.45` and then buried under two stacked dark overlays, which
            between them left about 7% of the picture on screen — the photo was not dim,
            it was very nearly gone, and that is what made the front page read flat. The
            single `.hero-scrim` below is now the only thing over it, at a measured floor
            (see the rule in globals.css); the photograph paints at 24% of the composite.
            On error (or if the asset is absent) the CSS/SVG art below shows through — and
            it now shows through ONLY THEN, which is what the fallback always claimed to
            be. Keeping a fake SVG mountain range permanently on top of a real photograph
            of mountains was the other half of the same defect.
            the PARENT div is a parallax layer (drifts slow + scales subtly,
            reading as the deepest plane); the image element itself is untouched.
            custom trips skip this layer entirely — the vibe gradient IS the backdrop
            (D8: "NO photo/SVG art" for a custom trip). */}
        {!custom && !heroImgError && (
          <m.div
            className="absolute inset-0 hero-photo-wrap"
            style={{
              y: photoY,
              scale: photoScale,
              // The per-frame crop + cap knobs (see HERO_FRAME). `.hero-photo-wrap` also
              // carries `isolation: isolate`, which is what keeps the cap's `darken` from
              // reaching the page behind this section — see the rule in globals.css.
              ...({
                ['--hero-focus-narrow']: heroFrame.narrow,
                ['--hero-focus']: heroFrame.wide,
                ['--hero-cap']: heroFrame.cap,
              } as CSSProperties),
            }}
          >
            <OptimizedImage
              src={heroSrc}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
              onError={() => setHeroImgError(true)}
            />
            {/* The highlight cap — the ONE layer of the duotone engine this hero takes.
                Decorative and inside an aria-hidden subtree already. It renders only on
                this branch: a custom trip has no photograph by rule (D8) and the SVG
                fallback is not a photograph either, so neither has anything to grade. */}
            <div className="hero-cap" />
          </m.div>
        )}
        {/* Soft radial glows — a Himalayan "sun" on the left, a sakura/neon bloom on the right.
            drifts UP slightly and fades as the hero leaves, a mid-depth plane.
            NOW PART OF THE NO-PHOTOGRAPH BRANCH ONLY (issue #26): this is chroma for the
            CSS/SVG art, and over a real photograph it was a fourth compositing layer whose
            only effect was to tint the picture and make the worst-case pixel under the
            scrim unknowable. A custom trip has no photo by rule, and the default pack has
            none when the raster fails — those are exactly the two cases that still want it.
            under reduced motion the scroll-linked MotionValues are NOT bound at all —
            framer hardware-accelerates the scroll-linked `opacity` into a WAAPI ViewTimeline
            animation, which stays permanently "running" even with the ranges collapsed to a
            constant. rule (reduced motion never renders a scroll-timeline path) makes
            the static style the correct branch; the rendered pixels are identical (y=0,
            opacity=1 — the collapsed ranges' resting values). */}
        {artOnly && (
        <m.div
          className="absolute inset-0"
          style={{
            ...(prefersReducedMotion ? {} : { y: glowY, opacity: glowOpacity }),
            background:
              'radial-gradient(60% 50% at 22% 86%, rgba(244,196,107,0.45) 0%, rgba(244,196,107,0) 60%), radial-gradient(45% 40% at 82% 30%, rgba(244,143,177,0.30) 0%, rgba(244,143,177,0) 65%), radial-gradient(40% 35% at 95% 70%, rgba(99,179,237,0.22) 0%, rgba(99,179,237,0) 70%)',
          }}
        />
        )}

        {/* Layered mountain-range / skyline silhouette — THE PHOTO'S FALLBACK ART, and
            only that (issue #26). The comment on the photo layer above has always called
            this the fallback; the markup rendered it unconditionally, so a real photograph
            of the Himalaya spent its life under an opaque SVG of invented mountains.
            wrapped in a parallax m.div that drifts DOWN the most slowly of the
            backdrop planes (deepest fixed scenery feel). The SVG art is unchanged.
            custom trips skip this SVG entirely (D8: "NO photo/SVG art"). */}
        {!custom && heroImgError && (
        <m.div className="absolute inset-x-0 bottom-0 w-full h-[62%]" style={{ y: silhouetteY }}>
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1440 600"
          preserveAspectRatio="xMidYMax slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="rangeFar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3a4368" />
              <stop offset="100%" stopColor="#222a48" />
            </linearGradient>
            <linearGradient id="rangeMid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1c2440" />
              <stop offset="100%" stopColor="#121830" />
            </linearGradient>
            <linearGradient id="rangeNear" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0c1124" />
              <stop offset="100%" stopColor="#070b18" />
            </linearGradient>
          </defs>

          {/* Far Himalayan ridge with snow-lit peaks */}
          <path
            fill="url(#rangeFar)"
            d="M0 330 L120 250 L240 300 L360 200 L470 280 L600 170 L720 250 L850 190 L980 270 L1110 210 L1240 280 L1360 230 L1440 290 L1440 600 L0 600 Z"
          />
          <path
            fill="#f4cf8e"
            opacity="0.85"
            d="M360 200 L392 232 L376 230 L408 252 L344 252 L340 232 Z M600 170 L636 206 L618 204 L652 232 L568 232 L566 206 Z M850 190 L884 222 L868 220 L900 246 L820 246 L816 222 Z M1110 210 L1140 240 L1126 238 L1154 262 L1082 262 L1080 240 Z"
          />

          {/* Mid ridge */}
          <path
            fill="url(#rangeMid)"
            d="M0 420 L160 360 L320 410 L460 340 L620 400 L780 350 L940 410 L1100 360 L1260 405 L1440 360 L1440 600 L0 600 Z"
          />

          {/* Near skyline silhouette — a few modern towers nodding to Tokyo, fading into the foreground */}
          <path
            fill="url(#rangeNear)"
            d="M0 600 L0 470 L80 470 L80 430 L120 430 L120 470 L210 470 L210 410 L240 410 L240 470 L340 470
               L340 360 L360 360 L360 340 L380 340 L380 360 L400 360 L400 470 L520 470 L520 445 L600 445 L600 470
               L700 470 L700 420 L740 420 L740 470 L860 470 L860 455 L960 455 L960 470 L1060 470 L1060 400
               L1085 400 L1085 380 L1100 380 L1100 400 L1120 400 L1120 470 L1240 470 L1240 440 L1340 440 L1340 470
               L1440 470 L1440 600 Z"
          />

          {/* Sparse "neon" window lights on the near skyline */}
          <g fill="#f4cf8e" opacity="0.6">
            <rect x="92" y="442" width="4" height="6" />
            <rect x="102" y="452" width="4" height="6" />
            <rect x="222" y="424" width="4" height="6" />
            <rect x="222" y="440" width="4" height="6" />
            <rect x="366" y="372" width="3" height="6" />
            <rect x="710" y="432" width="4" height="6" />
            <rect x="722" y="448" width="4" height="6" />
            <rect x="1068" y="414" width="4" height="6" />
            <rect x="1068" y="432" width="4" height="6" />
          </g>
          <g fill="#63b3ed" opacity="0.5">
            <rect x="102" y="442" width="4" height="6" />
            <rect x="232" y="424" width="4" height="6" />
            <rect x="710" y="448" width="4" height="6" />
            <rect x="1078" y="424" width="4" height="6" />
          </g>
        </svg>
        </m.div>
        )}

        {/* THE scrim — singular (issue #26). It replaces `.hero-gradient` stacked under a
            second `from-surface via-transparent to-surface/50` wash. Its ramp never drops
            below 0.76 anywhere a text node can land, which is what carries the contrast
            guarantee for a content block that is vertically CENTRED and whose height moves
            as zero countdown units drop out. Every ratio is measured in
            `scripts/contrast-tokens.mjs` against the worst pixel a photograph can produce
            (pure white), not against an assumed duotone cap. Do not add a second overlay
            here; darken the one ramp instead, and re-run `npm run contrast-check`. */}
        <div className="absolute inset-0 hero-scrim" />
      </div>

      {/* Floating Decorative Elements —: lifted as the foreground parallax plane
          (drifts UP the most), wrapped in a single parallax m.div so the orbs read
          as the nearest layer.: the orbs keep the scroll-linked parallax (a
          one-shot, input-driven transform) but LOSE `.animate-float` — that was a 6s
          infinite bob on a pair of 5%-alpha blurred circles, i.e. a forever loop for
          decoration nobody can see move. */}
      <m.div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ y: orbsY }}>
        <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-gold-400/5 blur-3xl" />
        <div className="absolute bottom-40 right-10 w-48 h-48 rounded-full bg-sakura-400/5 blur-3xl" />
      </m.div>

      {/* Hero content —: a single staggered entrance (container staggers its
          children; each rises + fades with a premium ease, or opacity-only under
          reduced motion). The countdown numbers inside remain the live CountUpNumber. */}
      <m.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="relative z-10 max-w-[1200px] mx-auto px-4 sm:px-6 text-center pt-2 min-[420px]:pt-20 sm:pt-24 pb-10 min-[420px]:pb-16"
      >
        {/* Badge */}
        <m.div
          variants={reveal}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-2 min-[420px]:mb-6"
        >
          <Plane className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm text-muted-foreground font-medium">{TRIP_DATE_LABEL}</span>
        </m.div>

        {/* Title —: a custom trip shows its own name, no Nepal×Japan branding. */}
        <m.h1
          variants={reveal}
          id="hero-heading"
          className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-4"
        >
          {custom ? (
            <span className="text-white">{customName}</span>
          ) : (
            <>
              <span className="text-white">Nepal</span>
              <span className="text-display-emphasis mx-3">×</span>
              <span className="text-white">Japan</span>
            </>
          )}
        </m.h1>

        {/* Subtitle —: a custom trip shows its destinations + vibe tagline.
            Issue #27 tier: it qualifies the title rather than being the title, so ink-mid.
            It sits over the photograph, where ink-mid measures 5.62:1 (5.27:1 at the
            entrance's darkest frame) and ink-LO would measure 3.55:1 — which is why no
            hero copy over the photo may drop to the floor tier. */}
        <m.p
          variants={reveal}
          className="text-lg sm:text-xl text-ink-mid max-w-2xl mx-auto mb-3"
        >
          {custom
            ? [customDestinations, customVibe?.tagline].filter(Boolean).join(' — ')
            : 'From the mystical temples of Kathmandu to the neon-lit streets of Tokyo. A journey across ancient peaks and futuristic cities.'}
        </m.p>

        {/* the decorative quote was dropped to keep the hero calm and content-first
            (one obvious action, less above-fold noise). The subtitle above carries the mood. */}

        {/* Countdown ⇄ Travel mode ⇄ Post-trip. All three are gated behind `mounted` so the
            client-only clock never renders on the server (no hydration mismatch — none of
            these panels appears pre-mount). When the app clock is inside the trip window,
            `todayInTrip` is non-null and the "Day N — {city}" panel replaces the countdown
            grid; off-trip and past the last trip day (#98), a static "trip complete" panel
            replaces it instead; otherwise (pre-trip) the live countdown shows. */}
        {mounted && (todayInTrip ? (
          <m.div variants={reveal} className="relative mb-10">
            <CelebrationBurst active={celebrate} testId="hero-arrival-celebration" celebrationId="hero-arrival" />
            {/* ink-mid, NOT `text-muted-foreground`: this line sits OVER THE PHOTOGRAPH
                (the card below it does not), and --muted-foreground resolves to the floor
                tier, which measures 3.55:1 there. */}
            <p className="text-sm text-ink-mid mb-4 uppercase tracking-widest">You're on the trip</p>
            <div data-testid="hero-travel-mode" className="inline-flex flex-col items-center gap-2 glass-card rounded-2xl px-6 sm:px-10 py-5 sm:py-6 max-w-full">
              <div className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
                Day <span data-testid="hero-day-number" className="text-display-emphasis">{todayInTrip.dayNumber}</span>
                <span className="text-ink-lo mx-2 sm:mx-3">—</span>
                {todayInTrip.city}
              </div>
              <p className="text-sm sm:text-base text-ink-mid">{formatDateLong(todayInTrip.date)}</p>
            </div>
            {/* in-trip, the ONE obvious action is Travel Mode — the
                purpose-built on-trip experience. Collapsed from two buttons to this single
                primary (the planner is one tap away in the tab bar). Only renders in-trip
                (todayInTrip non-null), so it is inherently hidden off-trip. */}
            <div data-testid="home-intrip-travel-card" className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => enterTravel()}
                data-testid="home-intrip-travel"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all duration-200 hover:scale-105 shadow-lg shadow-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
              >
                <Compass className="w-4 h-4" />
                Open Travel Mode
              </button>
            </div>
          </m.div>
        ) : postTrip ? (
          // #98 — post-trip: the countdown-grid branch used to run here too (todayInTrip is
          // null both pre- and post-trip), showing a permanently zeroed clock under "Countdown
          // to day one". This is a static replacement, not a live surface — there is nothing
          // left to count — and deliberately lighter than the six-cell digit grid it replaces,
          // so it cannot threaten the 740px fold-clearance budget (D-311) the grid was sized
          // against.
          <m.div variants={reveal} className="relative mb-10">
            {/* ink-mid, matching the in-trip panel's caption above: this line also sits over
                the hero photograph, where the floor tier fails contrast. */}
            <p className="text-sm text-ink-mid mb-4 uppercase tracking-widest">The journey&rsquo;s over</p>
            <div data-testid="hero-post-trip" className="inline-flex flex-col items-center gap-2 glass-card rounded-2xl px-6 sm:px-10 py-5 sm:py-6 max-w-full">
              <div className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
                Trip complete
              </div>
              <p className="text-sm sm:text-base text-ink-mid">{TRIP_DATE_LABEL}</p>
            </div>
          </m.div>
        ) : (
          <m.div
            variants={reveal}
            className="mb-2 min-[420px]:mb-10"
          >
            <p className="text-sm text-ink-mid mb-2 min-[420px]:mb-4 uppercase tracking-widest">Countdown to day one</p>
            <div className="grid grid-cols-3 sm:flex sm:flex-wrap justify-center gap-3 sm:gap-4 mb-2 min-[420px]:mb-4">
              {/* the cells lost `.animate-pulse-glow` — a 3s infinite box-shadow breathe
                  on all six. They already read as a group via.glass-card; the glow added
                  nothing but a permanent repaint.

                  The cell COUNT is now 3 to 6, because a zero calendar unit is dropped
                  (issue #11). The container is unchanged on purpose: `grid-cols-3` still
                  puts three per row on mobile and `sm:flex-wrap justify-center` still
                  centres the rows above it, so a short row wraps instead of stretching.
                  Six units is still six units, so the layout that ships today is
                  untouched.

                  Issue #26 restyles these cells and deliberately does NOT resize them.
                  Every font-size, padding and min-width below is the value that shipped,
                  because the hero's height is a hard budget: `e2e/countdown.spec.ts`
                  asserts the CTA below still clears a 740px fold with 12px of margin at
                  320 and 360 wide (D-311), and the ruled cell metrics would have spent
                  more than that margin on their own. What changes is the LOOK — the ruled
                  20px radius, Geist tabular figures instead of the mono face, the label on
                  the floor tier, and the one live cell. Re-timing the type scale is the
                  root-size question (the app runs a 17px root) and it needs the overflow
                  matrix re-run at 360/390/414, which is its own slice. */}
              {[
                ...COUNTDOWN_DATE_UNITS.filter(({ key }) => timeLeft[key] > 0),
                ...COUNTDOWN_CLOCK_UNITS,
              ].map(({ key, label }) => {
                // The seconds cell is the only thing on this surface that is genuinely
                // live, and it is marked as such three ways — a pink edge, the --glow-live
                // ring, and gradient-filled digits — on top of a label that already says
                // SECONDS in words. Motion never carries information alone here because
                // there is no motion: see the note on `.countdown-cell--live`.
                const live = key === 'seconds';
                return (
                <div
                  key={key}
                  className={`countdown-cell glass-card px-3 sm:px-5 py-3 sm:py-4 min-w-[70px] sm:min-w-[90px]${
                    live ? ' countdown-cell--live' : ''
                  }`}
                >
                  <div
                    data-testid={`countdown-${key}`}
                    className={`text-2xl sm:text-3xl md:text-4xl font-extrabold tabular-nums tracking-tight ${
                      live ? 'text-gradient-sakura' : 'text-foreground'
                    }`}
                  >
                    <CountUpNumber live={timeLeft[key] ?? 0} active={mounted} format={padUnit} />
                  </div>
                  <div className="text-[10px] sm:text-xs text-ink-lo uppercase tracking-wider mt-1 font-bold">{label}</div>
                </div>
                );
              })}
            </div>
            {/* — radial progress ring wrapping the existing total-days digit. `ringFraction`
                is a pure derivation over the SAME computeCountdown() output driving the digit
                grid above — see lib/countdown-ring.ts for the formula. */}
            <div className="hidden min-[420px]:flex flex-col items-center gap-1.5">
              <CountdownRing
                fraction={ringFraction(timeLeft.totalDays, timeLeft.isPast)}
                reducedMotion={!!prefersReducedMotion}
              >
                <div className="flex flex-col items-center">
                  <span data-testid="countdown-total-days" className="text-xl sm:text-2xl text-foreground font-extrabold tabular-nums leading-none">
                    <CountUpNumber live={timeLeft.totalDays} active={mounted} format={identity} />
                  </span>
                  <span className="text-[9px] uppercase tracking-widest text-ink-mid mt-1">days to go</span>
                </div>
              </CountdownRing>
              <p className="text-sm text-ink-mid">until adventure begins</p>
            </div>
          </m.div>
        ))}

        {/* — ONE obvious action (was 4 competing CTAs). Pre-/post-trip the single
            primary is "Open Planner" → the itinerary, the useful next step before you travel.
            In-trip this is suppressed: the on-trip card above already carries the single
            Travel Mode action for that state. Every other former CTA (Explore/Dashboard/
            Travel Mode) is reachable from the tab bar, so nothing is stranded. */}
        {!(mounted && todayInTrip) && (
          <m.div variants={reveal} className="flex justify-center">
            <Link
              href="/plan/"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all duration-200 hover:scale-105 shadow-lg shadow-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
            >
              <Calendar className="w-4 h-4" />
              Open Planner
            </Link>
          </m.div>
        )}
      </m.div>

      {/* Scroll indicator.: the chevron's `repeat: Infinity` bounce is deleted —
          it was the app's only framer-driven forever loop, and a cue that never stops
          bouncing stops reading as a cue. The one-shot delayed fade-in stays: it is
          what actually draws the eye, and it settles. */}
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden sm:block"
      >
        {/* A decorative mark, not text — WCAG 1.4.11's 3:1 is the bar it has to clear,
            and ink-mid clears it by a distance (5.62:1) over the photograph. The floor
            tier would sit at 3.55:1: still legal for a mark, but this is the only cue
            that there is anything below the fold, so it takes the tier that reads. */}
        <ChevronDown className="w-6 h-6 text-ink-mid" aria-hidden="true" />
      </m.div>
    </section>
  );
}
