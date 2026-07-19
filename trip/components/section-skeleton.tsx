'use client';

/**
 * SectionSkeleton — placeholder for `dynamic()` `loading:` slots.
 *
 * Sized to RESERVE the space a not-yet-loaded section will occupy so the code-
 * split island swapping in causes no cumulative layout shift (CLS). wires
 * this into the pages' `dynamic(() => import(...), { loading: () => <SectionSkeleton.../> })`
 * calls at integration; see the for which imports get it and
 * with what heights.
 *
 * Consumes tokens only:
 * - `.animate-shimmer` for the sweep. That utility is INFINITE and is already
 * hard-neutralized (`animation:none !important`) under `prefers-reduced-motion`
 * in globals.css — so under reduced motion the bars render as static muted
 * blocks (no sweep), which is the required behavior. This
 * component adds no motion of its own.
 * - Muted surface tokens (`--muted` / `--border`) for the resting fill.
 *
 * Decorative: the whole tree is `aria-hidden="true"` (a loading placeholder has
 * no semantic content; screen readers should skip it and reach the real section
 * once it mounts).
 *
 * 0-overflow: the outer box is `w-full` and every inner bar is width-bounded, so
 * it never widens the page at 360/390/414.
 */

interface SectionSkeletonProps {
  /**
   * Total reserved height. Accepts any CSS length (e.g. '60vh', '480px',
   * 'min(80vh, 600px)'). Defaults to a generous section height. Set this to
   * roughly match the real section so the swap-in doesn't jump.
   */
  height?: string;
  /** Number of placeholder content rows rendered inside the panel. Default 3. */
  count?: number;
  /** Extra classes on the outer wrapper (spacing overrides at mount). */
  className?: string;
  /** Optional label for the shimmer bars' aria — unused visually; kept aria-hidden. */
  label?: string;
}

/**
 * The moving-gradient background the `.animate-shimmer` keyframe sweeps. Sized
 * 200% so `background-position-x: -200%` (the keyframe end) travels a full pass.
 * Built from muted/foreground tokens so it reads on the dark field but stays
 * quiet. Under reduced motion the sweep is off (static gradient — still a valid
 * muted block).
 */
const SHIMMER_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, hsl(var(--muted)) 0%, hsl(var(--secondary)) 20%, hsl(var(--muted)) 40%, hsl(var(--muted)) 100%)',
  backgroundSize: '200% 100%',
};

export default function SectionSkeleton({
  height = 'clamp(20rem, 60vh, 34rem)',
  count = 3,
  className = '',
  label = 'Loading section',
}: SectionSkeletonProps) {
  // Clamp to a sane range so a bad prop can't render 0 or a runaway list.
  const rows = Math.max(1, Math.min(count, 8));

  return (
    <div
      aria-hidden="true"
      data-loading={label}
      className={`w-full px-gutter py-section ${className}`}
      style={{ minHeight: height }}
    >
      <div className="glass-subtle mx-auto flex max-w-[1200px] flex-col gap-6 rounded-3xl p-6 sm:p-10">
        {/* Eyebrow + title placeholders (matches the section header rhythm). */}
        <div className="flex flex-col items-center gap-3">
          <span
            className="animate-shimmer h-3 w-24 rounded-full"
            style={SHIMMER_STYLE}
          />
          <span
            className="animate-shimmer h-8 w-64 max-w-[80%] rounded-lg"
            style={SHIMMER_STYLE}
          />
        </div>

        {/* Content-row placeholders. */}
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="animate-shimmer h-40 w-full rounded-2xl"
              style={SHIMMER_STYLE}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
