'use client';

import type { CSSProperties } from 'react';
import OptimizedImage from '@/components/optimized-image';

/**
 * PageHero — the per-page masthead.
 *
 * TWO SHAPES, ONE COMPONENT, and the shape follows the route's tier:
 *
 * - **Tier 2 (`/guides`, `/nepal`, `/japan`, `/map`, `/journal`, `/flights`)** — a
 *   full-bleed photographic band: duotone-graded photography, a two-ramp scrim, an
 *   editorial title and ONE accent colour that says which route you are on. This is
 *   the whole of a Tier-2 route's loudness allowance; below the band those routes are
 *   Tier 3 again, which is why the band carries `data-tier="2-header"` — the loud
 *   tokens are legal inside that subtree and nowhere else on the page.
 * - **Tier 3 (`/plan`, `/more`)** — unchanged: the `.glass-panel` card, a brand wash,
 *   no photography at all. Tier 3 forbids imagery, so the one variant those two routes
 *   share declares no photo and takes the original render path.
 *
 * THE ACCENT PER ROUTE, and every one of them is a token from `globals.css` — no
 * component in this file names a colour of its own:
 *
 *   /guides   --coral    | /nepal   --np-b (with the country gradient on the h1)
 *   /map      --marigold | /japan   --jp-a (with the country gradient on the h1)
 *   /journal  --violet   | /flights --mint
 *
 * THE RULE IS THAT A PAGE IDENTITY MAY NOT BE THE CHROME ACCENT — a route that claims the
 * app-wide accent (focus ring, tab-bar active tint, section underline) collides with the
 * chrome rather than distinguishing itself from it. Under D-334 that used to exclude
 * `--marigold`; the chrome accent is now `--volt`, and marigold is free.
 *
 * WHY /map IS MARIGOLD, since it was briefly --volt and that broke the rule above.
 * /map's accent was `--sky`, and D-334 renamed and re-valued that slot to `--volt` — the
 * new chrome accent — so /map inherited the collision MECHANICALLY, as a side effect of a
 * rename rather than as anyone's decision. Fixed in the same change that caused it: a
 * collision introduced by a token slice should not outlive it.
 *
 * Marigold is genuinely free, and that is the whole argument. It had exactly two roles:
 * primary action, which is now `--volt`'s, and Nepal. Nepal's identity is carried by
 * `--np-a` / `--np-b` / `--grad-nepal`, which are their OWN tokens — `--np-b` merely
 * SHARES marigold's hex, it is not this token. So this does not re-double-book the accent
 * the way D-334 just un-double-booked it.
 *
 * What the /map palette slice still owes (D-292, which asserted /map into a tier without
 * designing the route) is the map PIN palette. That is a different question from the
 * header eyebrow and is untouched here.
 *
 * `--sky` was previously the ruled accent for BOTH /map and /flights; /flights takes
 * `--mint` ("done · offline-ready" — a booked leg), because two routes sharing an accent
 * defeats the point of a route having one.
 *
 * PHOTOGRAPHY. Every image is already bundled and already attributed in
 * `public/images/CREDITS.md`; nothing new was fetched and nothing is hotlinked. Each
 * one was OPENED before it was chosen, and what it actually shows is recorded beside
 * it below — three other filenames in this repo point at one photograph whose
 * obvious-sounding name does not describe it, so the file name is not evidence.
 *
 * ALT TEXT. The band is decorative: `alt=""` plus `aria-hidden` on the wrapper, which
 * is the ruled treatment for a graded, scrimmed backdrop. The <h1> beside it carries
 * the meaning, and a screen reader that announced "Boudhanath stupa" on a page titled
 * "Nepal" would be adding noise, not information. Content photography elsewhere in the
 * app (guide cards, the Home gallery, journal entries) keeps its real descriptions.
 *
 * CONTRAST. Measured, not asserted, in `scripts/contrast-tokens.mjs`, which models both
 * scrim ramps and the duotone highlight cap: worst case behind ANY text pixel in the
 * band is 12.96:1 for the title over Nepal / 13.31:1 over Japan, 7.90 / 8.11 for the
 * subtitle, and 5.21-8.15 for the six accent eyebrows. Edit that harness with this file.
 *
 * AND THE NAVBAR IS PART OF THAT MEASUREMENT. `navbar.tsx` is fixed and transparent
 * until you scroll, so a full-bleed band puts the app's own chrome on a photograph on
 * six routes at once — the links measured 3.25:1 on the band ramp alone. The scrim
 * carries a flat top layer across the bar's 64px for exactly that reason; the numbers
 * and the reasoning are on `.photo-header__scrim` in globals.css.
 *
 * MOTION. Tier 2 forbids ambient motion including in the header, so the band has no
 * Ken Burns, no parallax and no zoom — there is nothing here for reduced motion to
 * switch off. The one animation is `.animate-reveal-up` on the text block: a one-shot
 * entrance whose resting state is opacity 1, collapsed to ~0ms by the reduced-motion
 * block in globals.css, so it can never hold content invisible.
 *
 * ACCESSIBILITY. `as` controls the heading level so the hierarchy stays correct per
 * page (pages that already own an <h1> pass `as="h2"`); the band is a <header>
 * landmark; the photographic layers are one `aria-hidden` subtree containing no
 * focusable node, so nothing is hidden from a keyboard user by hiding it from AT.
 */

