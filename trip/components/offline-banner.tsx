'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Wifi, WifiOff } from 'lucide-react';
import { useBackOnline, useOnline } from '@/hooks/use-online';

/**
 * App-wide connectivity announcer, mounted once at the root layout (`app/layout.tsx`).
 *
 * Only the live region lives here. The visible cue is `OfflineChip`, rendered inside the
 * navbar row: a pill floating over the page covered the title and the day tabs for the whole
 * offline spell. Travel Mode has no navbar, so its sync strip shows connectivity instead and
 * this region is the only thing that speaks there.
 *
 * The `role="status"` wrapper is mounted ALWAYS and is empty while online — a live region
 * announces a mutation of a region already in the accessibility tree, so a region inserted
 * in the same commit as its text is not reliably announced by NVDA/JAWS/VoiceOver. Same
 * always-mounted-wrapper idiom as `settings-panel.tsx` / `backup-restore.tsx`. Deliberately
 * NOT `role="alert"`: being offline is informational, the PWA keeps working from its precache.
 */
export function OfflineBanner() {
  const online = useOnline();
  const backOnline = useBackOnline();

  return (
    <div
      role="status"
      aria-live="polite"
      // Mounted always, so a static label would claim the device is offline the whole time it
      // is online. Same form as `sync-status-badge.tsx`.
      aria-label={online ? undefined : 'You are offline'}
      data-testid="offline-banner-region"
    >
      {!online ? (
        <span className="sr-only">
          Your device has lost its network connection. The app keeps working from cached data,
          and this message will disappear automatically once you&apos;re back online.
        </span>
      ) : backOnline ? (
        <span className="sr-only">Back online</span>
      ) : null}
    </div>
  );
}

/**
 * The visible cue, a chip in the navbar row beside the brand. It takes its own space in the
 * flex row, so it can never overlay page content. Silent (`aria-hidden`): `OfflineBanner`
 * above does the announcing. The `m.*` reveal is neutralised under prefers-reduced-motion by
 * the app-wide `<MotionConfig reducedMotion="user">` in `components/theme-provider.tsx`.
 */
export function OfflineChip() {
  const online = useOnline();
  const backOnline = useBackOnline();
  const show = !online ? 'offline' : backOnline ? 'online' : null;

  return (
    <AnimatePresence>
      {show && (
        <m.div
          key={show}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid={show === 'offline' ? 'offline-banner' : 'online-restored'}
          aria-hidden="true"
          className="flex shrink-0 items-center gap-1.5 border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] px-1.5 py-1 rounded-r1 sm:px-2"
        >
          {/* Icon from sm up: at 360 the navbar row has ~88px between brand and buttons. */}
          {show === 'offline' ? (
            <WifiOff className="hidden h-3 w-3 shrink-0 text-[color:var(--text-lo)] sm:block" />
          ) : (
            <Wifi className="hidden h-3 w-3 shrink-0 text-[color:var(--text-lo)] sm:block" />
          )}
          <span className="pr whitespace-nowrap">{show === 'offline' ? 'Offline' : 'Online'}</span>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export default OfflineBanner;
