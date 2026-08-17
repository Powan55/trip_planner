import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    // 🔴 — `lib/` IS a class-name source and must stay scanned. DO NOT prune this as an
    // over-broad glob. `lib/trip-data.ts`'s CATEGORY_COLORS holds the 30 itinerary-chip classes
    // (and `lib/fly-chip.ts` a few more); every component that renders a chip reads them from
    // there rather than writing them inline ( forbids interpolating class names, so the
    // table is the right home). While this glob was missing, those utilities emitted CSS only
    // when some component happened to contain the byte-identical string — 4 of the 10 categories
    // had NEVER rendered their declared colour, and `transportation` rendered purely because
    // trip-map.tsx carried the same cyan trio for its "Day Trip" badge. re-hued that badge,
    // which destroyed the coincidence and would have left the chip colourless.
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // a SECOND family is admitted, for DISPLAY ONLY.
        // `sans` = Geist (variable, OFL); `display` = Instrument Serif 400 latin,
        // loaded with `preload:false` (layout.tsx) — that flag is what makes the
        // second face affordable and must not be removed.
        //
        // The flip is gated on the font audit, which resolved REPAIR-THEN-FLIP:
        // there are 80 live `font-display` sites (NOT the 85 this comment used to
        // claim, and not the plan's 84 — reconciled by two independent audits), of
        // which 4 were leaks where `font-display` had been reached for to get WEIGHT
        // on a data VALUE. Those four are repaired in the same commit as this flip
        // (token-gate/budget-panel -> font-mono; weather-card/flight-journey-card ->
        // dropped). Inheritance was walked across all 30 container sites: no
        // `font-display` sits on a page/section/card wrapper, so the serif cannot
        // leak onto descendants.
        //
        // STANDING RULE: `font-display` is for HEADINGS, never for a value.
        // A value that must align or be read for precision takes `font-mono`.
        //
        // `mono` still ALIASES the sans var + the `tnum` OpenType feature — Geist
        // ships real tabular figures, so the 42 `font-mono` sites keep aligning with
        // NO third download. Countdown/budget/flights are the domains that depend on
        // it, and all three had a `font-display` instance that escaped it until now.
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: [['var(--font-sans)', 'ui-monospace', 'monospace'], { fontFeatureSettings: '"tnum"' }],
        // the concierge's code face. System fonts ONLY — zero download, no new webfont — kept
        // distinct from `mono` above (which deliberately ALIASES the sans var for tabular numerals).
        code: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        // the `bg-aurora` key is gone with --gradient-aurora (decoration removal).
      },
      // Mapping unchanged; the VALUES behind it de-flatten in globals.css, which is
      // where the reasoning and the audited blast radius live. Rendered px after
      // that change (the vars are px, so these are exact and do not scale with the
      // 17px root): rounded-sm 8 · rounded-md 10 · rounded-lg 12 · rounded-xl 12 ·
      // rounded-2xl 28 · rounded-3xl 40.
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'var(--radius-lg)',
        // the larger radii for panels/heroes — no longer aliases of -lg.
        '2xl': 'var(--radius-xl)',
        '3xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        // elevation tiers + scroll-accent glow (driven by CSS vars).
        glow: 'var(--shadow-glow)',
        xl: 'var(--shadow-xl)',
        // v2 deepest elevation for hero/panel surfaces.
        '2xl': 'var(--shadow-2xl)',
      },
      fontSize: {
        // The type scale had been COLLAPSED to ~6 core steps by re-pointing three
        // built-in keys DOWNWARD onto a neighbour (xl→lg, 3xl→2xl, 5xl→4xl). Those
        // three overrides are DELETED, so `text-xl` / `text-3xl` / `text-5xl` return
        // to Tailwind's own 1.25 / 1.875 / 3rem. The collapse was a shrink-only
        // safety move; the locked direction needs the range back, because a scale
        // with no jumps in it is exactly what made the app read as flat.
        //
        // THE ROOT-SIZE TRAP, and the choice made here. The ruled scale was authored
        // at a 16px root; this app runs 17px (html{font-size:106.25%}), so every rem
        // below renders 6.25% LARGER than the reference screenshots. The two legal
        // options were (a) keep the values and re-run the 0-overflow matrix at
        // 360/390/414, or (b) divide every rem by 1.0625 to reproduce the reference
        // pixel sizes. TAKEN: (a). The larger scale serves the goal, and the 17px
        // root is a deliberate prior decision that should not be quietly undone by
        // a division buried in a config file. The overflow matrix is owed, not
        // optional — the un-collapse changes 21 bare sites at 360px (every
        // responsive `text-3xl`/`text-5xl` use is `sm:`-prefixed and cannot fire
        // there).
        //
        // Editorial DISPLAY scale (hero clamps). KEY NAMES ARE KEPT — they have live
        // consumers — and only the values move, onto the ruled steps:
        //   display-2xl <- t-display-xl   display-xl <- t-display-l
        //   display-lg  <- t-h1           display-md <- t-h2
        // Weight goes 600 -> 800 across all four: these are sans display steps and
        // the ruled weight is 800.
        'display-2xl': ['clamp(2.9rem, 12.5vw, 5.2rem)', { lineHeight: '0.96', letterSpacing: '-0.035em', fontWeight: '800' }],
        'display-xl': ['clamp(2.1rem, 8.6vw, 3.4rem)', { lineHeight: '0.96', letterSpacing: '-0.035em', fontWeight: '800' }],
        'display-lg': ['clamp(1.65rem, 6vw, 2.2rem)', { lineHeight: '1.06', letterSpacing: '-0.035em', fontWeight: '800' }],
        'display-md': ['1.32rem', { lineHeight: '1.18', letterSpacing: '-0.02em', fontWeight: '800' }],
        // The overline, retuned onto the ruled micro step (.68rem = 11.6px at the
        // 17px root, tracking .12em, weight 800). Kept as its own key because it is
        // a ROLE, not a size.
        'eyebrow': ['0.68rem', { lineHeight: '1', letterSpacing: '0.12em', fontWeight: '800' }],
        // SERIF editorial steps — additive keys, no consumers in this change; the
        // front-door work inherits them. WEIGHT 400 IS NOT A TYPO: Instrument Serif
        // ships weight 400 only, so pairing `font-display` with `font-bold` /
        // `font-semibold` produces a browser-SYNTHESISED bold, which is already a
        // live defect in this codebase. Pinning 400 in the step is what stops the
        // next author reaching for a weight that does not exist.
        'editorial-xl': ['clamp(3rem, 12.5vw, 7rem)', { lineHeight: '0.94', letterSpacing: '-0.02em', fontWeight: '400' }],
        'editorial-lg': ['clamp(2.4rem, 9vw, 4.6rem)', { lineHeight: '0.96', letterSpacing: '-0.02em', fontWeight: '400' }],
      },
      spacing: {
        // v2 8pt rhythm — additive semantic keys only (Tailwind's 4pt base covers
        // the rest; do NOT redefine the default scale).
        section: 'clamp(4rem, 8vw, 7rem)',   /* vertical rhythm between major sections */
        gutter: 'clamp(1rem, 4vw, 2rem)',    /* responsive page inset */
        '18': '4.5rem',
        '22': '5.5rem',
      },
      colors: {
        // former raw `navy` scale, now semantic surface tokens driven by
        // CSS vars (globals.css --surface* → --navy-* channel single source).
        // rgb(var / <alpha-value>) so opacity modifiers (bg-surface/60) match the
        // old bg-navy-900/60 byte-for-byte. Values pixel-identical, no recolor.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-low': 'rgb(var(--surface-low) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        'surface-overlay': 'rgb(var(--surface-overlay) / <alpha-value>)',
        // ---- The three brand families ----
        // HARDCODED DUPLICATES of the brand scales, not tokens — they are the reason
        // the class names carry any colour at all, so they move with the token layer
        // or the app ships two palettes. The FAMILY NAMES are kept even though `gold`
        // is now marigold, `sakura` the Japan pink and `himalaya` the Nepal orange;
        // the names still say which COUNTRY, which is what they are used for.
        //
        // THE 400 STEPS CARRY THE MERGED PALETTE. That is the chrome: ~113 class
        // sites across the three families (gold-400 33, sakura-400 44, sakura-300 2,
        // himalaya-400 34), and they take the ruled values — marigold #FFC43D,
        // --jp-a #FF8FC7, --np-a #FF8A3D. sakura-300 is a lighter tint (30% toward
        // white) of the new 400, keeping the relationship it had to the old one.
        //
        // THE 500 STEPS ARE DELIBERATELY FROZEN AT THE RETIRED VALUES. Not an
        // oversight and not a step that was forgotten — do not "finish the sweep"
        // here. lib/map-style.ts mirrors these three hexes into CATEGORY_COLOR for
        // the MapLibre paint layers (Attraction/Restaurant/Shopping), and
        // lib/__tests__/map-category-mirror.test.ts asserts the two sides are equal
        // at runtime. Moving a 500 without moving the map is a red test; moving the
        // map means choosing new pin colours, and /map's palette is unresolved under
        // D-292 (a route asserted into a tier without being designed). A token change
        // is the wrong place to settle it.
        //
        // 🔴 THE FINDING THAT WENT WITH THAT, AND HOW D-334 CLOSED IT. The retired
        // `gold-500 #d4a843` measures hue 41.8 and marigold measures hue 41.8 — a
        // delta of ZERO — so while marigold was the interaction accent the
        // `Attraction` map pin sat exactly ON it, with `Cultural` (4.1deg) and
        // `Restaurant` (19.7deg) barely better. The guard in
        // map-category-mirror.test.ts that exists to catch precisely this (a category
        // hue must sit >=30deg from the interaction signal) HARDCODED 189, the
        // retired cyan, so it passed through two whole accent changes while the
        // collision was real. D-334 moved the chrome accent to volt (hue 192) and made
        // that guard read the LIVE accent out of globals.css: the closest of the seven
        // categories is now `Hotel` at 46.7deg and every one passes honestly. The 500s
        // stay frozen — that is still the /map palette slice's call — but the freeze is
        // no longer covering for a defect.
        //
        // THE 600 STEPS take the new one-step-down shades. They have ZERO class sites
        // today, which is why they were free to move:
        //   gold-600     = --lip-marigold, the ruled shade for marigold
        //   sakura-600   = --lip-pink,     the ruled shade for the pink
        //   himalaya-600 = 0.76x per channel of --np-a. The palette has no lip for
        //                  the Nepal orange, and 0.76 is the red-channel ratio all
        //                  six ruled lips use, so this lands the missing lip on the
        //                  same rule rather than by eye.
        //
        // MEASURED on the D-334 page field, because these are used as text and not
        // only as fills: gold-400 12.25, gold-500 8.79, gold-600 6.07 · sakura-300
        // 11.62, sakura-400 9.28, sakura-500 8.23, sakura-600 4.85 · himalaya-400
        // 8.30, himalaya-500 6.50, himalaya-600 4.96. Every step clears AA as text on
        // the canvas, including the frozen ones. NONE OF THESE NINE HEXES MOVED in
        // D-334 — only the chrome accent and the surface ramp did, and these three
        // families are neither. The numbers changed because the FIELD under them did.
        //
        // THE COST OF FREEZING, named rather than left to be discovered: about 10
        // gold-500 sites now pair a retired-gold wash with marigold text — the
        // `bg-gold-500/90` badges, the `bg-gold-500/15 text-gold-400` chips, the
        // day-strip pill and the trip-map pin/badge pair. Same shape at 8 himalaya-500
        // and 3 sakura-500 sites. It is a visible mismatch, it is contained, and it
        // clears when the /map and badge slices sweep them.
        gold: { 400: '#FFC43D', 500: '#d4a843', 600: '#C08400' },
        sakura: { 300: '#FFB1D8', 400: '#FF8FC7', 500: '#e88fa2', 600: '#C25C90' },
        himalaya: { 400: '#FF8A3D', 500: '#e67635', 600: '#C2692E' },
        // ---- The three text tiers (the design system's floor rule, R-TEXT, makes this
        // set the DEFINITION of a legal text colour) ----
        // `text-ink-hi` / `text-ink-mid` / `text-ink-lo`. These are what issue #27's
        // route-by-route sweep replaces `text-white/NN` with. THE ALPHA-RAMP -> TIER
        // MAPPING, and the role rule that decides ties, live beside the token
        // declarations in app/globals.css — read that before sweeping a route, and do
        // not re-derive it per route.
        //
        // Deliberately NOT `rgb(var(--x) / <alpha-value>)` like the surface keys above.
        // The tiers are declared as HEX vars precisely so no alpha can multiply a tier
        // below AA (the D-100/D-246 defect class, retired by construction), and
        // consuming them as a plain `var()` keeps that true: Tailwind cannot attach an
        // opacity modifier to a value it can't parse.
        //
        // What `text-ink-mid/50` ACTUALLY does, corrected — the first draft of this comment
        // said "emits the flat tier colour", and that is wrong in the one direction that
        // matters. It emits NOTHING AT ALL (verified against generated CSS, not assumed), so
        // the class is inert and the element INHERITS its ancestor's colour. On a card with a
        // tinted parent that is not a tier at all. Safe outcome vs silent wrong colour is
        // exactly the distinction a sweeper needs, and ~132 sites are still to be converted by
        // someone who may read this comment first. The ramp still cannot be rebuilt on top of
        // the tiers — but the failure mode is inheritance, not a flat fallback.
        ink: { hi: 'var(--text-hi)', mid: 'var(--text-mid)', lo: 'var(--text-lo)' },
        // single scroll-driven accent.
        'accent-scroll': 'hsl(var(--accent-scroll))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
        // retire the 64 HARDCODED duration utilities with zero component
        // edits. `extend` overrides a built-in at the SAME key, so re-pointing
        // Tailwind's own '200'/'300'/'500' at the motion vars sweeps every existing
        // `duration-200` (47 sites), `duration-300` (12) and `duration-500` (5) onto
        // the token scale in place. Counted in-repo across app/ + components/; those
        // three are the ONLY numeric duration utilities used anywhere (no -75/-100/
        // -150/-700/-1000), so this covers 100% of them.
        '200': 'var(--duration-normal)',
        '300': 'var(--duration-slow)',
        '500': 'var(--duration-slower)',
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.4s ease-out',
        'fade-out': 'fade-out 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
