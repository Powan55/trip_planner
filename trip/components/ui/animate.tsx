'use client'

import { m } from 'framer-motion'

const viewportConfig = { once: true, margin: '-60px' as `${number}px` }

export function FadeIn({
  children, delay = 0, duration = 0.4, className,
}: {
  children: React.ReactNode; delay?: number; duration?: number; className?: string
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewportConfig}
      transition={{ duration, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </m.div>
  )
}

// `SkeletonPulse` deleted — a framer `repeat: Infinity` opacity loop with ZERO
// usages tree-wide. The app's real loading affordance is `.animate-shimmer`
// (globals.css) via SectionSkeleton / WeatherCard.
//
// `ScaleIn`, `SlideIn`, `Stagger`, `StaggerItem`, `HoverLift` and `PressScale`
// deleted for the same reason — ZERO references each outside this file. `FadeIn` (4 refs,
// imported by `components/activity-feed.tsx`) is the only survivor and the positive control
// that made those six zeros a result rather than a broken scan. NO bundle-size claim is made:
// unused ESM exports tree-shake, and nothing here was measured. The win is less code to read.