type HeroVariant = 'guides' | 'nepal' | 'japan' | 'map' | 'journal' | 'flights' | 'plan';

interface PageHeroProps {
  variant: HeroVariant;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** Heading level for the title. Default 'h1'. Use 'h2' on pages that already own an <h1>. */
  as?: 'h1' | 'h2';
  /** Optional extra classes on the outer <header> (e.g. spacing overrides at mount). */
  className?: string;
}

interface HeroPhoto {
  /** Manifest key in `lib/image-manifest.json`. All six carry a 1024w derivative. */
  src: string;
  /** Which duotone the grade uses. Follows the PHOTO's country, not the route's. */
  country: 'np' | 'jp';
  /**
   * `object-position` for the band crop. Real photographs of real places do not put
   * their subject in the same place twice, and a full-bleed band is a much wider crop
   * than the source ratio — this is the knob that keeps the subject in frame.
   */
  focus: string;
}

interface HeroVariantConfig {
  /** A token from globals.css. Never a literal colour. */
  accent: string;
  /** Title treatment: the country gradient, or the solid display colour. */
  titleClass: string;
  /** Present ⇒ Tier-2 photographic band. Absent ⇒ the Tier-3 glass panel. */
  photo?: HeroPhoto;
  /** Tier-3 only: the brand tint layered over the glass fill. */
  wash?: string;
}

