'use client';

import { useMemo, type CSSProperties } from 'react';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useBudget } from '@/hooks/use-budget';
import { useExpenses } from '@/hooks/use-expenses';
import { usePacking } from '@/hooks/use-packing';
import { useDocs } from '@/hooks/use-docs';
import { rollUp } from '@/core/budget/model';
import { expensesToSpent } from '@/core/budget/expenses';
import { TRIP_DATES } from '@/lib/trip-data';

/**
 * Home's readiness check — the one place that answers "what is done and what is not",
 * rolled up across the four things that actually have a completion state.
 *
 * WHY IT IS NOT A FIFTH BENTO TILE. `home-bento.tsx` answers "how is it going right now"
 * one subject per tile — packing %, docs %, spend against budget. This answers a different
 * question, "is this trip ready", and that answer only exists ACROSS those subjects. A
 * roll-up split back into tiles is just the tiles again.
 *
 * EVERY FIGURE IS READ FROM THE SAME HOOK THE BENTO READS. There is no second source of
 * truth and no arithmetic here that lives anywhere else: `usePacking` and `useDocs` already
 * return their own totals, `rollUp` already decides whether a budget exists, and the planned
 * day count is `plans` filtered on `items.length` — the same filter `home-bento.tsx` uses for
 * its "Next up" tile. If one of those changes, this section changes with it for free.
 *
 * STATE IS NEVER COLOUR ALONE (D-293 R9). Each row writes its condition as a WORD — Ready /
 * In progress / Not started — and repeats it in `aria-label` with the counts. The mark and
 * the track only repeat what the row already says in text.
 *
 * NOTHING IS CLAIMED BEFORE THE READS LAND. The rows are gated on `hydrated` exactly as the
 * summary is: an ungated row renders its zero state first, so a prepared trip read "Not started"
 * on four rows and then corrected itself — the worst wrong state this route can show. Until the
 * three stores settle, the SHAPE renders instead (SPEC 9.8, same as `preflight-checks.tsx`): the
 * four rows it will hold, at full size, hollow, each saying in words that it is still reading,
 * with `LOADING` as a real text node.
 *
 * NO MOTION. Nothing here animates, so the route's motion tiering in
 * `scripts/motion-loops.mjs` and `lib/__tests__/motion-budget.test.ts` is untouched.
 *
 * NOT IN `home-section-nav.tsx`'s SECTIONS. The nav lists five landmarks and adding a sixth
 * would change a shipped control; this rides under Dashboard, immediately after it.
 */

type Status = 'ready' | 'partial' | 'none';

interface Check {
  id: string;
  label: string;
  /** What the row says in words. Never conveyed by colour or icon alone. */
  detail: string;
  status: Status;
  /** Present only where a real fraction exists — budget has none. */
  pct: number | null;
}

const WORD: Record<Status, string> = {
  ready: 'Ready',
  partial: 'In progress',
  none: 'Not started',
};

/** The annunciator's own three states (SPEC 9.3), which the recipe styles off `data-s`. */
const SIGNAL: Record<Status, 'struck' | 'part' | 'hollow'> = {
  ready: 'struck',
  partial: 'part',
  none: 'hollow',
};

const MARK: Record<Status, string> = {
  ready: 'mk mk--struck',
  partial: 'mk mk--part',
  none: 'mk mk--hollow',
};

/**
 * The rows the annunciator will hold, drawn at full size before the stores settle. `track` marks
 * the rows that carry a fraction bar once read — hollow here, so the row does not GROW a 3px
 * track on hydration. Budget has no fraction in either state.
 *
 * KNOWN CEILING: the days row's copy is LONGER on purpose. Its settled sentence is a fixed
 * format ("n of 32 days have something on them", 34-36 chars) which wraps to two lines below
 * 480px and in the two-column grid at 640-1023; a short line there would leave the section
 * 20.7px shorter than it settles at. Measured on the built export, this copy makes the
 * loading and settled heights identical at 390/430/480/640/900/1280. Re-measure if either
 * sentence is reworded.
 */
const LOADING_ROWS: Array<{ id: string; label: string; cond: string; track: boolean }> = [
  { id: 'days', label: 'Days planned', cond: 'Reading the day plans on this device…', track: true },
  { id: 'docs', label: 'Documents', cond: 'Reading this device…', track: true },
  { id: 'packing', label: 'Packing', cond: 'Reading this device…', track: true },
  { id: 'budget', label: 'Budget', cond: 'Reading this device…', track: false },
];

/** `done/total` -> a status, with 0-total meaning the list does not exist yet. */
function fracStatus(done: number, total: number): Status {
  if (total === 0 || done === 0) return 'none';
  return done >= total ? 'ready' : 'partial';
}

