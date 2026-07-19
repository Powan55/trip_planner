// Pure countdown decomposition — the implementation now lives in the framework-free
// `core/clock/` package. This module RE-EXPORTS `computeCountdown`
// + the `Countdown` type byte-identically so every `@/lib/countdown` caller
// (`components/hero-section.tsx`, `token-gate.tsx`, `trip-dashboard.tsx`) is untouched —
// the delegate pattern. `computeCountdown` stays PURE: callers pass both the
// `target` and `now`; the clock read lives in the ClockPort adapter (`lib/trip-now.ts`).
export { computeCountdown, type Countdown } from '@/core/clock/countdown';
