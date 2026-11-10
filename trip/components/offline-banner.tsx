'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Wifi, WifiOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useBackOnline, useOnline } from '@/hooks/use-online';
import { isTravelRoute } from '@/lib/travel-route';

/**
 * App-wide offline indicator.
 *
 * A calm, transient pill announcing when the browser has lost network
 * connectivity — mounted once at the root layout (`app/layout.tsx`) so it is
 * visible outside Travel Mode, where the sync strip shows connectivity. Keyed on `useOnline()` (navigator.onLine +
 * online/offline events); shows NOTHING while online, including on the
 * server and first client paint (the hook defaults to `true`) — no
 * SSR/hydration mismatch. No dismiss control: it is a live status, not a
 * notification, and clears itself the instant the browser reconnects, handing over to a
 * "Back online" pill for 2.5s after a real offline spell (`useBackOnline`).
 *
 * The `role="status"` wrapper is mounted ALWAYS and is empty while online, except for that
 * brief "Back online" cue, which is announced politely by design — a
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
 * Position: see `PILL_POS`. The bottom corners are already claimed (presence bar
 * bottom-left, Sonner toasts bottom-right), so the top edge is the open slot.
 */
// Under md the pill sits in the navbar's own row (the page title and day tabs start right under
// it), above the navbar (z-50) but under the token gate (z-70). It is pinned just left of the
// two right-hand navbar buttons (2 x 44px + gap + gutter) so it clears the default brand at
// 360px; md+ keeps the centred slot below the navbar. A custom brand is capped to the same
// width in navbar.tsx (calc(100vw-252px)) so it never slides under the pill. Never takes pointer events: it must not eat taps.
const PILL_POS =
  'pointer-events-none fixed right-28 sm:right-36 top-[calc(0.875rem+var(--safe-top))] z-[51] w-fit md:inset-x-0 md:top-[calc(5rem+var(--safe-top))] md:z-40 md:mx-auto md:max-w-[calc(100vw-2rem)]';

export function OfflineBanner() {
  const online = useOnline();
  const backOnline = useBackOnline();
  const travel = isTravelRoute(usePathname());

  return (
    <div
      role="status"
      aria-live="polite"
      // The wrapper is mounted always now, so a static label would claim the device is
      // offline the whole time it is online. Same form as `sync-status-badge.tsx`.
      aria-label={online ? undefined : 'You are offline'}
      data-testid="offline-banner-region"
    >
      {travel && (
        <span className="sr-only">
          {!online ? 'Your device has lost its network connection. The app keeps working from cached data.' : backOnline ? 'Back online' : null}
        </span>
      )}
      <AnimatePresence>
      {online || travel ? null : (
        <m.div
          key="offline"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="offline-banner"
          // Centred with auto margins, not left-1/2 + translate: the y animation writes an
          // inline transform that would overwrite a translate-x utility.
          className={PILL_POS}
        >
          {/* The running head's offline field, printed: solid stock, a 2px rule, mono
              caps. NOT glass and NOT red — being offline is a condition of the network,
              stated in words, and the app keeps working from its precache. */}
          <div className="flex items-center gap-2 border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] px-2 py-1.5 rounded-r1 md:px-2.5">
            <WifiOff className="h-3 w-3 shrink-0 text-[color:var(--text-lo)] max-md:hidden" aria-hidden="true" />
            <span className="pr whitespace-nowrap">
              <span className="max-md:hidden">Net · </span>Offline<span className="max-md:hidden"> · Cached</span>
            </span>
            <span className="sr-only">
              Your device has lost its network connection. The app keeps working from cached
              data, and this message will disappear automatically once you&apos;re back online.
            </span>
          </div>
        </m.div>
      )}
      {online && backOnline && !travel ? (
        <m.div
          key="online"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="online-restored"
          className={PILL_POS}
        >
          <div className="flex items-center gap-2 border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] px-2 py-1.5 rounded-r1 md:px-2.5">
            <Wifi className="h-3 w-3 shrink-0 text-[color:var(--text-lo)] max-md:hidden" aria-hidden="true" />
            <span className="pr whitespace-nowrap">Back online</span>
          </div>
        </m.div>
      ) : null}
      </AnimatePresence>
    </div>
  );
}

export default OfflineBanner;
