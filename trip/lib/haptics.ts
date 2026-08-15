// — native haptic feedback (Android Chrome `navigator.vibrate`), a subtle 10-20ms pulse
// on key taps. Progressive enhancement only: iOS Safari has no Vibration API, so this silently
// no-ops there — not a bug, nothing to work around. Also gated behind
// prefers-reduced-motion. Issue #24: the inline `window.matchMedia` check is gone —
// `prefersReducedMotion()` in lib/motion.ts is the one place the preference is read.
import { prefersReducedMotion } from '@/lib/motion';

export function haptic(pattern: number | number[] = 15): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  if (prefersReducedMotion()) return;
  navigator.vibrate(pattern);
}
