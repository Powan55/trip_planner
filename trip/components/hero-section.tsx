'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { m, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { Calendar, Compass, ChevronDown, Plane } from 'lucide-react';
import { TRIP_START, TRIP_DATE_LABEL, formatDateLong } from '@/lib/trip-data';
import { TRIP_DATES_PENDING } from '@/core/dates';
import { dayShade } from '@/lib/city-palette';
import { computeCountdown, type Countdown } from '@/lib/countdown';
import { FADE_FLOOR } from '@/lib/motion';
import { ringFraction } from '@/lib/countdown-ring';
import { daysToGo } from '@/lib/home-stats';
import { getNow, getTodayInTrip, getTripDayDate, type TripToday } from '@/lib/trip-now';
import { heroImageForLeg, HERO_DEFAULT, HERO_JAPAN, HERO_SIZES } from '@/lib/hero-image';
import { isDefaultTrip } from '@/core/trips';
import { isPostTrip } from '@/core/recap/model';
import { getKnownTrip } from '@/core/trips/registry';
import { NO_VIBE, vibeFor } from '@/core/trips/custom';
import { getActiveTripId } from '@/core/storage/gateway';
import OptimizedImage from '@/components/optimized-image';
import CountdownRing from '@/components/countdown-ring';
import { useEnterTravelMode } from '@/hooks/use-travel-mode';
import { haptic } from '@/lib/haptics';
import { crossedIntoComplete } from '@/lib/celebration';
import CelebrationBurst from '@/components/celebration-burst';

// Zero-valued calendar units are dropped here, so it never reads "29 days, 0 weeks".
const COUNTDOWN_DATE_UNITS = [
  { key: 'months', label: 'Months' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'days', label: 'Days' },
] as const;

// Clock units always render; dropping a ticking 00 would reflow the row every minute.
const COUNTDOWN_CLOCK_UNITS = [
  { key: 'hours', label: 'Hours' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'seconds', label: 'Seconds' },
] as const;

const padUnit = (n: number) => String(n).padStart(2, '0');

/**
 * Crop (`object-position`) and highlight cap per hero photo, keyed by the resolved src so
 * photo, crop and cap can't disagree about the leg. Phones crop horizontally and desktops
 * vertically, hence two values. Ama Dablam: lift the window onto the summit (y 11%).
 * Shinjuku: x 30% keeps Fuji (x 23-41%) in frame on phones from 320 to 430px wide.
 */
const HERO_FRAME: Record<string, { narrow: string; wide: string; cap: string }> = {
  [HERO_DEFAULT]: { narrow: 'center 32%', wide: 'center 38%', cap: 'var(--duo-np-high)' },
  [HERO_JAPAN]: { narrow: '30% center', wide: '42% center', cap: 'var(--duo-jp-high)' },
};

