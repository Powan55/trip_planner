'use client';

import { m } from 'framer-motion';
import { Check, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { formatRelativeTime } from '@/lib/relative-time';

/**
 * App-wide sync-status affordance — a passive, live "pending N / synced Xm ago" pill over
 * the offline-push outbox, mounted once at the root layout
 * (`app/layout.tsx`) so a traveler can tell at a glance whether their edits have reached
 * Firestore or are still queued locally.
 *
 * Structural mirror of `components/offline-banner.tsx` / `components/presence-bar.tsx`: a
 * `fixed` live-region pill that renders `null` when there is nothing to show, `role="status"` +
 * `aria-live="polite"` + `aria-label`, a `glass-card` surface, an `sr-only` full-sentence
 * summary, and one declarative `m.*` reveal — the app-wide `<MotionConfig reducedMotion="user">`
 * (`components/theme-provider.tsx`) auto-neutralizes that reveal under prefers-reduced-motion, so
 * no manual guard is needed here.
 *
 * GATING (mirrors `core/sync/outbox.ts`'s own `enabled()` — applied via
 * `useSyncStatus()` → `outboxSnapshot()`): a dormant build (no firebase env) or a guest (no
 * active Trip Token traveler) always reads `{pending:0, lastAckAt:null}`, which is exactly the
 * "never-synced-yet, nothing to show" case below — so this renders NOTHING on a dormant/guest
 * build, with no separate gate check duplicated here.
 *
 * Position: fixed, top-right, below the navbar (mirrors `OfflineBanner`'s top-CENTER placement,
 * shifted to the one open corner — top-center is the offline banner, bottom-left is the presence
 * bar, bottom-right is the mobile quick-add FAB / Sonner toasts). `z-40`, same layer as those
 * three; never covers the navbar (`z-50`) or the token gate (`z-[70]`).
 */
export function SyncStatusBadge() {
  const { pending, lastAckAt } = useSyncStatus();

  // Dormant/guest (both read as pending:0 + lastAckAt:null) OR a real build that has simply never
  // synced anything yet — either way, nothing to show.
  if (pending === 0 && lastAckAt === null) return null;

  const isPending = pending > 0;
  const relative = lastAckAt ? formatRelativeTime(lastAckAt) : null;
  const label = isPending ? `${pending} pending` : `Synced ${relative ?? 'recently'}`;
  const summary = isPending
    ? `${pending} change${pending === 1 ? '' : 's'} ${pending === 1 ? 'is' : 'are'} waiting to sync to the shared trip. This will clear automatically once the connection confirms.`
    : `All changes are synced to the shared trip${relative ? `, last confirmed ${relative}` : ''}.`;

  return (
    <m.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="sync-status-badge"
      data-state={isPending ? 'pending' : 'synced'}
      className="fixed top-20 right-4 z-40 max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-1.5 rounded-full glass-card px-3 py-1.5 shadow-lg text-[11px] text-white/55">
        {isPending ? (
          <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span data-testid="sync-status-text">{label}</span>
        <span className="sr-only">{summary}</span>
      </div>
    </m.div>
  );
}

export default SyncStatusBadge;
