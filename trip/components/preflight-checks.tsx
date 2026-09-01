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

/**
 * All three headlines sit on the TOP ink tier, and that is the annunciator's own rule rather than
 * a flattening: the mark, the icon shape, the verdict chip and the words all say which state a row
 * is in, so the headline colour was never the carrier. It matters most for `unknown` — the route
 * is axe-scanned (e2e/docs-checklist-a11y.spec.ts) and a "couldn't check" verdict is exactly the
 * line a traveler must not miss.
 *
 * The `!` is load-bearing, not noise. SPEC 9.3's `.sys .cond` is (0,2,0) and
 * `.sys .r[data-s='hollow'] .cond` is (0,3,0), so a bare `text-ink-hi` is (0,1,0) and loses:
 * measured, `ok` painted --text-mid and BOTH hollow states painted --text-lo, i.e. the floor
 * tier on exactly the two rows this rule is about.
 */
const STATE_CLASS: Record<PreflightState, string> = {
  ok: '!text-ink-hi',
  attention: '!text-ink-hi',
  unknown: '!text-ink-hi',
};

/** FILLED means committed, UNFILLED means not yet — a check that did not pass is not a check that
 *  ran and failed, so both non-ok states draw hollow and say which they are in words. */
const STATE_MARK: Record<PreflightState, 'struck' | 'hollow'> = {
  ok: 'struck',
  attention: 'hollow',
  unknown: 'hollow',
};

/** The one place a colour is spent on this panel: the state that asks the traveler to DO
 *  something. --destructive is the app's only "act on this" ink and the recipe set defines no other. */
const STATE_CHIP: Record<PreflightState, string> = {
  ok: 'chip chip--struck',
  attention: 'chip border-destructive text-destructive',
  unknown: 'chip chip--hollow',
};

/**
 * The verdict word. Redundant with the mark by design, so the panel is colour-blind-safe.
 *
 * `unknown` must never spell "unchecked". This route also renders the human-attested tickbox list,
 * where unchecked means "you have not done it yet" — a determined verdict. Unknown means the probe
 * could not run at all. Folding the two makes a browser that answered nothing read like one that
 * answered "not done", which is the false pass this whole module exists to refuse.
 */
const STATE_WORD: Record<PreflightState, string> = {
  ok: 'ready',
  attention: 'look',
  unknown: 'unknown',
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
  const mark = STATE_MARK[check.state];
  return (
    <li data-testid={`preflight-row-${check.id}`} data-state={check.state} className="r" data-s={mark}>
      <span className={`mk mk--${mark}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="nm flex items-center gap-1.5">
          <RowIcon className="h-3.5 w-3.5 shrink-0 text-ink-lo" aria-hidden="true" />
          {check.label}
        </span>
        <span className={`cond mt-0.5 flex items-center gap-1.5 ${STATE_CLASS[check.state]}`}>
          <StateIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {check.headline}
        </span>
        <span className="cond mt-1 block text-t-sm leading-relaxed !text-ink-lo">{check.detail}</span>
      </span>
      <span className="val">
        <span className={STATE_CHIP[check.state]}>{STATE_WORD[check.state]}</span>
      </span>
    </li>
  );
}

/** The rows the annunciator will hold, drawn at full size before the probes resolve. The value
 *  cell carries a real LOADING text node — a bare grey block is indistinguishable from an empty
 *  one, and generated content is not reliably announced. */
const LOADING_ROWS: Array<{ id: string; label: string }> = [
  { id: 'map-shell', label: 'Map shell' },
  { id: 'storage', label: 'Storage room' },
  { id: 'clock', label: 'Clock & time zone' },
  { id: 'sync', label: 'Trip data' },
];

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
      className="mx-auto w-full max-w-3xl pb-16"
    >
      <div className="border-y-2 border-border bg-surface-low">
        <div className="px-gut pt-4">
          <p className="pr pr--lo mb-1.5 flex items-center gap-1.5">
            <PlaneTakeoff className="h-3.5 w-3.5" aria-hidden="true" />
            The night before
          </p>
          <div className="sec">
            <h2 id="preflight-heading">Ready to go?</h2>
            {checks !== null && (
              <span data-testid="preflight-tally" className="sub">
                {tally('ok')} ready · {tally('attention')} to look at · {tally('unknown')}{' '}
                couldn&apos;t be checked
              </span>
            )}
          </div>
          <p className="mb-3 max-w-2xl text-t-sm leading-relaxed text-ink-mid">
            What this device can confirm on its own — no connection needed, and nothing here is sent
            anywhere.
          </p>
        </div>
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
          // The shape arrives before the data: the same rows at the same size, hollow, each
          // saying in words that it has not run yet.
          <ul data-testid="preflight-loading" aria-labelledby="preflight-heading" className="sys">
            {LOADING_ROWS.map((row) => (
              <li key={row.id} className="r" data-s="hollow">
                <span className="mk mk--hollow" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="nm">{row.label}</span>
                  <span className="cond mt-0.5 block">Checking on this device…</span>
                </span>
                <span className="val">
                  <span className="load px-2 py-1 text-t-micro font-machine tracking-[0.12em] text-ink-lo">
                    LOADING
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul aria-labelledby="preflight-heading" className="sys">
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