export default function HomeReadiness() {
  const { plans, hydrated: itineraryHydrated } = useItineraryContext();
  const { model } = useBudget();
  const { expenses } = useExpenses();
  const { progress: packing, hydrated: packingHydrated } = usePacking();
  const { completion: docs, hydrated: docsHydrated } = useDocs();

  const roll = rollUp(model, expensesToSpent(expenses));
  const hydrated = itineraryHydrated && packingHydrated && docsHydrated;

  const checks = useMemo<Check[]>(() => {
    const totalDays = TRIP_DATES.length;
    const plannedDays = plans.filter((p) => p.items?.length).length;
    const budgetSet = roll.totalBudgetHome > 0;

    return [
      {
        id: 'days',
        label: 'Days planned',
        detail: `${plannedDays} of ${totalDays} days have something on them`,
        status: fracStatus(plannedDays, totalDays),
        pct: totalDays > 0 ? Math.round((plannedDays / totalDays) * 100) : null,
      },
      {
        id: 'docs',
        label: 'Documents',
        detail:
          docs.total > 0
            ? `${docs.done} of ${docs.total} checked off`
            : 'No checklist yet',
        status: fracStatus(docs.done, docs.total),
        pct: docs.total > 0 ? Math.round((docs.done / docs.total) * 100) : null,
      },
      {
        id: 'packing',
        label: 'Packing',
        detail:
          packing.total > 0
            ? `${packing.checked} of ${packing.total} packed`
            : 'No packing list yet',
        status: fracStatus(packing.checked, packing.total),
        pct: packing.total > 0 ? Math.round((packing.checked / packing.total) * 100) : null,
      },
      {
        id: 'budget',
        label: 'Budget',
        detail: budgetSet ? 'Set, and tracking spend' : 'No budget set yet',
        status: budgetSet ? 'ready' : 'none',
        pct: null,
      },
    ];
  }, [plans, docs.done, docs.total, packing.checked, packing.total, roll.totalBudgetHome]);

  const readyCount = checks.filter((c) => c.status === 'ready').length;

  return (
    <section
      aria-labelledby="readiness-heading"
      data-testid="home-readiness"
      className="bg-surface py-10 sm:py-14"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="sec px-gut">
          <h2 id="readiness-heading">Before you fly</h2>
          <span className="sub">
            {hydrated ? `${readyCount} of ${checks.length} ready` : 'Reading this device'}
          </span>
        </div>

        {/* The annunciator. The track is capped at 260px by the recipe so the UNFILLED
            remainder is always visible — a bar with no remainder is an underline, not a
            reading. Every row states its condition in words, which is what makes the mark
            redundant rather than the only cue. */}
        {!hydrated ? (
          <ul
            data-testid="home-readiness-loading"
            aria-labelledby="readiness-heading"
            className="sys sm:grid sm:grid-cols-2"
          >
            {LOADING_ROWS.map((row) => (
              <li
                key={row.id}
                data-testid={`home-readiness-loading-${row.id}`}
                data-s="hollow"
                className="r"
              >
                <span aria-hidden="true" className="mk mk--hollow" />
                <span className="min-w-0">
                  <span className="nm block">{row.label}</span>
                  <span className="cond block">{row.cond}</span>
                  {row.track && (
                    <span className="fill">
                      <i style={{ ['--w']: '0%' } as CSSProperties} />
                    </span>
                  )}
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
          <ul className="sys sm:grid sm:grid-cols-2">
            {checks.map((check) => (
              <li
                key={check.id}
                data-testid={`home-readiness-${check.id}`}
                data-status={check.status}
                data-s={SIGNAL[check.status]}
                className="r"
                // The full condition in words, so the row never depends on the mark.
                aria-label={`${check.label}. ${WORD[check.status]}. ${check.detail}.`}
                style={check.pct !== null ? ({ ['--p']: `${check.pct}%` } as CSSProperties) : undefined}
              >
                <span aria-hidden="true" className={MARK[check.status]} />
                <span className="min-w-0">
                  <span className="nm block">{check.label}</span>
                  <span className="cond block break-words">{check.detail}</span>
                  {check.pct !== null && (
                    <span className="fill">
                      <i
                        data-testid={`home-readiness-${check.id}-bar`}
                        style={{ ['--w']: `${check.pct}%` } as CSSProperties}
                      />
                    </span>
                  )}
                </span>
                <span className="val">
                  {check.pct !== null && <b>{check.pct}%</b>}
                  <i data-testid={`home-readiness-${check.id}-word`}>{WORD[check.status]}</i>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
