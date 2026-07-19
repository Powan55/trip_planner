"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { type ThemeProviderProps } from "next-themes/dist/types"
import { MotionConfig, LazyMotion, domAnimation } from "framer-motion"

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      {/* reducedMotion="user" makes every framer-motion animation respect the
          OS "reduce motion" setting app-wide. The CSS @media block in
          globals.css covers non-framer CSS animations/transitions.

          LazyMotion + the lightweight `m` component shrink the shared
          bundle by lazy-loading the animation feature set. `domAnimation` covers
          everything this app uses (animations, variants, exit, whileInView,
          hover/tap/focus gestures) — no framer layout/layoutId/drag in use.
          `strict` throws in dev if any `motion.*` slips through, guaranteeing the
          migration is complete. Order MUST stay MotionConfig → LazyMotion →
}          children so reduced-motion still gates the whole tree. */
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </NextThemesProvider>
  )
}
