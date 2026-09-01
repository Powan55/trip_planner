'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import CelebrationBurst from '@/components/celebration-burst';
import { isMotionAllowed, tierForPath } from '@/lib/motion';
import { milestonesReached, newlyReached, type MilestoneInput } from '@/lib/milestones';

/**
 * The milestone line under Home's stat band (issue #31).
 *
 * It is a SEPARATE FILE but NOT a separate island: `components/home-stat-row.tsx` imports it
 * statically, so it rides that component's existing lazy chunk. A second `dynamic()` on Home
 * would add a chunk to a route whose First Load JS the page file says sits within a couple of
 * bytes of the rounding boundary, and this is ~40 lines.
 *
 * ── FIXED HEIGHT, ALWAYS PRESENT ───────────────────────────────────────────────────────────
 * The box is `h-[44px]` whether or not a milestone has been reached, and the copy has an
 * honest empty state rather than the element disappearing. `app/page.tsx` reserves the stat
 * band's height for its lazy placeholder (`STAT_ROW_H`); a banner that appeared later would
 * grow the section past that reservation and shift everything below it. The pixel arithmetic
 * lives in that file's comment — keep the two in step.
 *
 * ── MOTION ─────────────────────────────────────────────────────────────────────────────────
 * The celebration is a BURST, which D-293 rule 6 permits on Tier 1 only, so it asks
 * `lib/motion.ts` — `isMotionAllowed('burst', tierForPath(pathname))` — rather than assuming
 * Home. Reduced motion is handled one layer down: `<CelebrationBurst/>` renders nothing under
 * it (D-056(b)), via framer's reactive `useReducedMotion()`, which `lib/motion.ts`'s docblock
 * explicitly keeps as the right tool inside a component. NO `matchMedia` call is added here;
 * issue #24 collapsed five of those into one and there is still exactly one.
 *
 * The banner text itself is not motion — it is `role="status"`, so a milestone crossed while
 * the page is open is announced whether or not anything is allowed to move.
 */
export default function HomeMilestone({ input }: { input: MilestoneInput }) {
  const pathname = usePathname();
  const burstAllowed = isMotionAllowed('burst', tierForPath(pathname));

  const reached = milestonesReached(input);
  const current = reached.length > 0 ? reached[reached.length - 1] : null;

  // The ids seen on the previous observation. `null` until the first effect run, which is what
  // makes that first run seed rather than fire (`newlyReached`, D-207).
  const seenRef = useRef<string[] | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  // Latest-value ref so the effect can read the current input WITHOUT depending on the object
  // identity of a prop the parent rebuilds every render — depending on `input` directly would
  // re-run this on every render, and its cleanup would clear the 700ms burst the moment the
  // next render landed. Keyed instead on what actually matters: which milestones are true.
  const inputRef = useRef(input);
  inputRef.current = input;
  const reachedKey = reached.map((m) => m.id).join(',');

  useEffect(() => {
    const fresh = newlyReached(seenRef.current, inputRef.current);
    seenRef.current = milestonesReached(inputRef.current).map((m) => m.id);
    if (!fresh) return;
    setCelebrating(true);
    const timer = setTimeout(() => setCelebrating(false), 700);
    return () => clearTimeout(timer);
  }, [reachedKey]);

  return (
    <div
      data-testid="home-milestone"
      data-milestone={current?.id ?? ''}
      className="relative mx-auto mt-[12px] flex h-[44px] max-w-[1200px] items-center gap-2 border-hair border-border bg-surface-low px-gut"
    >
      <CelebrationBurst
        active={celebrating && burstAllowed}
        testId="home-milestone-burst"
        // The ENTITY is the milestone, not the banner: crossing the 30-day mark and later the
        // 7-day mark are two celebrations, and each of them is owed exactly one per session (R5).
        celebrationId={`milestone:${current?.id ?? 'none'}`}
        weight="burst"
      />
      <span
        aria-hidden="true"
        className={`mk ${current ? 'mk--struck' : 'mk--hollow'}`}
      />
      {/* TWO TIERS, AND THE SPLIT IS THE 44px BOX. Empty copy sits at --t-body and never at
          the micro floor, so the nothing-crossed line is short enough to hold ONE body line
          at 320px. A reached label is authored elsewhere and can run long, so it takes
          --t-sm and clamps to two lines — 2 x 18.6px still fits the frozen height that
          `STAT_ROW_H` in app/page.tsx is summed from. ink-mid on --surface-low measures
          10.6:1, ink-hi 17.88:1. */}
      <p
        role="status"
        data-testid="home-milestone-label"
        className={`min-w-0 leading-tight ${
          current ? 'line-clamp-2 text-t-sm text-ink-hi' : 'text-t-body text-ink-mid'
        }`}
      >
        {current ? current.label : 'Not yet — the first lands with the trip'}
      </p>
    </div>
  );
}
