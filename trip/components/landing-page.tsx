'use client';

import { CalendarRange, Coins, PlaneTakeoff } from 'lucide-react';
import OptimizedImage from '@/components/optimized-image';

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
 *
 * 🔴 COLOUR: semantic tokens ONLY (`text-foreground`, `text-muted-foreground`, `bg-primary`,
 * `text-primary-foreground`, `border-border`, `ring-ring`, the `.glass-*` recipes). No status-gold
 * class and no raw hex anywhere (same grep rule as above — the literals are omitted on purpose).
 * A NEW file is structurally invisible to every palette sweep whose worklist predates it —
 * that is exactly how `sign-out-confirm.tsx:102` shipped a gold focus ring no sweep could reach. The
 * ONLY hues here are `himalaya`/`sakura` in the split band, which is deliberate country wayfinding
 *, not chrome.
 *
 * filled `landing-shot-1..3` with real product screenshots of a FICTIONAL trip, shot by
 * `e2e/landing-shots.spec.ts` at 390×844 and fed through the repo's AVIF/WebP pipeline. The slots
 * kept their stable testids and their fixed phone aspect ratio (so nothing reflowed when the images
 * landed). Each shot carries a <figcaption> (what the feature is) AND a distinct `alt` (what is in
 * the picture) — see the SHOTS comment for the measured axe reason those two strings differ.
 *
 * 🔴 TWO THINGS DID **NOT** DO THE WAY THIS COMMENT ORIGINALLY SAID (both deliberate):
 * 1. NOT a raw <img>. `next.config.js` sets a `basePath` for the GitHub Pages build, and a raw
 * `<img src="/images/…">` breaks there. `OptimizedImage` is the single basePath-safe path
 * and it also brings <picture> AVIF/WebP + the LQIP blur-up for free.
 * 2. NOT a baked-in device bezel. The "device frame" is the slot's own `rounded-2xl border` —
 * CSS, so it tracks the theme token instead of freezing a border colour into a raster.
 *
 * 🔴 AND THE THING NO CHECK IN THIS REPO CAN VERIFY: the guard above ("no live trip data") is a
 * DOM/text assertion. Text baked into a PNG passes it trivially. The three images are safe only
 * because the shoot seeds a purpose-built fictional trip with fictional names — never
 * `SAMPLE_ITINERARY`, which is a re-export of the real content pack. Re-shooting against real data
 * would publish it to every logged-out visitor and every automated check here would stay green.
 */

const FEATURES = [
  {
    icon: CalendarRange,
    title: 'Plan each day',
    body: "Drag things into the order you'll actually do them.",
  },
  {
    icon: Coins,
    title: 'Split the money',
    body: 'Log what you paid in yen or rupees; see who owes who.',
  },
  {
    icon: PlaneTakeoff,
    title: 'Works on the plane',
    body: 'Everything is saved on your phone. No signal needed.',
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
 * 🔴 `alt` IS DELIBERATELY NOT `caption`. The brief for this change said to reuse the caption as the
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
    alt: 'A phone screen: the Expenses tab listing costs in yen and rupees, each row carrying a category tag, who logged it, and a “split 3” marker where the bill was shared.',
  },
  {
    id: 'landing-shot-3',
    src: '/images/landing/shot-3-map.png',
    caption: 'The offline trip map with saved places pinned.',
    alt: 'A phone screen: the trip map over Kathmandu, with the day’s numbered stops joined by a dashed route and coloured pins for places to see, eat and stay.',
  },
] as const;

