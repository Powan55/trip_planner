import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge knows Tailwind's stock scales only, so every additive key in
// tailwind.config.ts was invisible to it. `p-gut p-0` kept BOTH classes and left CSS source
// order to pick the winner; `text-t-micro` was read as a text COLOUR, sharing a group with
// `text-muted-foreground` so one of the two was dropped. Keys are re-listed here rather than
// imported from tailwind.config.ts, which would pull its plugin `require` into the client
// bundle — lib/__tests__/cn-custom-scales.test.ts reads the config and fails on drift.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // feeds p-/m-/gap-/w-/h-/inset-/translate-/min-w-/min-h-, as Tailwind's own `spacing`
      // extend does. `gut` and `gutter` are different tokens, not a rename; they dedupe
      // against each other because they are one axis, and the last one wins.
      spacing: ['gut', 'gutter', 'section', 'tap'],
      borderRadius: ['r1', 'r2', 'r3'],
      borderWidth: ['hair'],
    },
    classGroups: {
      'font-size': [
        {
          text: [
            'display-2xl', 'display-xl', 'display-lg', 'display-md',
            'eyebrow', 'editorial-xl', 'editorial-lg',
            't-micro', 't-label', 't-sm', 't-body', 't-lead',
            'n-sm', 'n-md', 'n-lg', 'n-xl', 'n-2xl',
          ],
        },
      ],
      'bg-image': [{ bg: ['gradient-radial', 'gradient-conic'] }],
      shadow: [{ shadow: ['glow'] }],
      duration: [{ duration: ['fast', 'normal', 'slow'] }],
      animate: [{ animate: ['fade-in', 'fade-out', 'accordion-down', 'accordion-up'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export { BASE_PATH, withBasePath } from './base-path'
