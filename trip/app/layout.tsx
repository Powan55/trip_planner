import { Geist, Instrument_Serif } from 'next/font/google'
import type { Viewport } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { ItineraryProvider } from '@/components/itinerary-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import CommandPalette from '@/components/command-palette'
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar'
import { StoragePersistence } from '@/components/storage-persistence'
import { OfflineBanner } from '@/components/offline-banner'
import { SyncStatusBadge } from '@/components/sync-status-badge'
import SeasonAccentEngine from '@/components/season-accent-engine'
import { withBasePath } from '@/lib/utils'
import { buildCsp, REFERRER_POLICY } from '@/lib/csp'
// the app-wide chrome islands (Navbar, Footer, mobile tab bar,
// quick-add FAB + host, expense-log host). Declared in a `'use client'` module
// because Next 15 forbids `dynamic({ssr:false})` in this Server Component layout
// (it exports metadata/viewport). Same island pattern; see chrome-islands.tsx.
import {
  Navbar,
  Footer,
  BottomTabBar,
  QuickAddFab,
  QuickAddHost,
  ExpenseLogHost,
  TripJoinHandshake,
} from './chrome-islands'

// TWO faces — a text family and a display family.
// `--font-sans` = Geist (variable weight axis, OFL, one download) carries the whole
// UI, including `font-mono`, which aliases it + `tnum` in tailwind.config (Geist has
// real tabular figures, so numerals still align with NO monospace download).
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
// `--font-display` = Instrument Serif, headings ONLY (never a data value —
// standing rule). `preload: false` is LOAD-BEARING: it is what keeps the second face
// off the critical path and is what made affordable at all. Do not remove it.
// The family ships weight 400 only; heading sites that pair `font-display` with
// `font-bold`/`font-semibold` get a synthesized bold.
const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  preload: false,
  variable: '--font-display',
})

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'Nepal × Japan Journey | Dec 2026 - Jan 2027',
  description: 'Premium travel planner for an epic Nepal and Japan adventure. Explore Kathmandu, Tokyo, Kyoto, and beyond.',
  icons: {
    icon: withBasePath('/favicon.svg'),
    shortcut: withBasePath('/favicon.svg'),
    // `apple` is basePath-critical, not decoration: with no <link rel="apple-touch-icon">
    // in the HTML, iOS "Add to Home Screen" falls back to <origin>/apple-touch-icon.png —
    // powan55.github.io/apple-touch-icon.png, outside /trip_planner — which 404s, so the
    // home-screen icon becomes a screenshot. gen-icons.mjs emits the file and gen-sw.mjs
    // already precaches it; nothing referenced it.
    apple: withBasePath('/icons/apple-touch-icon.png'),
  },
  // manifest is emitted at build time by scripts/gen-sw.mjs
  // (single basePath prefix source), so withBasePath here matches its start_url.
  manifest: withBasePath('/manifest.webmanifest'),
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Nepal×Japan',
  },
  openGraph: {
    title: 'Nepal × Japan Journey',
    description: 'Premium travel planner for an epic Nepal and Japan adventure.',
    // NOTE: pass a bare root-relative path here — do NOT wrap in
    // withBasePath(). Next resolves metadata image URLs against metadataBase,
    // and metadataBase already carries the basePath segment via
    // NEXT_PUBLIC_SITE_URL (the deployed origin including its basePath on CI).
    // Wrapping with withBasePath() would prepend /trip_planner a SECOND time,
    // producing /trip_planner/trip_planner/og-image.png. Local dev stays
    // correct: metadataBase=http://localhost:3000 -> /og-image.png.
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nepal × Japan Journey',
    description: 'Premium travel planner for an epic Nepal and Japan adventure.',
    images: ['/og-image.png'],
  },
}

