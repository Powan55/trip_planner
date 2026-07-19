// — native haptic feedback (Android Chrome `navigator.vibrate`), a subtle 10-20ms pulse
// on key taps. Progressive enhancement only: iOS Safari has no Vibration API, so this silently
// no-ops there — not a bug, nothing to work around. Also gated behind
// prefers-reduced-motion, using the same
// `window.matchMedia` outside-React check `lib/fly-chip.ts` already established.
export function haptic(pattern: number | number[] = 15): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  navigator.vibrate(pattern);
}