const VARIANTS: Record<HeroVariant, HeroVariantConfig> = {
  // Sensō-ji, Asakusa: the main hall's sweeping tiled roof and red timber frontage,
  // the great lantern in the entrance bay, incense smoke, a crowd walking up to it
  // under a clear sky. Landscape. The chooser page fronts both countries and no single
  // bundled photograph shows both, so it takes the one that most reads as "somewhere
  // you would want a guide".
  guides: {
    accent: 'var(--coral)',
    titleClass: 'text-display-emphasis',
    photo: { src: '/images/japan/ja1.jpg', country: 'jp', focus: 'center 44%' },
  },
  // Boudhanath, Kathmandu: the whitewashed dome and gilded spire, the Buddha's painted
  // eyes on the harmika, prayer-flag lines running out to the corners, blue sky.
  nepal: {
    accent: 'var(--np-b)',
    titleClass: 'text-gradient-himalaya',
    photo: { src: '/images/featured/boudhanath.jpg', country: 'np', focus: 'center 38%' },
  },
  // Mount Fuji from Ōwakudani, Hakone — which is on the itinerary: the snow-capped
  // cone filling a cloudless sky above a dark forested ridge. Already a 2:1 crop, so
  // it loses almost nothing to the band.
  japan: {
    accent: 'var(--jp-a)',
    titleClass: 'text-gradient-sakura',
    photo: { src: '/images/featured/mount-fuji.jpg', country: 'jp', focus: 'center 52%' },
  },
  // Shibuya Crossing from above at night: the intersection packed with people, lit
  // billboards stacked six storeys up, glass towers either side. An aerial — the map
  // page's header is a place seen from above, which is what the page does.
  map: {
    accent: 'var(--marigold)',
    titleClass: 'text-display-emphasis',
    photo: { src: '/images/featured/shibuya.jpg', country: 'jp', focus: 'center 48%' },
  },
  // Garden of Dreams, Kathmandu: the white neoclassical pavilion behind a long
  // reflecting pool, palms and bare winter trees, deep blue sky. The quietest image in
  // the set, for the quietest page.
  journal: {
    accent: 'var(--violet)',
    titleClass: 'text-display-emphasis',
    photo: { src: '/images/nepal/na7.jpg', country: 'np', focus: 'center 58%' },
  },
  // The Great Himalayan Range from Dhulikhel: snow peaks along the horizon under a
  // huge clear sky, the valley hazing out below them. The crop is pushed down the
  // frame because the peaks sit low in the source; the foreground clutter it picks up
  // lands in the darkest part of the scrim.
  flights: {
    accent: 'var(--mint)',
    titleClass: 'text-display-emphasis',
    photo: { src: '/images/nepal/na19.jpg', country: 'np', focus: 'center 74%' },
  },
  // TIER 3 — /plan and /more. No photography, by rule. Unchanged.
  plan: {
    accent: 'hsl(var(--accent-scroll))',
    titleClass: 'text-display-emphasis',
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(240,199,96,0.12) 0%, transparent 55%)',
  },
};

export default function PageHero({
  variant,
  title,
  eyebrow,
  subtitle,
  as = 'h1',
  className = '',
}: PageHeroProps) {
  const { accent, titleClass, photo, wash } = VARIANTS[variant];
  const Heading = as;

  const copy = (
    <>
      {eyebrow && (
        <p className="text-eyebrow uppercase mb-3" style={{ color: accent }}>
          {eyebrow}
        </p>
      )}
      <Heading className={`font-display text-display-lg ${titleClass}`}>{title}</Heading>
      {subtitle && (
        <p className={`mt-3 max-w-2xl text-base leading-relaxed ${photo ? 'text-ink-mid' : 'text-muted-foreground'}`}>
          {subtitle}
        </p>
      )}
    </>
  );

  // ---- Tier 3: the glass panel, exactly as it was ----
  if (!photo) {
    return (
      <header className={`px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10 ${className}`}>
        <div className="glass-panel animate-reveal-up relative overflow-hidden mx-auto max-w-[1200px] px-6 py-8 sm:px-10 sm:py-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: wash }}
          />
          <div className="relative">{copy}</div>
        </div>
      </header>
    );
  }

  // ---- Tier 2: the photographic band ----
  // The band starts at the top of the document and runs UNDER the fixed 64px navbar,
  // which is the point of a full-bleed header. The body's 92px top padding is what
  // clears the navbar, and it is also what holds every text pixel below the local
  // scrim floor's 68px stop — one number doing both jobs, so neither can drift.
  //
  // No `fallback` is passed to OptimizedImage deliberately: if the raster ever fails,
  // the duotone layers collapse onto the page field and the band degrades to a flat
  // dark masthead — darker than the graded worst case the harness measures, because
  // the thing that made that case worst was the highlight cap the photo supplied. A
  // fallback graphic would be a second design to maintain for a case that already
  // lands somewhere more legible than the one that is measured.
  return (
    <header
      data-tier="2-header"
      data-country={photo.country}
      className={`photo-header ${className}`}
      style={{ ['--photo-focus']: photo.focus } as CSSProperties}
    >
      <div className="photo-header__media" aria-hidden="true">
        <OptimizedImage src={photo.src} alt="" fill sizes="100vw" priority />
        <span className="photo-header__duo-lo" />
        <span className="photo-header__duo-hi" />
        <span className="photo-header__scrim" />
      </div>

      <div className="photo-header__body">
        <div className="animate-reveal-up mx-auto w-full max-w-[1200px] px-gutter">{copy}</div>
      </div>
    </header>
  );
}
