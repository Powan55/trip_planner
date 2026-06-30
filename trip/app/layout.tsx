import { DM_Sans, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { ItineraryProvider } from '@/components/itinerary-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import CommandPalette from '@/components/command-palette'
import ScrollAccentEngine from '@/components/scroll-accent-engine'
import { withBasePath } from '@/lib/utils'

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
  openGraph: {
    title: 'Nepal × Japan Journey',
    description: 'Premium travel planner for an epic Nepal and Japan adventure.',
    // NOTE: pass a bare root-relative path here — do NOT wrap in
    // withBasePath. Next resolves metadata image URLs against metadataBase
    // and metadataBase already carries the basePath segment via
    // NEXT_PUBLIC_SITE_URL (=https://powan55.github.io/trip_planner on CI).
    // Wrapping with withBasePath would prepend /trip_planner a SECOND time
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
            {children}
          </ItineraryProvider>
          {/* ⌘K / Ctrl+K command palette. Mounted once at the app root so the
              shortcut works from anywhere, alongside the other root client islands. */}
          <CommandPalette />
          {/* Scroll-driven warm/cool accent engine. Renders null; reads the
              active section (scroll-spy) and drives --accent-scroll
              himalaya↔gold↔sakura. Reduced-motion sets it instantly. */}
          <ScrollAccentEngine />
          <Toaster />
          <ChunkLoadErrorHandler />
        </ThemeProvider>
      </body>
    </html>
  )
}
