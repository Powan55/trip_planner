'use client';

/**
 * SectionSkeleton — placeholder for `dynamic()` `loading:` slots.
 *
 * Sized to RESERVE the space a not-yet-loaded section will occupy so the code-
 * split island swapping in causes no cumulative layout shift (CLS). Wired
 * into the pages' `dynamic(() => import(...), { loading: () => <SectionSkeleton.../> })`
 * calls at integration; see the notes for which imports get it and
 * with what heights.
 *
 * NO SWEEP, AND THE WORD IS A REAL TEXT NODE. The shimmer is gone: over a
 * photograph a moving gradient reads as a rendering fault, and a static grey
 * block is indistinguishable from an EMPTY one — which is the state this
 * component is most often mistaken for. So the panel prints `LOADING` as actual
 * text (never a `content:` string, which is not reliably announced) and draws
 * the rows it is reserving as hollow frames. The shape arrives before the data.
 *
 * Consumes tokens only — `.load` for the block, `.empty-frame` for the reserved
 * rows, `.pr` for the label. This component adds no motion of its own, so there
 * is nothing to neutralize under `prefers-reduced-motion`.
 *
 * Decorative: the whole tree is `aria-hidden="true"` (a loading placeholder has
 * no semantic content; screen readers should skip it and reach the real section
 * once it mounts). The printed word is for the sighted reader; `data-loading`
 * carries the label for anything that queries it.
 *
 * 0-overflow: the outer box is `w-full` and every inner bar is width-bounded, so
 * it never widens the page at 360/390/414.
 *
 * ── `height` is a REAL box, not a floor (issue #54 D) ───────────────────────────
 * This used to set `minHeight` only. That is a lie: the intrinsic content
 * (`py-section` + `p-6` + header + three `h-40` rows, which stack in ONE column below
 * `sm`) is ~826px at 360px wide, so EVERY call site rendered 826.5px no matter what it
 * declared — including Home's `0px` and `56px` slots. The placeholder therefore reserved
 * ~697px more than the island that replaced it and caused the exact CLS this component
 * exists to prevent (measured 0.175–1.001 cold on Home at 360×740).
 *
 * So the height is now bound on BOTH sides (`height` + `maxHeight`) and the overflow is
 * clipped. Accepted, deliberate consequence: a call site declaring less than the
 * intrinsic content clips its shimmer — you see the eyebrow, the title and the top of
 * row 1. That still reads as a loading panel, and the whole tree is `aria-hidden`
 * decoration. A truncated decoration is fine; a lying reservation is not.
 */

import { cn } from '@/lib/utils';

interface SectionSkeletonProps {
  /**
   * Total reserved height. Accepts any CSS length (e.g. '60vh', '480px',
   * 'min(80vh, 600px)'). Defaults to a generous section height. Set this to
   * roughly match the real section so the swap-in doesn't jump — it is the box's
   * EXACT height (border-box), not a floor, so declaring too much is as wrong as
   * declaring too little.
   */
  height?: string;
  /** Number of placeholder content rows rendered inside the panel. Default 3. */
  count?: number;
  /** Extra classes on the outer wrapper (spacing overrides at mount). */
  className?: string;
  /**
   * Extra classes on the reserved CONTENT column — the `mx-auto max-w-*` box, not the
   * outer wrapper, because that column is what carries the width (the gutter padding sits
   * on the wrapper, outside the clamp, so the clamp is the true edge). Merged with `cn`,
   * so a caller's `max-w-*` replaces the 1200px default instead of stacking with it. Pass
   * the width of the island this reserves space for: a wider placeholder snaps sideways on
   * mount, which is the same lie the `height` bound above exists to prevent.
   */
  contentClassName?: string;
  /** Optional label for the shimmer bars' aria — unused visually; kept aria-hidden. */
  label?: string;
}

export default function SectionSkeleton({
  height = 'clamp(20rem, 60vh, 34rem)',
  count = 3,
  className = '',
  contentClassName,
  label = 'Loading section',
}: SectionSkeletonProps) {
  // Clamp to a sane range so a bad prop can't render 0 or a runaway list.
  const rows = Math.max(1, Math.min(count, 8));

  return (
    <div
      aria-hidden="true"
      data-loading={label}
      className={`w-full overflow-hidden ${className}`}
      // `height` alone is enough for a block box (Tailwind's preflight makes everything
      // border-box); `maxHeight` additionally pins it inside a flex/grid parent, where a
      // flex item's automatic minimum size would otherwise let content push it taller.
      //
      // The gutter/section padding deliberately sits on the INNER div, not here. A
      // border-box can never be shorter than its own padding — with `py-section`
      // (`clamp(4rem,8vw,7rem)`, so ≥128px top+bottom) on this element, a declared 61px
      // still rendered 136px. Padding inside a clipped box has no such floor, so the
      // outer box is now the declared height at ANY value, down to 0.
      style={{ height, maxHeight: height }}
    >
      <div className="px-gutter py-section">
        <div className={cn('mx-auto flex max-w-[1200px] flex-col gap-4', contentClassName)}>
          {/* The panel's own printed head: the word, plus the count of rows being
              reserved. No <h2> — the whole tree is aria-hidden, so a heading here would
              be a phantom in the outline and exposed to nobody. */}
          <div className="flex items-baseline justify-between gap-3 border-b-2 border-[hsl(var(--border))] pb-2">
            <span className="pr pr--l">Loading</span>
            <span className="pr pr--lo">
              {rows} {rows === 1 ? 'row' : 'rows'} reserved
            </span>
          </div>

          {/* The rows the section will fill, at the size they will be. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="load h-40 w-full">
                <span className="pr pr--lo">Loading</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