const CTA_BASE =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export default function LandingPage({
  titleId,
  descId,
  onCreate,
  onLogin,
  onJoin,
}: {
  /** The wall's `aria-labelledby` target — this view's <h1> carries it. */
  titleId: string;
  /** The wall's `aria-describedby` target — the lead paragraph carries it. */
  descId: string;
  onCreate: () => void;
  onLogin: () => void;
  onJoin: () => void;
}) {
  return (
    <div data-testid="landing-page" className="flex flex-col gap-12 sm:gap-16">
      {/* ── Hero ─────────────────────────────────────────────────────────────────────────
          Plain <div>s, NOT <header>/<footer>. Those map to the banner/contentinfo LANDMARKS, and
          the app's own navbar + <Footer /> are still mounted in the DOM behind this wall ( —
          the wall is an overlay, it does not unmount `{children}`). axe caught the duplicate
          contentinfo at both breakpoints; landmarks inside a modal dialog buy nothing anyway. ── */}
      <div className="flex flex-col items-start gap-4">
        <p className="text-eyebrow uppercase text-muted-foreground">Dec 2026 &mdash; Jan 2027</p>
        <h1
          id={titleId}
          className="max-w-3xl font-display text-display-xl text-foreground"
        >
          Every day of the trip, in one place.
        </h1>
        <p id={descId} className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          Kathmandu in December, Japan for New Year. Twenty-two days, two countries, one plan your
          whole group can see &mdash; and it still works when you have no signal.
        </p>

        <div className="mt-2 flex flex-col gap-3 self-stretch sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onCreate}
            data-testid="landing-cta-create"
            className={`${CTA_BASE} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            Create an account
          </button>
          <button
            type="button"
            onClick={onLogin}
            data-testid="landing-cta-login"
            className={`${CTA_BASE} border border-border text-foreground hover:bg-muted/40`}
          >
            I have a key &mdash; log in
          </button>
        </div>
        <button
          type="button"
          onClick={onJoin}
          data-testid="landing-cta-join"
          className="inline-flex min-h-[44px] items-center rounded-lg px-1 text-sm font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Someone shared a trip with me
        </button>
      </div>

      {/* ── What you get ─────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="landing-features-heading" className="flex flex-col gap-5">
        <h2 id="landing-features-heading" className="sr-only">
          What the planner does
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="glass-card rounded-2xl p-5">
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-display text-lg font-bold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── The two legs. The ONE place country hue is allowed. ── */}
      <section aria-labelledby="landing-legs-heading" className="flex flex-col gap-5">
        <h2 id="landing-legs-heading" className="font-display text-2xl font-bold text-foreground">
          Two countries, one trip
        </h2>
        <div
          data-testid="landing-split-band"
          className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border sm:grid-cols-2"
        >
          <div className="bg-himalaya-500/[0.14] px-5 py-6 sm:px-6">
            <p className="text-eyebrow uppercase text-himalaya-400">Leg one</p>
            <p className="mt-2 font-display text-2xl font-bold text-foreground">Nepal</p>
            {/* `text-foreground`, NOT `text-muted-foreground`: the country tint lightens the fill
                under it and axe measured muted at 4.1:1 on the sakura half — below the 4.5 floor. */}
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">
              Kathmandu valley mornings, momo stops, and the long drive out to the foothills.
            </p>
          </div>
          <div className="border-t border-border bg-sakura-400/[0.14] px-5 py-6 sm:border-l sm:border-t-0 sm:px-6">
            <p className="text-eyebrow uppercase text-sakura-300">Leg two</p>
            <p className="mt-2 font-display text-2xl font-bold text-foreground">Japan</p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">
              New Year in the cities, early trains, and a fortnight of cold, bright light.
            </p>
          </div>
        </div>
      </section>

      {/* ── Screenshot slots ──────────────────────────────────────── */}
      <section aria-labelledby="landing-shots-heading" className="flex flex-col gap-5">
        <h2 id="landing-shots-heading" className="font-display text-2xl font-bold text-foreground">
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
                <figcaption className="text-xs leading-relaxed text-muted-foreground">
                  {caption}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="landing-steps-heading" className="flex flex-col gap-5">
        <h2 id="landing-steps-heading" className="font-display text-2xl font-bold text-foreground">
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map(({ title, body }, i) => (
            <li key={title} className="glass-subtle rounded-2xl p-5">
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border font-mono text-sm font-bold tabular-nums text-primary"
              >
                {i + 1}
              </span>
              <h3 className="mt-3 text-base font-semibold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-start gap-3 border-t border-border pt-8">
        <p className="text-sm text-muted-foreground">
          No email, no password. Just a key you keep.
        </p>
        <button
          type="button"
          onClick={onCreate}
          data-testid="landing-cta-create-footer"
          className={`${CTA_BASE} bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          Create an account
        </button>
      </div>
    </div>
  );
}
