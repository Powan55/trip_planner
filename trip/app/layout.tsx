import { Geist, IBM_Plex_Mono } from 'next/font/google'
import type { Viewport } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { ItineraryProvider } from '@/components/itinerary-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar'
import { StoragePersistence } from '@/components/storage-persistence'
import { OfflineBanner } from '@/components/offline-banner'
import { ClockOverrideBanner } from '@/components/clock-override-banner'
import { RouteFocus } from '@/components/route-focus'
import TravelerOnly from '@/components/traveler-only'
import { SyncStatusBadge } from '@/components/sync-status-badge'
import SeasonAccentEngine from '@/components/season-accent-engine'
import { withBasePath } from '@/lib/utils'
import { buildCsp, REFERRER_POLICY } from '@/lib/csp'
// Client islands live in chrome-islands.tsx: a Server Component layout can't use
// dynamic({ ssr: false }).
import {
  Navbar,
  Footer,
  BottomTabBar,
  QuickAddFab,
  QuickAddHost,
  ExpenseLogHost,
  TripJoinHandshake,
  CommandPalette,
} from './chrome-islands'

// Geist carries the UI; `font-mono` aliases it with `tnum` in tailwind.config, so no
// monospace download is needed for aligned numerals.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
// Label face. Only weight 600 is loaded, so don't ask for 400 (it would render 600 anyway).
// preload: false keeps it off the critical path.
const plexMono = IBM_Plex_Mono({
  weight: '600',
  subsets: ['latin'],
  preload: false,
  variable: '--font-plex-mono',
})

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'Trip Journey',
  robots: { index: true, follow: true },
  description: 'Offline-ready trip planner: day-by-day itinerary, map, bookings and a shared plan for your whole group.',
  icons: {
    icon: withBasePath('/favicon.svg'),
    shortcut: withBasePath('/favicon.svg'),
    // Without this, iOS looks for /apple-touch-icon.png at the origin root, outside basePath.
    apple: withBasePath('/icons/apple-touch-icon.png'),
  },
  // Emitted by scripts/gen-sw.mjs at build time.
  manifest: withBasePath('/manifest.webmanifest'),
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Trip Journey',
  },
  openGraph: {
    title: 'Trip Journey',
    description: 'Offline-ready trip planner: day-by-day itinerary, map, bookings and a shared plan for your whole group.',
    // Not withBasePath(): metadataBase (NEXT_PUBLIC_SITE_URL) already includes the base
    // path, so wrapping would double it.
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Trip Journey',
    description: 'Offline-ready trip planner: day-by-day itinerary, map, bookings and a shared plan for your whole group.',
    images: ['/og-image.png'],
  },
}

// viewportFit 'cover' makes env(safe-area-inset-*) resolve for the bottom tab bar.
// Declaring `viewport` replaces Next's default tag, so width/initialScale are restated.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The on-screen keyboard shrinks the layout viewport, so dvh-sized sheets reflow above it
  // instead of hiding inputs. Ignored where unsupported.
  interactiveWidget: 'resizes-content',
  // Hardcoded copy of --background; keep in step with it and gen-sw.mjs's manifest colours.
  themeColor: '#0A0818',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // data-scroll-behavior: without it Next 16 smooth-scrolls every route change, because
  // globals.css sets scroll-behavior: smooth on <html> for in-page anchors.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // Font variables must be on <html>, not <body>: globals.css reads them in :root
      // declarations, and custom properties only inherit downward.
      className={`dark ${geist.variable} ${plexMono.variable}`}
      // Kept and pointed at sans because the Tailwind `display` key still resolves through it.
      style={{ '--font-display': 'var(--font-sans)' } as React.CSSProperties}
      data-scroll-behavior="smooth"
    >
      {/* Meta CSP because a static export can't set headers; see lib/csp.ts.
          KNOWN CEILING: React hoists its own same-origin tags above this one. They are all
          /_next/static output the policy allows, and all of <body> comes after it. */}
      <head>
        <meta httpEquiv="Content-Security-Policy" content={buildCsp()} />
        <meta name="referrer" content={REFERRER_POLICY} />
      </head>
      <body className="font-sans bg-surface">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {/* Root-level so it survives route changes. */}
          <SeasonAccentEngine />
          <ItineraryProvider>
            {/* Skip link. Inside the provider so it only exists when #main does. */}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:border focus:border-[color:var(--border-ui)] focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Skip to content
            </a>
            {/* Persistent chrome. */}
            <TravelerOnly>
              <Navbar />
            </TravelerOnly>
            <RouteFocus />
            {/* Bottom padding clears the fixed mobile tab bar. */}
            {/* tabIndex -1 so the skip link can focus it. */}
            <div id="main" tabIndex={-1} className="outline-none pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))] md:pb-0">
              {children}
              <Footer />
            </div>
            <TravelerOnly>
              <BottomTabBar />
              <QuickAddFab />
              <QuickAddHost />
              {/* Expense-log dialog host. */}
              <ExpenseLogHost />
            </TravelerOnly>
          </ItineraryProvider>
          {/* Cmd/Ctrl+K palette, mounted once at the root. */}
          <TravelerOnly>
            <CommandPalette />
          </TravelerOnly>
          {/* Handles ?trip= share links. */}
          <TripJoinHandshake />
          {/* Toasts and error recovery. */}
          <Toaster />
          <ChunkLoadErrorHandler />
          {/* Production only; updates go through a toast, never a silent reload. */}
          <ServiceWorkerRegistrar />
          {/* Persistent-storage request, quota warning, install hint. */}
          <StoragePersistence />
          {/* Offline banner. */}
          <OfflineBanner />
          {/* Sync outbox status. */}
          <SyncStatusBadge />
          {/* Shown while the ?today= demo clock is active. */}
          <ClockOverrideBanner />
        </ThemeProvider>
      </body>
    </html>
  )
}
