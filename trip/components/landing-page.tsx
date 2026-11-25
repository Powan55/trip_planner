'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import OptimizedImage from '@/components/optimized-image';
import LegalLinks from '@/components/legal-links';
import { entranceFor } from '@/lib/motion';

/**
 * The logged-out front door, rendered as the first view of TokenGate's wall. It lives inside the
 * wall rather than its own route, so it inherits the wall's dialog focus trap and Esc handling
 * and carries the full app bundle.
 *
 * - No live trip data: import nothing from the content pack, itinerary store or provider hooks.
 *   No date finer than a month (e2e/login.spec.ts checks the wall).
 * - Semantic colour tokens only, no raw hex.
 * - Log in must stay the first <button> in the DOM: the wall focuses the first enabled button,
 *   and login.spec.ts and front-door.test.ts assert it.
 * - Plain <div>s rather than <header>/<footer>, to avoid duplicate landmarks.
 * - The text/background pairings here are measured in scripts/contrast-tokens.mjs ("THE FRONT
 *   DOOR"). ink-lo never sits over a photo.
 */

/** Static on purpose; see the no-live-data rule above. */
const FACTS = [
  { label: 'Trips', value: '1+', foot: 'Add as many as you like' },
  { label: 'Countries', value: 'Any', foot: 'One or ten' },
  { label: 'Invite links', value: '7', foot: 'Days each, one use' },
  { label: 'Price', value: '0', foot: 'Free, no card needed' },
] as const;

/**
 * One row per feature that exists today.
 * The Offline row is exact: the plan and the map engine are offline, but map tiles come from a
 * CDN the service worker deliberately doesn't cache. Don't shorten it to "the map works offline".
 */
const ONBOARD = [
  { name: 'Itinerary', cond: 'Every day, in the order you will do it', n: null, unit: 'day by day' },
  { name: 'Map', cond: 'Your stops, pinned and joined in order', n: null, unit: 'street map' },
  { name: 'Guides', cond: 'Sample trip: where to go, eat, shoot and go out late', n: '4', unit: 'kinds' },
  { name: 'Money', cond: 'Local currencies in, who-owes-who out', n: null, unit: 'split bills' },
  { name: 'Checklists', cond: 'Packing and documents, before you fly', n: '2', unit: 'lists' },
  { name: 'Journal', cond: 'The day in your words, photographs attached', n: null, unit: 'on device' },
  { name: 'Recap', cond: 'The whole trip, read back to you', n: null, unit: 'at the end' },
  {
    name: 'Offline',
    // See the note above before shortening.
    cond: 'Plan and pins on your phone. Only the map background needs signal',
    n: null,
    unit: 'no signal',
  },
  { name: 'Install', cond: 'Home screen, opening straight into today', n: null, unit: 'home screen' },
] as const;

/**
 * Sample-trip chapters. `accent` colours the large numeral, so its bar is 3:1. `focus` is the
 * per-photo crop for a wide band.
 */
const CHAPTERS = [
  {
    no: '01',
    country: 'np',
    accent: 'var(--marigold)',
    // Swayambhunath, not Boudhanath: two white stupas in a row would read as one picture.
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
    // Fushimi Inari: centred vanishing point survives a wide crop.
    src: '/images/map/jp-fushimi.jpg',
    focus: 'center 50%',
    eyebrow: 'Leg two',
    title: 'Japan',
    body: 'New Year in the cities, early trains, and a fortnight of cold, bright light.',
    when: 'Dec 2026 – Jan 2027',
  },
] as const;

/** Account vs Trip Token: two credentials that are never mixed (D-239). */
const TOKENS = [
  {
    name: 'Your account',
    chip: 'chip--struck',
    what: 'One per person',
    rule: 'Username and password · never share it',
  },
  {
    name: 'Trip Token',
    chip: '',
    what: 'One per trip',
    rule: 'Opens one trip · this is the one you send',
  },
] as const;

/**
 * Screenshots. Regenerate with `PLAYWRIGHT_SHOOT=1 npx playwright test e2e/landing-shots.spec.ts`
 * then `npm run gen:images`, and re-read every alt against the new pixels.
 * `alt` must differ from `caption` (axe image-redundant-alt): the caption says what the feature
 * is, the alt says what's in the picture.
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
 * Inverted button for the mint closing block. Keep the surface-coloured ring offset: without
 * the dark gap a volt ring on mint is 1.03:1 and invisible. contrast-tokens.mjs guards it.
 */
