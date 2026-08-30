'use client';

import { m } from 'framer-motion';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { useOnline } from '@/hooks/use-online';
import { formatRelativeTime } from '@/lib/relative-time';

/**
 * App-wide sync-status affordance — a passive, live "pending N / synced Xm ago" pill over
 * the offline-push outbox, mounted once at the root layout
 * (`app/layout.tsx`) so a traveler can tell at a glance whether their edits have reached
 * Firestore or are still queued locally.
 *
 * Structural mirror of `components/offline-banner.tsx` / `components/presence-bar.tsx`: a
 * `fixed` pill inside an ALWAYS-mounted `role="status"` + `aria-live="polite"` wrapper (a
 * live region only announces a mutation of a region already in the tree, so the wrapper
 * cannot be born with its text; it is empty and boxless while there is nothing to show),
 * `aria-label`, a solid printed-stock surface, an `sr-only` full-sentence
 * summary, and one declarative `m.*` reveal — the app-wide `<MotionConfig reducedMotion="user">`
 * (`components/theme-provider.tsx`) auto-neutralizes that reveal under prefers-reduced-motion, so
 * no manual guard is needed here.
 *
 * GATING (mirrors `core/sync/outbox.ts`'s own `enabled()` — applied via
 * `useSyncStatus()` → `outboxSnapshot()`): a dormant build (no firebase env) or a guest (no
 * active Trip Token traveler) always reads `{pending:0, blocked:0, lastAckAt:null}`, which is
 * exactly the "never-synced-yet, nothing to show" case below — so this renders NOTHING on a
 * dormant/guest build, with no separate gate check duplicated here. `readBlocked` (#271) is NOT
 * behind that same gate (a denied READ can be the very first thing that ever happens on a
 * device), so `show` carries its own `isBlocked` clause rather than folding into pending/lastAckAt.
 *
 * THREE STATES, not two (#267, widened by #271). "pending" tells a traveler their edits will land
 * on their own; for a change (or a read) the security rules REFUSED that is false and no amount of
 * waiting fixes it, so a refusal gets its own wording and its own `data-state`. `blocked` is a
 * SUBSET of `pending` (a refused write chunk is never acked); `readBlocked` is not — a denied read
 * can arrive with nothing else pending — which is why `isBlocked` OR's the two rather than treating
 * `blocked` as the whole story.
 *
 * Position: fixed, top-right, below the navbar (mirrors `OfflineBanner`'s top-CENTER placement,
 * shifted to the one open corner — top-center is the offline banner, bottom-left is the presence
 * bar, bottom-right is the mobile quick-add FAB / Sonner toasts). `z-40`, same layer as those
 * three; never covers the navbar (`z-50`) or the token gate (`z-[70]`).
 */
export function SyncStatusBadge() {
  const { pending, blocked, readBlocked, lastAckAt } = useSyncStatus();
  // OfflineBanner owns top-center at the same `top-20`, and at 360-414px its centred pill
  // overlaps this right-anchored one — which is exactly when both are showing (offline with
  // unsynced edits). Drop a row while it is up (#129).
  const online = useOnline();

  // #267/#271: a REFUSED change (write) or a REFUSED read reads as pending forever, which is the
  // one thing this pill must never say. `blocked` is a subset of `pending` (a refused chunk is
  // never acked); `readBlocked` has no count to give (a denied snapshot stream has no chunk to key
  // against), so it ORs straight into `isBlocked` instead of adding to `blocked`.
  const isBlocked = blocked > 0 || readBlocked;

  // Dormant/guest (both read as pending:0 + lastAckAt:null + readBlocked:false) OR a real build
  // that has simply never synced anything yet — either way, nothing to show. But a device denied
  // on its very FIRST read (never synced: pending:0, lastAckAt:null) must still show — that is
  // the #271 case this pill exists for — so `isBlocked` gets its own clause rather than folding
  // into the pending/lastAckAt check above.
  const show = pending !== 0 || lastAckAt !== null || isBlocked;
  const isPending = pending > 0;
  // The same amber the pre-flight rows already use for 'attention' (with the same AlertTriangle),
  // so the two surfaces reading this one outbox agree on what a refusal looks like.
  const tone = isBlocked ? 'text-amber-300' : 'text-ink-mid';
  const relative = lastAckAt ? formatRelativeTime(lastAckAt) : null;
  const label = isBlocked
    ? blocked > 0
      ? `${blocked} not syncing`
      : 'Not syncing'
    : isPending
      ? `${pending} pending`
      : `Synced ${relative ?? 'recently'}`;
  const summary = isBlocked
    ? blocked > 0
      ? `The shared trip refused ${blocked} change${blocked === 1 ? '' : 's'}, so ${blocked === 1 ? 'it is' : 'they are'} saved on this device only and will not upload on their own. If you were just added to this trip, reload the page; otherwise ask a member to add this device in Settings, under Trip access.`
      : `The shared trip refused to send this device its latest data. If you were just added to this trip, reload the page; otherwise ask a member to add this device in Settings, under Trip access.`
    : isPending
      ? `${pending} change${pending === 1 ? '' : 's'} ${pending === 1 ? 'is' : 'are'} waiting to sync to the shared trip. This will clear automatically once the connection confirms.`
      : `All changes are synced to the shared trip${relative ? `, last confirmed ${relative}` : ''}.`;

  return (
    <div role="status" aria-live="polite" aria-label={show ? label : undefined}>
      {show && (
        <m.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="sync-status-badge"
          data-state={isBlocked ? 'blocked' : isPending ? 'pending' : 'synced'}
          className={`fixed ${online ? 'top-20' : 'top-32'} right-4 z-40 max-w-[calc(100vw-2rem)]`}
        >
          {/* Printed stock, not glass. The FILL grammar carries the state: a struck
              (solid) rule when synced, a hollow dashed one when the sync has not
              landed. The word always says which — colour is never the only carrier. */}
          <div
            className={`flex items-center gap-2 bg-[rgb(var(--surface-low))] px-2.5 py-1.5 rounded-r1 border-2 ${
              isBlocked || isPending
                ? 'border-dashed border-[color:var(--text-lo)]'
                : 'border-[hsl(var(--border))]'
            } ${tone}`}
          >
            {isBlocked ? (
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : isPending ? (
              <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <span data-testid="sync-status-text" className={`pr ${tone}`}>
              {label}
            </span>
            <span className="sr-only">{summary}</span>
          </div>
        </m.div>
      )}
    </div>
  );
}

export default SyncStatusBadge;
