'use client';

import { Fragment, useId, useState } from 'react';
import { Check, Copy, Download, ShieldAlert } from 'lucide-react';

/**
 * "This is your key." — the ONE show-once screen.
 *
 * mints a **User Token** (the ACCOUNT credential — the promoted key-28 Sync Code) in two
 * places: the front door's "Create an account" path, and the grandfathered "Finish your account"
 * upgrade. Both owe the user the same thing exactly once: the token, prominently, with a copy
 * control, an honest "this is the only way back in" warning, and a deliberate confirm. So it is
 * ONE component with two mounts, not two screens.
 *
 * NAMING: "User Token" stays the formal name of the CONCEPT in and in these comments;
 * **"your key" is what the user sees.** The two are the same thing — do not "fix" the mismatch by
 * renaming one to match the other. A *Trip Token* is a different concept entirely (one trip's
 * capability, never a login) and never gets renamed.
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
 * adds a REQUIRED "I've saved my key" acknowledgement gating the confirm. Token-only auth has
 * no recovery path at all, so a one-click dismiss here is a permanent account loss one misclick
 * away; the checkbox is the cheapest real speed bump. Both mounts get it — the grandfathered
 * upgrade is being handed the same irreplaceable credential.
 *
 * A11y: `<h3>` heading, the key in a selectable `<code>` (never masked — the whole point is that it
 * is read/copied now), a real `<input type="checkbox">` with a `<label htmlFor>`, `aria-live` copy
 * confirmation, ≥44px targets, visible focus rings. The confirm is the ONLY way forward — there is
 * no dismiss, because dismissing loses the account.
 */
export default function UserTokenShowOnce({
  token,
  onConfirm,
  heading = 'This is your key.',
  confirmLabel = 'Continue',
  testIdPrefix = 'user-token-show-once',
}: {
  token: string;
  onConfirm: () => void;
  heading?: string;
  confirmLabel?: string;
  testIdPrefix?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  // Both mounts can exist in one document, so the checkbox id must be per-instance.
  const ackId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (permissions / insecure context) — the value stays on screen to select. */
    }
  };

  // Durable save path (token-only auth has NO recovery — a lost clipboard = permanent lockout).
  // Blob + object-URL anchor, no dependency; revoke after the click so nothing leaks.
  const download = () => {
    const body = `${token}\n\nThis is your key — the only way back into your account. Keep it safe; never share it.\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nepal-japan-your-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Group the key into 4-character runs so it can be read aloud / typed by hand, WITHOUT changing a
   * single character of it: the runs are separate elements spaced by CSS `gap`, never by inserted
   * whitespace, so the element's `textContent` is still EXACTLY `token`. Two specs assert that
   * verbatim (`e2e/token-trips.spec.ts:159`, `e2e/trips-hub.spec.ts:272`) and, far more
   * importantly, a user who selects and copies by hand must get a usable key. Splitting on the
   * UUID's own hyphens first keeps the dashes between groups instead of stranding them mid-run;
   * a non-UUID token round-trips unchanged through the same code.
   */
  const groups = token.split('-').map((part) => part.match(/.{1,4}/g) ?? [part]);

  return (
    <div data-testid={testIdPrefix} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-white">{heading}</h3>

      <code
        data-testid={`${testIdPrefix}-value`}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 break-all rounded-xl border border-gold-400/40 bg-gold-400/[0.06] px-3 py-3 font-mono text-sm tabular-nums text-white"
      >
        {groups.map((chunks, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <span className="text-white/40">-</span>}
            {chunks.map((chunk, ci) => (
              <span key={ci}>{chunk}</span>
            ))}
          </Fragment>
        ))}
      </code>

      <p className="text-xs leading-relaxed text-white/60">
        It&rsquo;s how you get back in. There&rsquo;s no email and no password, so if you lose it,
        the account is gone. Put it in your notes app or password manager right now.
      </p>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-white/60">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-400" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-white/80">Never share it:</strong> it opens your
          whole account. To share a single trip, share that trip&rsquo;s Trip Token instead.
        </span>
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={copy}
          autoFocus
          data-testid={`${testIdPrefix}-copy`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={download}
          data-testid={`${testIdPrefix}-download`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Save as a file
        </button>
      </div>

      {/* The save gate. Confirm stays disabled until this is ticked — see the module comment. */}
      <div className="flex min-h-[44px] items-center gap-2.5">
        <input
          type="checkbox"
          id={ackId}
          checked={acknowledged}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAcknowledged(e.target.checked)}
          data-testid={`${testIdPrefix}-ack`}
          className="h-5 w-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
        <label htmlFor={ackId} className="cursor-pointer text-sm text-white/80">
          I&rsquo;ve saved my key
        </label>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={!acknowledged}
        data-testid={`${testIdPrefix}-confirm`}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        {confirmLabel}
      </button>

      <div aria-live="polite" className="sr-only">
        {copied ? 'Your key copied to clipboard' : ''}
      </div>
    </div>
  );
}
