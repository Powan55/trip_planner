import { DM_Sans, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import type { Viewport } from 'next'
import dynamic from 'next/dynamic'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { ItineraryProvider } from '@/components/itinerary-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import CommandPalette from '@/components/command-palette'
import RouteAccentEngine from '@/components/route-accent-engine'
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar'
import { withBasePath } from '@/lib/utils'

// The Navbar + Footer are app-wide chrome — they live in the root layout so all
// five routes share ONE persistent instance (client-side route transitions keep
// layout state; no remount, no re-animation). Same `dynamic({ssr:false})` island
// pattern the pages use.
const Navbar = dynamic(() => import('@/components/navbar'), { ssr: false })
const Footer = dynamic(() => import('@/components/footer'), { ssr: false })

// Mobile bottom tab bar + quick-add FAB and the global `quickadd:open` host —
// mounted inside ItineraryProvider so they share the store and sit under the
// token gate (z-70).
const BottomTabBar = dynamic(() => import('@/components/bottom-tab-bar'), { ssr: false })
const QuickAddFab = dynamic(() => import('@/components/quick-add-fab'), { ssr: false })
const QuickAddHost = dynamic(() => import('@/components/quick-add-host'), { ssr: false })

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
  // The manifest is emitted at build time by scripts/gen-sw.mjs (single basePath
  // prefix source), so withBasePath here matches its start_url.
  manifest: withBasePath('/manifest.webmanifest'),
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Nepal×Japan',
  },
  openGraph: {
    title: 'Nepal × Japan Journey',
    description: 'Premium travel planner for an epic Nepal and Japan adventure.',
    // NOTE: pass a bare root-relative path here — do NOT wrap in withBasePath().
    // Next resolves metadata image URLs against metadataBase, and metadataBase
    // already carries the basePath segment via NEXT_PUBLIC_SITE_URL. Wrapping with
    // withBasePath() would prepend the basePath a SECOND time, producing
    // /trip_planner/trip_planner/og-image.png. Local dev stays correct:
    // metadataBase=http://localhost:3000 -> /og-image.png.
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nepal × Japan Journey',
    description: 'Premium travel planner for an epic Nepal and Japan adventure.',
    images: ['/og-image.png'],
  },
}

// `viewportFit:'cover'` extends the layout viewport into the device safe-areas so
// `env(safe-area-inset-bottom)` resolves — required by the mobile bottom tab bar.
// width/initialScale restate Next's defaults (declaring `viewport` replaces the
// default meta tag).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // navy-900 — the visible app surface color (matches the PWA manifest's
  // theme_color/background_color emitted by gen-sw.mjs).
  themeColor: '#0a0e27',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={`${dmSans.variable} ${jakartaSans.variable} ${jetbrainsMono.variable} font-sans bg-navy-900`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <ItineraryProvider>
            {/* App chrome: one persistent navbar/footer around the routed page
                content. TokenGate + PresenceBar render inside the provider. */}
            <Navbar />
            {/* Routed content + footer must clear the fixed mobile tab bar;
                64px fallback = the bar's published height contract. */}
            <div className="pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))] md:pb-0">
              {children}
              <Footer />
            </div>
            <BottomTabBar />
            <QuickAddFab />
            <QuickAddHost />
          </ItineraryProvider>
          {/* ⌘K / Ctrl+K command palette. Mounted once at the app root so the
              shortcut works from anywhere. */}
          <CommandPalette />
          {/* Route-driven warm/cool accent engine. Renders null; reads
              usePathname() and drives --accent-scroll himalaya↔gold↔sakura.
              Reduced-motion sets it instantly. */}
          <RouteAccentEngine />
          <Toaster />
          <ChunkLoadErrorHandler />
          {/* Registers /sw.js in production only; drives the toast-based update
              flow (no silent refresh). Renders null. */}
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  )
}
