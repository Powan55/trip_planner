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
 * capability, never a login) and never gets renamed. The two are named side by side under the
 * caution below, because this is the screen where they are most easily confused.
 *
 * THE KEY IS THE SUBJECT, so it is the largest thing here and the heading is a printed label
 * above it — not the other way round. `.stamp--live` is this surface's ONE accent fill and it
 * spends it on the fact the screen exists to state: shown once, now, and never again.
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
 * BOTH SAVE PATHS CAN FAIL AND BOTH NOW SAY SO. `navigator.clipboard` rejects outright on an
 * insecure origin or a denied permission, and the object-URL anchor is blocked by some managed
 * profiles. A swallowed failure on this screen reads as a successful save of the one credential
 * that cannot be re-issued, so each failure states its condition in words and points at the other
 * path. The notice is an always-mounted live region, not a node that appears — a region that
 * mounts with its text already in it is not reliably announced.
 *
 * A11y: `<h3>` heading, the key in a selectable `<code>` (never masked — the whole point is that it
 * is read/copied now), a real `<input type="checkbox">` with a `<label htmlFor>`, an `aria-live`
 * notice, tap-floor targets, visible focus rings. The confirm is the ONLY way forward — there is
 * no dismiss, because dismissing loses the account.
 */
type Notice = { tone: 'ok' | 'err'; text: string };

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  // Both mounts can exist in one document, so the checkbox id must be per-instance.
  const ackId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setNotice({ tone: 'ok', text: 'Copied. Paste it somewhere that survives this device.' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice({
        tone: 'err',
        text: 'This browser blocked the clipboard. Select the key above and copy it by hand, or save it as a file.',
      });
    }
  };

  // Durable save path (token-only auth has NO recovery — a lost clipboard = permanent lockout).
  // Blob + object-URL anchor, no dependency; revoke after the click so nothing leaks.
  const download = () => {
    try {
      const body = `${token}\n\nThis is your key — the only way back into your account. Keep it safe; never share it.\n`;
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nepal-japan-your-key.txt';
      a.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: 'ok', text: 'Saved as nepal-japan-your-key.txt.' });
    } catch {
      setNotice({
        tone: 'err',
        text: 'This browser blocked the download. Copy the key instead, or write it down.',
      });
    }
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="pr pr--l text-ink-hi">{heading}</h3>
        <span
          className="stamp stamp--live"
          data-testid={`${testIdPrefix}-once`}
        >
          Shown once
        </span>
      </div>

      <div>
        <span className="pr block">Your key &middot; User Token</span>
        <code
          data-testid={`${testIdPrefix}-value`}
          className="mt-1 flex w-full flex-wrap items-center gap-x-2 gap-y-1 break-all rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface-overlay px-3 py-3 font-machine text-n-sm tabular-nums text-ink-hi"
        >
          {groups.map((chunks, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <span className="text-ink-lo">-</span>}
              {chunks.map((chunk, ci) => (
                <span key={ci}>{chunk}</span>
              ))}
            </Fragment>
          ))}
        </code>
      </div>

      <p className="text-t-body leading-relaxed text-ink-mid">
        It&rsquo;s how you get back in. There&rsquo;s no email and no password, so if you lose it,
        the account is gone. This screen does not come back and nothing can re-issue the key
        &mdash; put it in your notes app or password manager before you continue.
      </p>

      <p className="flex items-start gap-1.5 text-t-sm leading-relaxed text-ink-mid">
        <ShieldAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--coral)]"
          aria-hidden="true"
        />
        <span>
          <strong className="font-semibold text-ink-hi">Never share it:</strong> it opens your
          whole account. To share a single trip, share that trip&rsquo;s Trip Token instead
          &mdash; a different key, for one trip, and safe to hand out.
        </span>
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={copy}
          autoFocus
          data-testid={`${testIdPrefix}-copy`}
          className="btn btn--2 flex-1 px-4"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={download}
          data-testid={`${testIdPrefix}-download`}
          className="btn btn--2 flex-1 px-4"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Save as a file
        </button>
      </div>

      {/* Always mounted so the region exists before it has anything to say. */}
      <div aria-live="polite" data-testid={`${testIdPrefix}-notice`}>
        {notice && (
          <p
            className={
              notice.tone === 'err'
                ? 'err border-hair border-[color:hsl(var(--destructive))] px-gut py-2 text-t-sm leading-relaxed'
                : 'text-t-sm leading-relaxed text-ink-mid'
            }
          >
            {notice.text}
          </p>
        )}
      </div>

      {/* The save gate. Confirm stays disabled until this is ticked — see the module comment.
          The label carries the tap floor, not the row: a 20px box inside a 44px row is a 20px
          target, and the label is what most people actually hit. */}
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          id={ackId}
          checked={acknowledged}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAcknowledged(e.target.checked)}
          data-testid={`${testIdPrefix}-ack`}
          className="h-5 w-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
        <label
          htmlFor={ackId}
          className="flex min-h-tap flex-1 cursor-pointer items-center text-t-body text-ink-hi"
        >
          I&rsquo;ve saved my key
        </label>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={!acknowledged}
        data-testid={`${testIdPrefix}-confirm`}
        className="btn w-full px-4"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
