"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { type ThemeProviderProps } from "next-themes/dist/types"
import { MotionConfig } from "framer-motion"

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      {/* reducedMotion="user" makes every framer-motion animation respect the
          OS "reduce motion" setting app-wide. The CSS @media block in
          globals.css covers non-framer CSS animations/transitions. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  )
}
