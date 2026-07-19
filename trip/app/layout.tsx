import { DM_Sans, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import type { Viewport } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { ItineraryProvider } from '@/components/itinerary-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import CommandPalette from '@/components/command-palette'
import RouteAccentEngine from '@/components/route-accent-engine'
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar'
import { OfflineBanner } from '@/components/offline-banner'
import { SyncStatusBadge } from '@/components/sync-status-badge'
import { withBasePath } from '@/lib/utils'
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

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' })
const jakartaSans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'Nepal × Japan Journey | Dec 2026 - Jan 2027',
  description: 'Premium travel planner for an epic Nepal and Japan adventure. Explore Kathmandu, Tokyo, Kyoto, and beyond.',
  icons: {
    icon: withBasePath('/favicon.svg'),
    shortcut: withBasePath('/favicon.svg'),
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
    // NEXT_PUBLIC_SITE_URL (=https://powan55.github.io/trip_planner on CI).
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
  // surface — the visible app surface color (matches the PWA
  // manifest's theme_color/background_color emitted by gen-sw.mjs).
  themeColor: '#0a0e27',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={`${dmSans.variable} ${jakartaSans.variable} ${jetbrainsMono.variable} font-sans bg-surface`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <ItineraryProvider>
            {/* App chrome: one persistent navbar/footer around the routed
                page content. TokenGate + PresenceBar render inside the provider. */}
            <Navbar />
            {/* routed content + footer must clear the fixed mobile
                tab bar; 64px fallback = the bar's published height contract. */}
            <div className="pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))] md:pb-0">
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
          {/* Route-driven warm/cool accent engine. Renders null;
              reads usePathname() and drives --accent-scroll himalaya↔gold↔sakura.
              Reduced-motion sets it instantly. */}
          <RouteAccentEngine />
          <Toaster />
          <ChunkLoadErrorHandler />
          {/* registers /sw.js in production only; drives the
              toast-based update flow (no silent refresh). Renders null. */}
          <ServiceWorkerRegistrar />
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