const CTA_INVERTED =
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-r1 px-6 font-machine text-t-label font-semibold uppercase tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** Hollow frame shown when a screenshot fails to load. */
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
   * The wall's `?trip=` notice, rendered first inside the cover (the cover bleeds to the top
   * edge, so it can't sit above). Must not contain anything focusable.
   */
  notice?: ReactNode;
  onCreate: () => void;
  onLogin: () => void;
  onJoin: () => void;
}) {
  // Literal '/', not usePathname(): the wall covers every route, but it is always the front door.
  // Lazy init so the ledger is written once per mount.
  const [entrance] = useState(() => entranceFor('/'));
  // The keyframe rests at opacity 1, so 'present' is just the class being absent.
  const reveal = entrance === 'animate' ? 'animate-reveal-up' : '';

  return (
    <div data-testid="landing-page" className="flex flex-col">
      {/* Cover. Negative margins cancel the panel padding so the photo reaches its edge.
          Text is bottom-aligned on purpose so it sits on the dark end of the scrim. */}
      <div
        className="door-cover photo-header -mx-6 -mt-6 sm:-mx-8 sm:-mt-8"
        data-country="np"
        style={{ ['--photo-focus']: 'center 38%' } as CSSProperties}
      >
        {/* Decorative backdrop; the <h1> carries the meaning. No fallback needed: a failed
            load leaves a flat dark cover, darker than the measured worst case. */}
        <div className="photo-header__media" aria-hidden="true">
          {/* Ken Burns scales the image only; scaling the scrim would shift the contrast. */}
          <span className="door-kb">
            {/* The panel caps at 1088px, so don't fetch for 100vw on desktop. LCP image. */}
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
            <p className="pr pr--l text-primary">Group trip planner</p>
            {/* No bold utility here; the display step sets the weight. */}
            <h1
              id={titleId}
              className="max-w-[13ch] font-display text-editorial-xl text-ink-hi"
            >
              Every day of the trip, in one place.
            </h1>
            <p id={descId} className="max-w-[46ch] text-t-lead leading-relaxed text-ink-mid">
              Itinerary, map and bookings in one plan your whole group can see &mdash; and it still
              works when you have no signal.
            </p>

            {/* Log in first in DOM order: the wall focuses the first enabled button. */}
            <div className="mt-2 flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onLogin}
                data-testid="landing-cta-login"
                className="btn px-6"
              >
                I have an account &mdash; log in
              </button>
              {/* .btn--2's --border-ui edge clears 3:1 over the photo; --border would not. */}
              <button
                type="button"
                onClick={onCreate}
                data-testid="landing-cta-create"
                className="btn btn--2 px-6"
              >
                Create an account
              </button>
            </div>
            {/* Goes to signup, not log in: a Trip Token is added on the Trips page after
                creating an account (D-239). The note explains that and is wired with
                aria-describedby. Hover uses ink-hi because an opacity modifier on text-primary
                emits nothing. */}
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

      {/* Fact strip. */}
      <dl className="cells cells--4 -mx-6 sm:-mx-8" data-testid="landing-facts">
        {FACTS.map(({ label, value, foot }) => (
          <div key={label} className="cell">
            <dt className="l">{label}</dt>
            <dd className="v">{value}</dd>
            <dd className="f">{foot}</dd>
          </div>
        ))}
      </dl>

      {/* Features. Each row says its state in words; the mark is redundant. */}
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

      {/* Sample-trip chapters. The divider is a 1px grid gap over bg-border. */}
      <section aria-labelledby="landing-legs-heading" className="-mx-6 mt-12 sm:-mx-8">
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-legs-heading">The sample trip</h2>
          <span className="sub">Nepal and Japan &middot; 32 days</span>
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
                  {/* Half the capped panel; below the fold, so no priority. */}
                  <OptimizedImage src={src} alt="" fill sizes="(min-width: 640px) 544px, 100vw" />
                  <span className="photo-header__duo-lo" />
                  <span className="photo-header__duo-hi" />
                  <span className="photo-header__scrim" />
                </div>
                <div className="photo-header__body">
                  <div className={`px-gut ${reveal}`}>
                    <p className="pr">{eyebrow}</p>
                    {/* Decorative numeral, hidden from assistive tech. */}
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
              {/* Below the photo, so ink-lo is fine here. */}
              <div className="capline">
                <span className="pr">Plate {no}</span>
                <span className="pr pr--lo">{title}</span>
                <span className="pr pr--lo">{when}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshots */}
      <section aria-labelledby="landing-shots-heading" className="-mx-6 mt-12 sm:-mx-8">
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-shots-heading">What it looks like</h2>
          <span className="sub">{SHOTS.length} figures</span>
        </div>
        <ul className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 px-gut sm:grid-cols-3">
          {SHOTS.map(({ id, fig, src, caption, alt }) => (
            <li key={id}>
              <figure data-testid={id}>
                {/* The aspect box reserves a phone shape before the image decodes; login.spec.ts
                    measures this slot. */}
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

      {/* How sharing works */}
      <section
        aria-labelledby="landing-token-heading"
        data-testid="landing-tokens"
        className="-mx-6 mt-12 sm:-mx-8"
      >
        <div className="sec mx-auto max-w-[1200px] px-gut">
          <h2 id="landing-token-heading">Trips move as a token</h2>
          <span className="sub">Token or invite</span>
        </div>
        <div className="mx-auto max-w-[1200px] px-gut">
          <p className="max-w-[64ch] text-t-body leading-relaxed text-ink-mid">
            A trip has one string attached to it, and you send it the way you already talk to each
            other &mdash; or send a one-use invite link instead. Your account and a trip&rsquo;s token do
            two different jobs, and they are never the same thing.
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

      {/* Closing CTA. Text is --on-accent, never white; see CTA_INVERTED for the ring. */}
      <div
        className="-mx-6 mt-12 flex flex-col items-center gap-4 px-gut py-10 text-center sm:-mx-8"
        style={{ background: 'var(--mint)', color: 'var(--on-accent)' }}
      >
        <span className="font-machine text-t-micro font-semibold uppercase tracking-[0.14em]">
          No subscription &middot; no card
        </span>
        <p className="text-display-xl">Start the countdown.</p>
        <p className="max-w-[38ch] text-t-body leading-relaxed">
          No email needed. Just a username and a password.
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

      {/* Sign-off. A <div>, not <footer>; see the landmark note at the top. */}
      <div className="mt-10 text-center">
        <span className="pr pr--lo">
          Trip Journey &middot; plan together, even offline
        </span>
        <LegalLinks className="mt-2" />
      </div>
    </div>
  );
}