/**
 * Staggered entrance for the hero content. MotionConfig doesn't strip the authored `y`
 * offset, so reduced motion swaps to opacity-only variants.
 */
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const itemVariants = {
  // Starts at FADE_FLOOR so axe sampling mid-animation still sees AA contrast.
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
  const [heroImgError, setHeroImgError] = useState(false);
  // Seeded from the real clock, not zeros: zero units are dropped, so a zeroed first frame
  // was much shorter and the centred block jumped. Safe because this is client-only.
  const [timeLeft, setTimeLeft] = useState<Countdown>(() => computeCountdown(TRIP_START, getNow()));
  // Calendar days, not timeLeft.totalDays (a truncated 24h count), so the ring matches the
  // stat row below. See daysToGo and D-313.
  const [daysLeft, setDaysLeft] = useState(() => daysToGo(getNow()));
  // In-trip, the countdown becomes a "Day N, city" panel.
  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(() => getTodayInTrip());
  // Celebrate only an observed not-arrived to arrived edge. Starts null so loading mid-trip
  // just seeds the baseline.
  const hadArrivedRef = useRef<boolean | null>(null);
  const everInTripRef = useRef(false);
  const [celebrate, setCelebrate] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const enterTravel = useEnterTravelMode();

  useEffect(() => {
    // One getNow() per tick feeds both grid and ring so they can't be a tick apart.
    const tick = () => {
      const now = getNow();
      setTimeLeft(computeCountdown(TRIP_START, now));
      setDaysLeft(daysToGo(now));
      setTodayInTrip(getTodayInTrip());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const arrived = todayInTrip != null;
    // Crossing the dateline can drop the day to null for a tick, so only celebrate once.
    const seenBefore = everInTripRef.current;
    if (arrived) everInTripRef.current = true;
    if (!seenBefore && crossedIntoComplete(hadArrivedRef.current, arrived)) {
      setCelebrate(true);
      haptic();
      const t = setTimeout(() => setCelebrate(false), 650);
      hadArrivedRef.current = arrived;
      return () => clearTimeout(t);
    }
    hadArrivedRef.current = arrived;
  }, [todayInTrip]);

  // Parallax: each backdrop layer moves at a different rate off one scroll progress.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  // Reduced motion collapses the ranges to constants; the hooks still run in the same order.
  const photoY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, 60]);
  const photoScale = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [1, 1] : [1, 1.08]);
  const silhouetteY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, 90]);
  const glowY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, -40]);
  const glowOpacity = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [1, 1] : [1, 0.55]);
  const orbsY = useTransform(scrollYProgress, [0, 1], prefersReducedMotion ? [0, 0] : [0, -70]);

  const reveal = prefersReducedMotion ? itemVariantsReduced : itemVariants;

  // todayInTrip is null both before and after the trip. Same trip-day clock as the recap
  // unlock, so the two can't disagree.
  const postTrip = !todayInTrip && isPostTrip(getTripDayDate());

  // Custom trips get a vibe gradient instead of the sample pack's art and copy.
  const custom = !isDefaultTrip();
  const customMeta = custom ? getKnownTrip(getActiveTripId()) : undefined;
  const customVibe = custom ? vibeFor(customMeta?.config?.vibe) : undefined;
  const customName = customMeta?.name ?? 'Your Trip';
  const customDestinations = customMeta?.config?.destinations?.join(' × ') ?? '';

  // The CSS/SVG art only shows when there's no photo: custom trips, or a failed load.
  const artOnly = custom || heroImgError;

  // Photo follows the current leg (lib/hero-image.ts). Home preloads the default AVIF, so a
  // Japan-leg load may fetch it once before the clock picks Tokyo.
  const heroSrc = heroImageForLeg(todayInTrip?.country);
  const heroFrame = HERO_FRAME[heroSrc] ?? HERO_FRAME[HERO_DEFAULT];
  // 4 cells (no month, no week) go 4-up on phones so Seconds is not orphaned on a second row.
  const countdownCells = [
    ...COUNTDOWN_DATE_UNITS.filter(({ key }) => timeLeft[key] > 0),
    ...COUNTDOWN_CLOCK_UNITS,
  ];
  const fourUp = countdownCells.length === 4;

  return (
    // flex-1, not 100svh: the trip strip shares the fold. Home owns the column sizing.
    <section ref={sectionRef} id="hero" aria-labelledby="hero-heading" className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
      {/* Decorative backdrop. */}
      <div className="absolute inset-0" aria-hidden="true">
        {/* Base gradient; custom trips re-tint it with their vibe. */}
        <div
          className="absolute inset-0"
          style={{
            background: custom
              ? `linear-gradient(180deg, ${customVibe!.gradient.join(', ')})`
              // All tokens: the surface ramp into the two Nepal stops.
              :'linear-gradient(180deg, rgb(var(--surface)) 0%, rgb(var(--surface-low)) 34%, rgb(var(--surface-raised)) 56%, rgb(var(--surface-overlay)) 74%, var(--np-a) 92%, var(--np-b) 100%)',
          }}
        />
        {/* Photo at full strength; .hero-scrim is the only layer over it. Falls back to the
            SVG art on error. The wrapper is the deepest parallax plane. */}
        {!custom && !heroImgError && (
          <m.div
            className="absolute inset-0 hero-photo-wrap"
            style={{
              y: photoY,
              scale: photoScale,
              // .hero-photo-wrap isolates, so the cap's `darken` stays inside it.
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
              sizes={HERO_SIZES}
              className="object-cover"
              onError={() => setHeroImgError(true)}
            />
            {/* Highlight cap; only photos need it. */}
            <div className="hero-cap" />
          </m.div>
        )}
        {/* Radial glows for the no-photo art. Under reduced motion the MotionValues aren't
            bound at all: framer turns scroll-linked opacity into a ViewTimeline animation
            that stays "running" even with collapsed ranges. */}
        {artOnly && (
        <m.div
          className="absolute inset-0"
          style={{
            ...(prefersReducedMotion ? {} : { y: glowY, opacity: glowOpacity }),
            background:
              'radial-gradient(60% 50% at 22% 86%, rgb(255 196 61 / 0.45) 0%, rgb(255 196 61 / 0) 60%), radial-gradient(45% 40% at 82% 30%, rgb(255 143 199 / 0.30) 0%, rgb(255 143 199 / 0) 65%), radial-gradient(40% 35% at 95% 70%, rgb(192 140 255 / 0.22) 0%, rgb(192 140 255 / 0) 70%)',
          }}
        />
        )}

        {/* Mountain and skyline silhouette, shown only when the photo fails. */}
        {!custom && heroImgError && (
        <m.div className="absolute inset-x-0 bottom-0 w-full h-[62%]" style={{ y: silhouetteY }}>
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1440 600"
          preserveAspectRatio="xMidYMax slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* KNOWN CEILING: SVG stops can't take var(), so these hexes copy the surface
              ramp by hand. Update them if the ramp moves. */}
          <defs>
            <linearGradient id="rangeFar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#26235C" />
              <stop offset="100%" stopColor="#1C1948" />
            </linearGradient>
            <linearGradient id="rangeMid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#141033" />
              <stop offset="100%" stopColor="#0F0C26" />
            </linearGradient>
            <linearGradient id="rangeNear" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0A0818" />
              <stop offset="100%" stopColor="#070510" />
            </linearGradient>
          </defs>

          {/* Far Himalayan ridge with snow-lit peaks */}
          <path
            fill="url(#rangeFar)"
            d="M0 330 L120 250 L240 300 L360 200 L470 280 L600 170 L720 250 L850 190 L980 270 L1110 210 L1240 280 L1360 230 L1440 290 L1440 600 L0 600 Z"
          />
          <path
            fill="#FFC43D"
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
          <g fill="#FFC43D" opacity="0.6">
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
          <g fill="#FF8FC7" opacity="0.5">
            <rect x="102" y="442" width="4" height="6" />
            <rect x="232" y="424" width="4" height="6" />
            <rect x="710" y="448" width="4" height="6" />
            <rect x="1078" y="424" width="4" height="6" />
          </g>
        </svg>
        </m.div>
        )}

        {/* The one scrim. Its contrast is checked by scripts/contrast-tokens.mjs against
            a pure-white photo pixel; darken it rather than adding a second overlay. */}
        <div className="absolute inset-0 hero-scrim" />
      </div>

      {/* Foreground parallax orbs. */}
      <m.div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ y: orbsY }}>
        <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-gold-400/5 blur-3xl" />
        <div className="absolute bottom-40 right-10 w-48 h-48 rounded-full bg-sakura-400/5 blur-3xl" />
      </m.div>

      {/* Hero content, one staggered entrance. */}
      <m.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="relative z-10 max-w-[1200px] mx-auto px-4 sm:px-6 text-center pt-2 min-[420px]:pt-20 sm:pt-24 pb-10 min-[420px]:pb-16"
      >
        {/* Trip dates. */}
        <m.div variants={reveal} className="mb-2 min-[420px]:mb-6">
          <span className="chip chip--struck whitespace-normal px-3 py-2">
            <Plane className="w-4 h-4" aria-hidden="true" />
            {TRIP_DATE_LABEL}
          </span>
        </m.div>

        {/* rem, not px, so the high-legibility root bump still applies. */}
        <m.h1
          variants={reveal}
          id="hero-heading"
          className="text-display-2xl max-[339px]:text-[2.4rem] text-ink-hi mb-4"
        >
          {custom ? (
            <span>{customName}</span>
          ) : (
            <>
              <span>Nepal</span>
              {/* ink-mid: ink-lo fails contrast over the photo. */}
              <span className="text-ink-mid mx-3">×</span>
              <span>Japan</span>
            </>
          )}
        </m.h1>

        {/* Over the photo ink-mid measures 5.62:1 and ink-lo 3.55:1, so no hero copy
            drops to ink-lo. */}
        <m.p
          variants={reveal}
          className="text-t-lead text-ink-mid max-w-2xl mx-auto mb-3 [overflow-wrap:anywhere] max-[419px]:[@media(max-height:699px)]:hidden"
        >
          {custom
            ? [customDestinations, customMeta?.config?.vibe !== NO_VIBE && customVibe?.tagline]
                .filter(Boolean)
                .join(' — ')
            : 'The Kathmandu Valley, then Osaka, Kyoto and Tokyo over New Year.'}
        </m.p>

        {/* No quote line; the subtitle carries the mood. */}

        {/* In-trip day panel, post-trip panel, or the countdown. */}
        {todayInTrip ? (
          <m.div variants={reveal} className="relative mb-10">
            <CelebrationBurst active={celebrate} testId="hero-arrival-celebration" celebrationId="hero-arrival" />
            {/* Over the photo, so ink-mid rather than muted-foreground. */}
            <p className="pr mb-4">You're on the trip</p>
            {/* Nothing sets --now on the shell yet, so set the leg colour here. */}
            <div
              data-testid="hero-travel-mode"
              style={{ ['--now']: dayShade(todayInTrip.date).color } as CSSProperties}
              className="inline-flex flex-col items-center gap-2 glass-card rounded-r2 px-6 sm:px-10 py-5 sm:py-6 max-w-full"
            >
              <div className="text-display-xl text-ink-hi">
                <span className="block sm:inline">
                  Day{' '}
                  <span data-testid="hero-day-number" className="text-now tabular-nums">
                    {todayInTrip.dayNumber}
                  </span>
                </span>
                <span className="hidden sm:inline text-ink-lo mx-3">—</span>
                <span className="block sm:inline">{todayInTrip.city}</span>
              </div>
              <p className="pr pr--l pr--lo">{formatDateLong(todayInTrip.date)}</p>
            </div>
            {/* In-trip, the one action is Travel Mode. */}
            <div data-testid="home-intrip-travel-card" className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => enterTravel()}
                data-testid="home-intrip-travel"
                className="btn px-6"
              >
                <Compass className="w-4 h-4" />
                Open Travel Mode
              </button>
            </div>
          </m.div>
        ) : postTrip ? (
          // Static and smaller than the countdown grid, so it stays inside the fold budget (D-311).
          <m.div variants={reveal} className="relative mb-10">
            {/* Over the photo, so ink-mid. */}
            <p className="pr mb-4">The journey&rsquo;s over</p>
            <div data-testid="hero-post-trip" className="inline-flex flex-col items-center gap-2 glass-card rounded-r2 px-6 sm:px-10 py-5 sm:py-6 max-w-full">
              <div className="text-display-xl text-ink-hi">Trip complete</div>
              <p className="pr pr--l pr--lo">{TRIP_DATE_LABEL}</p>
            </div>
          </m.div>
        ) : TRIP_DATES_PENDING ? null : (
          <m.div
            variants={reveal}
            className="mb-2 min-[420px]:mb-10"
          >
            <p className="pr mb-2 min-[420px]:mb-4">Countdown to day one</p>
            <div className={`grid ${fourUp ? 'grid-cols-4 gap-2 min-[360px]:gap-3' : 'grid-cols-3 gap-3'} sm:flex sm:flex-wrap justify-center sm:gap-4 mb-2 min-[420px]:mb-4`}>
              {/* 3 to 6 cells. Sizes and padding are a fold budget: e2e/countdown.spec.ts
                  checks the CTA clears a 740px fold at 320 and 360 wide (D-311). */}
              {countdownCells.map(({ key, label }) => {
                // Seconds is the one live cell, marked by colour, ring and gradient digits.
                const live = key === 'seconds';
                return (
                <div
                  key={key}
                  className={`countdown-cell glass-card ${fourUp ? 'px-0 min-[360px]:px-1' : 'px-3'} sm:px-5 py-3 sm:py-4 sm:min-w-[90px]${
                    live ? ' countdown-cell--live' : ''
                  }`}
                >
                  {/* The machine face only ships weight 600; font-extrabold would synthesise. */}
                  <div
                    data-testid={`countdown-${key}`}
                    className={`font-machine text-2xl sm:text-3xl md:text-4xl tabular-nums tracking-tight ${
                      live ? 'text-gradient-sakura' : 'text-foreground'
                    }`}
                  >
                    {padUnit(timeLeft[key] ?? 0)}
                  </div>
                  {/* No tracking on mobile so MINUTES fits a 320px cell. */}
                  <div className="text-t-label text-ink-lo uppercase tracking-normal sm:tracking-wider mt-1 font-bold">{label}</div>
                </div>
                );
              })}
            </div>
            {/* Days ring. Same daysToGo value as the stat row, but without its caption so
                the screen doesn't print the same labelled figure twice. */}
            <div className="hidden min-[420px]:flex flex-col items-center gap-1.5">
              <CountdownRing
                fraction={ringFraction(daysLeft, timeLeft.isPast)}
                reducedMotion={!!prefersReducedMotion}
                label={`${daysLeft} calendar ${daysLeft === 1 ? 'day' : 'days'} remaining`}
              >
                <div className="flex flex-col items-center gap-1">
                  <span data-testid="countdown-total-days" className="text-xl sm:text-2xl text-foreground font-extrabold tabular-nums leading-none">
                    {daysLeft}
                  </span>
                  <span data-testid="countdown-total-days-unit" className="text-t-label text-ink-mid leading-none">{daysLeft === 1 ? 'day' : 'days'}</span>
                </div>
              </CountdownRing>
              <p className="text-sm text-ink-mid">until adventure begins</p>
            </div>
          </m.div>
        )}

        {/* One primary action outside the trip; in-trip the card above has it. */}
        {!todayInTrip && (
          <m.div variants={reveal} className="flex justify-center">
            <Link href="/plan/" className="btn px-6">
              <Calendar className="w-4 h-4" />
              Open Planner
            </Link>
          </m.div>
        )}
      </m.div>

      {/* Scroll cue: one delayed fade-in, no loop. */}
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden sm:block"
      >
        {/* ink-mid: it's the only hint there's more below the fold. */}
        <ChevronDown className="w-6 h-6 text-ink-mid" aria-hidden="true" />
      </m.div>
    </section>
  );
}
