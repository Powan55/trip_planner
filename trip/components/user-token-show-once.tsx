'use client';

import { useState } from 'react';
import { Check, Copy, ShieldAlert } from 'lucide-react';

/**
 * "Save your User Token" — the ONE show-once screen.
 *
 * mints a **User Token** (the ACCOUNT credential — the promoted key-28 Sync Code) in three
 * places: the front door's "Create an account" path, the guest→account conversion, and the
 * grandfathered "Finish your account" upgrade. All three owe the user the same thing exactly once:
 * the token, prominently, with a copy control, an honest "this is the only way back in" warning,
 * and a deliberate confirm. So it is ONE component with three mounts, not three screens.
 *
 * Presentation only — it neither mints nor persists. The CALLER mints (`crypto.randomUUID()`),
 * persists (`setSyncCode`), and decides what `onConfirm` does (reload / navigate). That keeps this
 * component reusable from the firebase-free front door (it imports nothing but React + icons) and
 * from an ordinary page island alike.
 *
 * Deliberately a plain BLOCK, not a dialog: the door renders it inside the wall's existing
 * `role="dialog"` panel (a state of the wall, not a new route — nesting a dialog in a dialog would
 * break the contract), and `/trips` renders it inline in a card.
 *
 * A11y: `<h3>` heading, the token in a selectable `<code>` (never masked — the whole point is that
 * it is read/copied now), `aria-live` copy confirmation, ≥44px targets, visible focus rings. The
 * confirm is the ONLY way forward — there is no dismiss, because dismissing loses the account.
 */
export default function UserTokenShowOnce({
  token,
  onConfirm,
  heading = 'Save your User Token',
  confirmLabel = 'I saved it — continue',
  testIdPrefix = 'user-token-show-once',
}: {
  token: string;
  onConfirm: () => void;
  heading?: string;
  confirmLabel?: string;
  testIdPrefix?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (permissions / insecure context) — the value stays on screen to select. */
    }
  };

  return (
    <div data-testid={testIdPrefix} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-white">{heading}</h3>

      <code
        data-testid={`${testIdPrefix}-value`}
        className="block w-full break-all rounded-xl border border-gold-400/40 bg-gold-400/[0.06] px-3 py-3 font-mono text-sm text-white"
      >
        {token}
      </code>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-white/60">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-400" aria-hidden="true" />
        <span>
          This is the only way back into your account &mdash; save it somewhere safe now, because it
          cannot be recovered. <strong className="font-semibold text-white/80">Never share it:</strong>{' '}
          it opens your whole account. To share a single trip, share that trip&rsquo;s Trip Token
          instead.
        </span>
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={copy}
          autoFocus
          data-testid={`${testIdPrefix}-copy`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy User Token'}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          data-testid={`${testIdPrefix}-confirm`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {confirmLabel}
        </button>
      </div>

      <div aria-live="polite" className="sr-only">
        {copied ? 'User Token copied to clipboard' : ''}
      </div>
    </div>
  );
}
