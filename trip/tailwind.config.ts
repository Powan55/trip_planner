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
    // which destroyed the coincidence and would have left the chip colourless. Measured evidence:
    // docs/plans/s353c-sweep-evidence-2026-08-01.md.
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
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'var(--radius-lg)',
        // v2 additive larger radii for panels/heroes.
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
        // type scale collapsed to ~6 core steps. Rather than remap
        // every `text-*` across dozens of components, the redundant near-duplicate
        // keys are re-pointed DOWNWARD onto a neighbour (shrink-only, so no new
        // overflow risk at the new 17px base): xl→lg, 3xl→2xl, 5xl→4xl. The six
        // discrete core sizes are then: text-xs · text-sm · text-base(17px) ·
        // text-lg · text-2xl · text-4xl, plus the editorial `display-*` hero clamps
        // (below) and the `eyebrow` overline (a distinct role, not a size).
        // Zero component edits; the collapse is entirely at the token layer.
        'xl': ['1.125rem', { lineHeight: '1.75rem' }],   // → text-lg
        '3xl': ['1.5rem', { lineHeight: '2rem' }],       // → text-2xl
        '5xl': ['2.25rem', { lineHeight: '2.5rem' }],    // → text-4xl
        // Editorial DISPLAY scale (hero clamps — additive keys). Heroes pair these
        // with font-display +.text-gradient-*; overlines use `text-eyebrow uppercase`.
        'display-2xl': ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '1.02', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-xl': ['clamp(2.25rem, 4.6vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '600' }],
        'display-lg': ['clamp(1.875rem, 3.4vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-md': ['clamp(1.5rem, 2.4vw, 2rem)', { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '600' }],
        'eyebrow': ['0.75rem', { lineHeight: '1', letterSpacing: '0.22em', fontWeight: '600' }],
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
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        'surface-overlay': 'rgb(var(--surface-overlay) / <alpha-value>)',
        gold: { 400: '#f0c760', 500: '#d4a843', 600: '#b8922e' },
        sakura: { 300: '#ffb7c5', 400: '#f7a0b3', 500: '#e88fa2' },
        himalaya: { 400: '#ff8c42', 500: '#e67635', 600: '#cc6228' },
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
