'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  HelpCircle,
  MapPinned,
  PlaneTakeoff,
} from 'lucide-react';
import { useSyncStatus } from '@/hooks/use-sync-status';
import {
  evaluateSync,
  runEnvironmentChecks,
  type PreflightCheck,
  type PreflightState,
} from '@/lib/preflight';

/**
 * PreflightChecks (#20) — the MACHINE-checked half of `/checklist`, sitting under the
 * human-attested day-zero list: the handful of things you'd want confirmed the evening before
 * flying. Every verdict is computed locally; see `lib/preflight.ts` for the checks themselves
 * and for why nothing here is allowed to touch the network.
 *
 * Placement: same route, same user moment as the day-zero section (`core/docs/model.ts`) rather
 * than a new route — "am I ready?" split across two surfaces is worse than a longer page, and
 * the mobile tab bar is already at its D-231 limit.
 *
 * A11y (an acceptance criterion, not polish): this is a STATUS surface, so it mirrors
 * `components/sync-status-badge.tsx` — `role="status"` + `aria-live="polite"` so the verdicts
 * are announced when they resolve, plus an `sr-only` full-sentence summary. State is carried by
 * the headline TEXT and the icon shape, never by colour alone. Static markup, no motion.
 */

const STATE_ICON: Record<PreflightState, typeof CheckCircle2> = {
  ok: CheckCircle2,
  attention: AlertTriangle,
  unknown: HelpCircle,
};

const STATE_CLASS: Record<PreflightState, string> = {
  ok: 'text-emerald-300',
  attention: 'text-amber-300',
  // Deliberately the TOP ink tier, not a dimmed one: the route is axe-scanned
  // (e2e/docs-checklist-a11y.spec.ts) and a "couldn't check" verdict is exactly the line a
  // traveler must not miss. It is the row's headline, so it takes the headline's tier.
  unknown: 'text-ink-hi',
};

const ROW_ICON: Record<string, typeof MapPinned> = {
  'map-shell': MapPinned,
  storage: HardDrive,
  clock: Clock,
  'simulated-clock': Clock,
  sync: Database,
};

function CheckRow({ check }: { check: PreflightCheck }) {
  const StateIcon = STATE_ICON[check.state];
  const RowIcon = ROW_ICON[check.id] ?? CheckCircle2;
  return (
    <li
      data-testid={`preflight-row-${check.id}`}
      data-state={check.state}
      className="flex items-start gap-3 border-b border-white/5 py-3 last:border-b-0"
    >
      <RowIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">{check.label}</p>
        <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${STATE_CLASS[check.state]}`}>
          <StateIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {check.headline}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-mid">{check.detail}</p>
      </div>
    </li>
  );
}

export default function PreflightChecks() {
  // Sync is reactive (the outbox can drain while this page is open); the other three are
  // one-shot reads on mount. `null` = still checking — never an optimistic placeholder.
  const syncStatus = useSyncStatus();
  const [environment, setEnvironment] = useState<PreflightCheck[] | null>(null);

  useEffect(() => {
    let alive = true;
    runEnvironmentChecks()
      .then((checks) => {
        if (alive) setEnvironment(checks);
      })
      // Cannot reject today — every check self-catches — but a permanent "Checking…" would be the
      // ONE state that breaks this module's own rule that anything unknown must say so. A promise
      // that silently never settles is a false pass wearing a spinner.
      .catch(() => {
        if (alive) setEnvironment([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const checks: PreflightCheck[] | null = environment && [...environment, evaluateSync(syncStatus)];

  const tally = (state: PreflightState) => (checks ?? []).filter((c) => c.state === state).length;
  const summary = checks
    ? `Night-before check: ${checks
        .map((c) => `${c.label} — ${c.headline}`)
        .join('. ')}. ${tally('ok')} ready, ${tally('attention')} needing attention, ${tally(
        'unknown'
      )} that couldn't be checked. None of these checks used the network.`
    : 'Running the night-before checks on this device.';

  return (
    <section
      aria-labelledby="preflight-heading"
      data-testid="preflight-checks"
      className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6"
    >
      <div className="glass-subtle rounded-2xl p-5">
        <p className="mb-1 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          <PlaneTakeoff className="h-3.5 w-3.5" aria-hidden="true" />
          The night before
        </p>
        <h2 id="preflight-heading" className="font-display text-lg font-bold text-white">
          Ready to go?
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-mid">
          What this device can confirm on its own — no connection needed, and nothing here is sent
          anywhere.
        </p>
        {/* The live region is THIS SPAN, not the card. `role="status"` carries an implicit
            `aria-atomic="true"`, so putting it on the <section> re-announced the eyebrow, the
            heading, the intro, this summary, the tally AND all five rows with their detail
            sentences — several hundred words — every time the checks resolved, and again on every
            `useSyncStatus` change while the page sat open. It also REPLACED the section's implicit
            `region` role, dropping the block out of landmark navigation. Scoped here, one sentence
            is spoken, the rows stay browsable, and the landmark comes back. The badge this block
            was modelled on (`sync-status-badge.tsx`) can hold the role on its wrapper because that
            wrapper IS one short label — the contract does not survive being scaled to a card. */}
        <span role="status" aria-live="polite" className="sr-only">
          {summary}
        </span>

        {checks === null ? (
          <p data-testid="preflight-loading" className="mt-4 text-sm text-ink-mid">
            Checking…
          </p>
        ) : (
          <>
            <p data-testid="preflight-tally" className="mt-3 text-xs font-medium text-ink-mid">
              {tally('ok')} ready · {tally('attention')} to look at · {tally('unknown')} couldn&apos;t
              be checked
            </p>
            <ul aria-labelledby="preflight-heading" className="mt-2 flex flex-col">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
