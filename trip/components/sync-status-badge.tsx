'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { AlertTriangle, Check, CloudOff, RefreshCw, MonitorSmartphone } from 'lucide-react';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { usePresence } from '@/hooks/use-presence';
import { formatRelativeTime } from '@/lib/relative-time';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { withBasePath } from '@/lib/base-path';

// A plain anchor, not next/link: Link's pushState fires no hashchange, and the Settings page
// needs one to open its Trip access group when the pill is tapped while already on /settings.
function TripAccessLink(props: {
  className: string;
  children: ReactNode;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return <a href={withBasePath('/settings/#trip-access')} {...props} />;
}

/**
 * App-wide sync-status affordance — a passive, live "pending N / synced Xm ago" pill over
 * the offline-push outbox, mounted once at the root layout
 * (`app/layout.tsx`) so a traveler can tell at a glance whether their edits have reached
 * Firestore or are still queued locally.
 *
 * A `fixed` pill beside an ALWAYS-mounted `role="status"` + `aria-live="polite"` region (a
 * live region only announces a mutation of a region already in the tree, so it cannot be
 * born with its text; it is empty while there is nothing to show). Since #1093 the region
 * holds only a short per-state word, not the pill: the pill's relative time and sr-only
 * sentence used to be re-read in full on every ack. A solid printed-stock surface, an `sr-only` full-sentence
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
 * FOUR STATES since D-542. The fourth is `localOnly` — on the default pack with no share id, every
 * edit is device-only and nothing will EVER upload. That state used to render as complete silence:
 * the outbox is gated off, so it reads the same neutral `{pending:0, lastAckAt:null}` shape as
 * "everything is synced", and the pill showed nothing at all. Silence was the bug report ("I update
 * the itinerary but it is not syncing") — the app was working exactly as designed and said so
 * nowhere. It renders LAST in the precedence chain below: a real pending/blocked count is a live
 * fact about a trip that IS shared, and must not be masked by the invitation to share one.
 *
 * D-546 SPLITS THE SYNCED STATE IN TWO, on the audience rather than on the outbox. Everything the
 * outbox knows is about this device's own writes; "Synced" was therefore a claim about transport
 * being read as a claim about delivery, and it held just as firmly when the share link was putting
 * every joiner on a different trip. With at least one other traveller present it now says so
 * ("Synced · 2 here"); alone it says "Saved", which is the honest weaker claim — uploaded, read by
 * nobody yet. Alone is the NORMAL state of a solo trip, so it keeps the neutral check mark and the
 * plain tone; the explanation lives in the sr-only sentence rather than in a warning. The failure
 * states (blocked, dead) also print a short visible hint (#1076), and blocked links to Settings.
 *
 * THREE STATES, not two (#267, widened by #271). "pending" tells a traveler their edits will land
 * on their own; for a change (or a read) the security rules REFUSED that is false and no amount of
 * waiting fixes it, so a refusal gets its own wording and its own `data-state`. `blocked` is a
 * SUBSET of `pending` (a refused write chunk is never acked); `readBlocked` is not — a denied read
 * can arrive with nothing else pending — which is why `isBlocked` OR's the two rather than treating
 * `blocked` as the whole story.
 *
 * Position: fixed, top-right, below the navbar (bottom-left is the presence bar, bottom-right is
 * the mobile quick-add FAB / Sonner toasts). `z-40`, same layer as those
 * two; never covers the navbar (`z-50`) or the token gate (`z-[70]`).
 */
export function SyncStatusBadge() {
  const { pending, blocked, readBlocked, readDead, lastAckAt, localOnly, signInRequired } = useSyncStatus();
  /**
   * D-546 — DELIVERY, not transport. Everything above comes out of this device's own outbox:
   * `lastAckAt` is stamped when Firestore accepted the bytes, which is equally true whether one
   * peer or zero will ever read them. So the pill said "Synced 2m ago" while the share link was
   * putting every joiner on a different trip — the data was going nowhere and the badge was the
   * one surface that could have said so.
   *
   * `usePresence()` already answers "who else is on this trip", off the same heartbeat collection
   * the presence bar reads, with the same gate and the same 6-minute active window. No new
   * subsystem and no new dependency; the subscribe is the identical query the bar already opens,
   * which the Firestore SDK multiplexes onto one listen target.
   */
  const peers = usePresence();
  const summaryId = useId();

  // #753: journal and prefs otherwise only retry while their own view is mounted. One-shot pushes,
  // no listener, so this spends no reads when nothing is dirty. #1125: trip renames and the trip
  // list retry here too.
  useEffect(() => {
    const flush = () => {
      if (!isRemoteConfigured() || document.visibilityState !== 'visible' || !navigator.onLine) return;
      void Promise.all([import('@/lib/journal-remote'), import('@/lib/account-prefs-remote'), import('@/lib/trips-remote')])
        .then(([j, p, t]) => Promise.all([j.flushPendingJournal(), p.flushPendingPrefs(), t.flushPendingTripSync()]))
        .catch((err) => console.warn('[sync-status] flush unavailable:', err));
    };
    flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  // #267/#271: a REFUSED change (write) or a REFUSED read reads as pending forever, which is the
  // one thing this pill must never say. `blocked` is a subset of `pending` (a refused chunk is
  // never acked); `readBlocked` has no count to give (a denied snapshot stream has no chunk to key
  // against), so it ORs straight into `isBlocked` instead of adding to `blocked`.
  // An anonymous session outranks every other state; nothing else is live until it signs in.
  const isBlocked = !signInRequired && (blocked > 0 || readBlocked);

  // Dormant/guest (both read as pending:0 + lastAckAt:null + readBlocked:false) OR a real build
  // that has simply never synced anything yet — either way, nothing to show. But a device denied
  // on its very FIRST read (never synced: pending:0, lastAckAt:null) must still show — that is
  // the #271 case this pill exists for — so `isBlocked` gets its own clause rather than folding
  // into the pending/lastAckAt check above.
  // #845: the listener died without a refusal (weak network); our pushes may still land but peers' edits do not arrive.
  const isDead = !signInRequired && !isBlocked && readDead;
  const show = signInRequired || pending !== 0 || lastAckAt !== null || isBlocked || isDead || localOnly;
  const isPending = !signInRequired && !isDead && pending > 0;
  // D-542 — LAST in precedence. `localOnly` and a pending/blocked count are mutually exclusive in
  // practice (a local-only device has a gated-off outbox, so it can never accumulate either), but
  // ordering it last means that if they ever do co-occur the live fact wins over the invitation.
  const isLocalOnly = !signInRequired && localOnly && !isBlocked && !isDead && !isPending;
  // The same amber the pre-flight rows already use for 'attention' (with the same AlertTriangle),
  // so the two surfaces reading this one outbox agree on what a refusal looks like.
  const tone = isBlocked || isDead ? 'text-amber-300' : 'text-ink-mid';
  const relative = lastAckAt ? formatRelativeTime(lastAckAt) : null;
  /**
   * How many OTHER devices are on this trip right now. Being alone on a trip is the NORMAL case,
   * not a fault: it gets a quieter word ("Saved" — uploaded, read by nobody yet) and keeps the
   * same neutral check mark, never amber and never an alert. Only the presence of an audience is
   * stated as a positive; its absence is stated as a fact, in the sr-only sentence.
   */
  const audience = peers.length;
  const label = signInRequired
    ? 'Sign in to sync'
    : isBlocked
    ? blocked > 0
      ? `${blocked} not syncing`
      : 'Not syncing'
    : isDead
      ? 'Not receiving updates'
    : isPending
      ? `${pending} pending`
      : isLocalOnly
        ? 'This device only'
        : audience > 0
          ? `Synced · ${audience} here`
          : `Saved ${relative ?? 'recently'}`;
  const hint = isBlocked
    ? 'Ask a member to add this device.'
    : isDead
      ? 'Check your connection.'
      : null;
  const Box = isBlocked ? TripAccessLink : 'div';
  const localOnlySummary =
    'Your plan is saved on this device only. It moves onto the shared trip once you sign in and agree to replace it, and nothing you change here reaches anyone else until then.';
  const summary = signInRequired
    ? `Sign in to sync. ${pending > 0 ? `${pending} change${pending === 1 ? ' is' : 's are'} saved here and will` : 'Changes stay on this device and'} upload once you sign in with your username and password.`
    : isBlocked
    ? blocked > 0
      ? `The shared trip refused ${blocked} change${blocked === 1 ? '' : 's'}, so ${blocked === 1 ? 'it is' : 'they are'} saved on this device only and will not upload on their own. If you were just added to this trip, reload the page; otherwise ask a member to add this device in Settings, under Trip access.`
      : `The shared trip refused to send this device its latest data. If you were just added to this trip, reload the page; otherwise ask a member to add this device in Settings, under Trip access.`
    : isDead
      ? `This device is not receiving updates from the shared trip, so other travellers' changes may be missing. It keeps retrying on its own${pending > 0 ? `, and ${pending} change${pending === 1 ? '' : 's'} of yours ${pending === 1 ? 'is' : 'are'} still waiting to upload` : ''}. Check your connection.`
    : isPending
      ? `${pending} change${pending === 1 ? '' : 's'} ${pending === 1 ? 'is' : 'are'} waiting to sync to the shared trip. This will clear automatically once the connection confirms.`
      : isLocalOnly
        ? localOnlySummary
        : audience > 0
          ? `All changes are synced to the shared trip. ${audience === 1 ? `${peers[0].name} is` : `${audience} other travellers are`} on it right now.`
          : `All changes are uploaded to the shared trip, and will be there the next time someone opens it. No one else is on the trip right now.`;
  const state = signInRequired
    ? 'sign-in-required'
    : isBlocked
      ? 'blocked'
      : isDead
        ? 'dead'
        : isPending
          ? 'pending'
          : isLocalOnly
            ? 'local-only'
            : audience > 0
              ? 'synced'
              : 'synced-alone';
  // #1093: the live region holds only this, keyed to the state, so an ack that just moves the
  // relative time (or a count) changes nothing it holds and announces nothing.
  const announcement = show ? ANNOUNCEMENTS[state] : '';

  return (
    <>
      {show && (
        <m.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="sync-status-badge"
          data-state={state}
          className="fixed top-[calc(5rem+var(--safe-top))] right-4 z-40 max-w-[calc(100vw-2rem)]"
        >
          {/* Printed stock, not glass. The FILL grammar carries the state: a struck
              (solid) rule when synced, a hollow dashed one when the sync has not
              landed. The word always says which — colour is never the only carrier. */}
          <Box
            {...(isBlocked ? { 'aria-label': `${label}, open Trip access`, 'aria-describedby': summaryId } : {})}
            className={`flex items-center gap-2 bg-[rgb(var(--surface-low))] px-2.5 py-1.5 rounded-r1 border-2 ${
              signInRequired || isBlocked || isDead || isPending || isLocalOnly
                ? 'border-dashed border-[color:var(--text-lo)]'
                : 'border-[hsl(var(--border))]'
            } ${isBlocked ? 'min-h-tap outline-none focus-visible:ring-2 focus-visible:ring-ring' : ''} ${tone}`}
          >
            {signInRequired ? (
              <CloudOff className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : isBlocked || isDead ? (
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : isPending ? (
              <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : isLocalOnly ? (
              <MonitorSmartphone className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <span className="flex flex-col">
              <span data-testid="sync-status-text" className={`pr ${tone}`}>
                {label}
              </span>
              {hint && (
                <span data-testid="sync-status-hint" aria-hidden="true" className="text-t-micro text-ink-mid">
                  {hint}
                </span>
              )}
            </span>
            <span id={summaryId} className="sr-only">{summary}</span>
          </Box>
        </m.div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
}

const ANNOUNCEMENTS = {
  'sign-in-required': 'Sign in to sync',
  blocked: 'Not syncing',
  dead: 'Not receiving updates',
  pending: 'Changes waiting to sync',
  'local-only': 'This device only',
  synced: 'Synced',
  'synced-alone': 'Saved',
} as const;

export default SyncStatusBadge;
