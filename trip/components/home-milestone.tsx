'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Trophy } from 'lucide-react';
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
      className="relative mx-auto mt-[12px] flex h-[44px] max-w-[1200px] items-center gap-2 rounded-[20px] bg-surface-low px-4"
    >
      <CelebrationBurst active={celebrating && burstAllowed} testId="home-milestone-burst" />
      <Trophy
        className={`h-3.5 w-3.5 shrink-0 ${current ? 'text-primary' : 'text-ink-lo'}`}
        aria-hidden="true"
      />
      {/* ink-lo on --surface-low measures 6.89:1 (the caption pairing this band already uses);
          ink-hi for a reached milestone is 17.88:1. Both clear AA comfortably.
          `line-clamp-2`, NOT `truncate`: the longest string here is the empty state, which wraps
          to two lines at 320px, and two lines of `text-xs leading-tight` (~16px each) fit the
          44px box. Truncating it would hide the second half of the only sentence this line has
          to say when nothing has happened yet. */}
      <p
        role="status"
        data-testid="home-milestone-label"
        className={`min-w-0 line-clamp-2 text-xs leading-tight ${current ? 'font-semibold text-ink-hi' : 'text-ink-lo'}`}
      >
        {current ? current.label : 'No milestones yet — the first lands when the trip does'}
      </p>
    </div>
  );
}
