'use client';

import { m } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/use-online';

/**
 * App-wide offline indicator.
 *
 * A calm, transient pill announcing when the browser has lost network
 * connectivity — mounted once at the root layout (`app/layout.tsx`) so it is
 * visible on every route. Keyed on `useOnline()` (navigator.onLine +
 * online/offline events); renders NOTHING while online, including on the
 * server and first client paint (the hook defaults to `true`) — no
 * SSR/hydration mismatch. No dismiss control: it is a live status, not a
 * notification, and clears itself the instant the browser reconnects.
 *
 * Structural mirror of `components/presence-bar.tsx`: a `fixed` live-region
 * pill that renders `null` when inactive, `role="status"` + `aria-live="polite"`
 * + `aria-label`, a `glass-card` surface, an `sr-only` full-sentence summary,
 * and one declarative `m.*` reveal — the app-wide `<MotionConfig
 * reducedMotion="user">` (in `components/theme-provider.tsx`) auto-neutralizes
 * that reveal under prefers-reduced-motion, so no manual guard is needed here.
 *
 * Visual language mirrors the existing offline cue in
 * `components/weather-card.tsx:280-289` — a `WifiOff` icon (aria-hidden) +
 * calm `text-[11px] text-white/55`, deliberately NOT red/alert styling: being
 * offline is informational (the PWA keeps working from its precache), not a
 * failure, so this stays a `role="status"` live region, never `role="alert"`.
 *
 * Position: fixed, top-center, below the navbar (`h-16`/64px, `z-50`). The
 * bottom corners are already claimed (presence bar bottom-left, Sonner toasts
 * bottom-right), so top-center is the one open slot. `z-40` sits under both
 * the navbar (`z-50`) and the token gate (`z-[70]`) — it never covers either.
 */
export function OfflineBanner() {
  const online = useOnline();

  if (online) return null;

  return (
    <m.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      role="status"
      aria-live="polite"
      aria-label="You are offline"
      data-testid="offline-banner"
      className="fixed top-20 left-1/2 z-40 -translate-x-1/2 max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-1.5 rounded-full glass-card px-3 py-1.5 shadow-lg text-[11px] text-white/55">
        <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>Offline — showing cached content</span>
        <span className="sr-only">
          Your device has lost its network connection. The app keeps working from cached
          data, and this message will disappear automatically once you&apos;re back online.
        </span>
      </div>
    </m.div>
  );
}

export default OfflineBanner;
