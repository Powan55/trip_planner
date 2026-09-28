'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Link2, X } from 'lucide-react';
import { useClipboardCopy } from '@/hooks/use-clipboard-copy';
import { useOnline } from '@/hooks/use-online';
import type { TripInvite } from '@/lib/invites-remote';

const fmt = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Owner controls for single-use invite links (#641). The caller already knows the roster, so it
 * passes what it knows: `open` = a confirmed roster-less trip (invites need a gated one), and
 * `isOwner` = this device is the trip's owner. Renders nothing for anyone else.
 */
export default function TripInvites({
  tripId,
  isOwner,
  open,
}: {
  tripId: string;
  isOwner: boolean;
  open: boolean;
}) {
  // `undefined` = loading, `null` = could not be read.
  const [invites, setInvites] = useState<TripInvite[] | null | undefined>(undefined);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const online = useOnline();
  const { copy, error: copyError } = useClipboardCopy();
  const active = Boolean(tripId) && isOwner && !open;

  const load = async () => {
    const { listInvites } = await import('@/lib/invites-remote');
    setInvites(await listInvites(tripId));
  };

  useEffect(() => {
    if (active) void load().catch(() => setInvites(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tripId]);

  // After a revoke the focused row is gone; focus Create once it is enabled again.
  useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false;
      createRef.current?.focus();
    }
  }, [busy]);

  if (!tripId) return null;

  if (open) {
    return (
      <p data-testid="trip-invites-open" className="max-w-2xl text-t-body text-ink-mid">
        This trip has no member list, so it can&rsquo;t use invite links.
      </p>
    );
  }

  if (!isOwner) return null;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const { createInvite } = await import('@/lib/invites-remote');
      const url = await createInvite(tripId);
      if (!url) {
        setError('Couldn’t create an invite link. Check your connection and try again.');
        return;
      }
      setLink(url);
      setStatus(
        (await copy(url))
          ? 'Invite link copied. It works once, for 7 days.'
          : 'Invite link created. It works once, for 7 days.',
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const { revokeInvite } = await import('@/lib/invites-remote');
      if (await revokeInvite(tripId, token)) {
        if (link?.endsWith(token)) setLink(null);
        setStatus('Invite cancelled. That link no longer works.');
        await load();
      } else {
        setError('Couldn’t cancel that invite. Try again.');
      }
    } finally {
      refocus.current = true;
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="trip-invites"
      className="border-hair border-border bg-surface-raised px-gut py-4"
    >
      <h3 className="pr pr--l text-ink-hi">Invite links</h3>
      <p className="mt-1 max-w-2xl text-t-body text-ink-mid">
        Each link lets one person join this trip. It stops working once used, after 7 days, or when
        you cancel it.
      </p>
      <button
        ref={createRef}
        type="button"
        onClick={create}
        disabled={busy || !online}
        aria-busy={busy}
        data-testid="trip-invites-create"
        className="btn btn--2 mt-3 px-4"
      >
        <Link2 className="h-4 w-4" aria-hidden="true" />
        Create invite link
      </button>
      {!online && (
        <p data-testid="trip-invites-offline" className="mt-2 text-t-body text-ink-mid">
          You&rsquo;re offline. Creating or cancelling an invite needs a connection.
        </p>
      )}

      {link && (
        <code
          data-testid="trip-invites-link"
          className="mt-3 block min-h-tap break-all rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface-overlay px-3 py-2.5 font-machine text-t-body leading-[1.6] text-ink-hi"
        >
          {link}
        </code>
      )}

      {invites === null ? (
        <p data-testid="trip-invites-unknown" className="mt-3 text-t-body text-ink-mid">
          Active invites aren&rsquo;t available right now &mdash; it needs a connection.
        </p>
      ) : invites && invites.length > 0 ? (
        <ul data-testid="trip-invites-list" className="mt-3 flex flex-col gap-2">
          {invites.map((inv) => (
            <li
              key={inv.token}
              data-testid="trip-invites-row"
              className="flex min-h-tap items-center gap-2 border-b-hair border-border py-2 last:border-b-0"
            >
              <span className="flex min-w-0 flex-1 flex-col justify-center px-2">
                <code className="truncate font-machine text-t-body text-ink-hi">
                  {inv.token.slice(0, 8)}…
                </code>
                <span className="text-t-sm text-ink-mid">
                  Created {fmt(inv.createdAt)} · expires {fmt(inv.expiresAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(inv.token)}
                disabled={busy || !online}
                data-testid="trip-invites-revoke"
                aria-label={`Cancel invite ${inv.token.slice(0, 8)}, created ${fmt(inv.createdAt)}`}
                className="btn btn--2 btn--danger min-w-tap px-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div aria-live="polite" className="mt-2 min-h-[1.25rem]">
        {status && (
          <p data-testid="trip-invites-status" className="text-t-body text-ink-mid">
            {status}
          </p>
        )}
      </div>
      {(error || copyError) && (
        <p
          role="alert"
          data-testid="trip-invites-error"
          className="err mt-1 flex items-center gap-2 text-t-body font-medium"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error ?? copyError}
        </p>
      )}
    </div>
  );
}
