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
 * online/offline events); shows NOTHING while online, including on the
 * server and first client paint (the hook defaults to `true`) — no
 * SSR/hydration mismatch. No dismiss control: it is a live status, not a
 * notification, and clears itself the instant the browser reconnects.
 *
 * The `role="status"` wrapper is mounted ALWAYS and is empty while online — a
 * live region announces a mutation of a region already in the accessibility
 * tree, so a region inserted in the same commit as its text is not reliably
 * announced by NVDA/JAWS/VoiceOver. Same always-mounted-wrapper idiom as
 * `settings-panel.tsx` / `backup-restore.tsx`. It has no box of its own (an
 * empty block with no children), so it costs no layout.
 *
 * Structural mirror of `components/presence-bar.tsx`: a `fixed` pill inside a
 * live region, `role="status"` + `aria-live="polite"`
 * + `aria-label`, a solid printed-stock surface, an `sr-only` full-sentence summary,
 * and one declarative `m.*` reveal — the app-wide `<MotionConfig
 * reducedMotion="user">` (in `components/theme-provider.tsx`) auto-neutralizes
 * that reveal under prefers-reduced-motion, so no manual guard is needed here.
 *
 * Visual language mirrors the existing offline cue in
 * `components/weather-card.tsx:280-289` — a `WifiOff` icon (aria-hidden) +
 * calm 11px `text-ink-mid` (#27: connection state is a status line about the
 * page, not the page's subject), deliberately NOT red/alert styling: being
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

  return (
    <div
      role="status"
      aria-live="polite"
      // The wrapper is mounted always now, so a static label would claim the device is
      // offline the whole time it is online. Same form as `sync-status-badge.tsx`.
      aria-label={online ? undefined : 'You are offline'}
      data-testid="offline-banner-region"
    >
      {online ? null : (
        <m.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="offline-banner"
          className="fixed top-20 left-1/2 z-40 -translate-x-1/2 max-w-[calc(100vw-2rem)]"
        >
          {/* The running head's offline field, printed: solid stock, a 2px rule, mono
              caps. NOT glass and NOT red — being offline is a condition of the network,
              stated in words, and the app keeps working from its precache. */}
          <div className="flex items-center gap-2 border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] px-2.5 py-1.5 rounded-r1">
            <WifiOff className="h-3 w-3 shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
            <span className="pr">Net · Offline · Cached</span>
            <span className="sr-only">
              Your device has lost its network connection. The app keeps working from cached
              data, and this message will disappear automatically once you&apos;re back online.
            </span>
          </div>
        </m.div>
      )}
    </div>
  );
}

export default OfflineBanner;