// `viewportFit:'cover'` extends the layout viewport into the
// device safe-areas so `env(safe-area-inset-bottom)` resolves — required by the
// upcoming mobile bottom tab bar. width/initialScale restate Next's
// defaults (declaring `viewport` replaces the default meta tag).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  ///A6 (behavior 6, keyboard-offset): native, zero-JS keyboard handling. The
  // default ('resizes-visual') leaves the LAYOUT viewport (and any 100vh/100dvh
  // fixed sheet/dialog sized against it — quick-add, expense dialog, concierge
  // chat, the dark Sheet) full-height UNDER the keyboard, so a bottom-hugging
  // input can end up covered. 'resizes-content' shrinks the layout viewport itself
  // when the on-screen keyboard opens, so those same dvh-sized surfaces reflow
  // to fit above it — no visualViewport listener/JS needed. Progressive: browsers
  // that don't recognize the value ignore it and keep today's ('resizes-visual')
  // behavior, so this can never break anything where it's unsupported.
  interactiveWidget: 'resizes-content',
  // surface — the visible app surface color (matches the PWA
  // manifest's theme_color/background_color emitted by gen-sw.mjs). This is the
  // browser/OS chrome colour and it MUST track --background: it is a hardcoded copy
  // of that token with no compiler tie, so a canvas re-value that misses it leaves a
  // strip of the retired palette framing the app. Now #0E0920, the D-334 page field.
  themeColor: '#0E0920',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // data-scroll-behavior: app/globals.css sets `scroll-behavior: smooth` on <html> for
  // in-page anchors. Next 16 stopped neutralising that during route transitions unless this
  // attribute is present, which would make every navigation smooth-scroll to top instead of
  // jumping. Opting back in keeps 15's behaviour.
  return (
    <html lang="en" suppressHydrationWarning className="dark" data-scroll-behavior="smooth">
      {/* Issue #180. An explicit <head>: the Metadata API cannot express an `http-equiv`
          meta, and `output: 'export'` rules out real headers — see lib/csp.ts for why and
          for what that costs (no `frame-ancestors`, no report-only).

          KNOWN CEILING — this tag is NOT the first thing in the built <head>. React 19
          hoists its own resources, so the export puts 35 tags ahead of it on the home route
          (2 metas, 2 stylesheet links, 1 script preload and 30 `<script src>`; 33-37 across
          the 21 pages), and a meta CSP governs only what is parsed after it. Measured on a
          real build: EVERY one of them is same-origin `/_next/static/*` build output, which
          this policy permits anyway, and every attacker-reachable node
          (the whole <body>) is parsed after the tag. So the gap is currently inert. Making
          it genuinely first needs a post-build rewrite of the exported HTML in out/ — the
          shape scripts/gen-sw.mjs already uses — which is only worth adding if a real
          header never becomes available. */}
      <head>
        <meta httpEquiv="Content-Security-Policy" content={buildCsp()} />
        <meta name="referrer" content={REFERRER_POLICY} />
      </head>
      <body className={`${geist.variable} ${instrumentSerif.variable} font-sans bg-surface`}>
        {/* WCAG 2.4.1 (B-1). ONE link at the root covers every route: all 19 pages
            render inside the `#main` wrapper below, so no page-level skip link is needed.
            Invisible until focused, then a real chip above the navbar (z-50). */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:border focus:border-white/15 focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {/* app-shell month/season background tint (issue #83). Renders nothing; root-level
              so it mounts once and is never torn down by route navigation. */}
          <SeasonAccentEngine />
          <ItineraryProvider>
            {/* App chrome: one persistent navbar/footer around the routed
                page content. TokenGate + PresenceBar render inside the provider. */}
            <Navbar />
            {/* routed content + footer must clear the fixed mobile
                tab bar; 64px fallback = the bar's published height contract. */}
            {/* `#main` is the skip link's target; tabIndex=-1 makes a non-interactive
                wrapper programmatically focusable, `outline-none` keeps that focus silent. */}
            <div id="main" tabIndex={-1} className="outline-none pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))] md:pb-0">
              {children}
              <Footer />
            </div>
            <BottomTabBar />
            <QuickAddFab />
            <QuickAddHost />
            {/* the expense-log dialog host (its own event/dialog, beside QuickAddHost). */}
            <ExpenseLogHost />
          </ItineraryProvider>
          {/* ⌘K / Ctrl+K command palette. Mounted once
              at the app root so the shortcut works from anywhere. */}
          <CommandPalette />
          {/* `?trip=` shared-link join handshake. Renders null unless a
              `?trip=` link is opened. Root-level (needs no ItineraryProvider). */}
          <TripJoinHandshake />
          {/* <RouteAccentEngine /> deleted. had already retired its chrome
              sweep, leaving it stamping html[data-trip-phase] for exactly ONE consumer —
              the aurora's lead stops. That aurora is gone, so the island was a corpse. */}
          <Toaster />
          <ChunkLoadErrorHandler />
          {/* registers /sw.js in production only; drives the
              toast-based update flow (no silent refresh). Renders null. */}
          <ServiceWorkerRegistrar />
          {/* storage-reliability island — requests persistent storage after the
              first interaction, warns once per load when storage nears quota, and shows a
              once-ever install-to-Home-Screen hint. Renders nothing. */}
          <StoragePersistence />
          {/* app-wide navigator.onLine banner. Renders nothing while online
              (incl. server/first paint — no SSR mismatch); appears on every route
              the instant connectivity drops. */}
          <OfflineBanner />
          {/* app-wide offline-push outbox status pill. Renders nothing on a dormant/guest
              build or before anything has ever synced; top-right, below the navbar. */}
          <SyncStatusBadge />
        </ThemeProvider>
      </body>
    </html>
  )
}
