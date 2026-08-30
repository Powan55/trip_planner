'use client';

import { useId } from 'react';

/**
 * — a decorative SVG radial progress ring WRAPPING the existing "total days" countdown
 * digit (`hero-section.tsx`). Purely presentational: `fraction` is computed by the caller
 * via the pure `ringFraction()` (`lib/countdown-ring.ts`) from the SAME `computeCountdown`
 * result already driving the digit grid — the ring can never desync from the live tick.
 * `children` (the existing `<CountUpNumber/>` markup) render untouched, centered inside.
 *
 * Reduced motion: the ring value itself still updates live every second
 * (it is a correctness-adjacent visual, same as the digits) but the stroke-dashoffset
 * change is CSS-transitioned only when motion is allowed — under `prefersReducedMotion`
 * the ring jumps straight to the current value every tick with no sweep animation.
 */
export default function CountdownRing({
  fraction,
  size = 128,
  strokeWidth = 6,
  reducedMotion,
  children,
}: {
  /** 0..1 progress fraction (see `ringFraction`). Clamped defensively here too. */
  fraction: number;
  size?: number;
  strokeWidth?: number;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const gradientId = useId();
  const clamped = Math.max(0, Math.min(1, fraction));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - clamped);

  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      data-testid="countdown-ring"
      data-fraction={clamped.toFixed(3)}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          {/* these two stops used to be hand-picked hexes (#f4c46b/#f48fb1) that
              belong to NO scale — near-misses for gold-400/sakura-400, invisible to every
              class-name and scale-hex grep, and by a warm ring against cyan chrome on the
              app's centrepiece. Both now key off `--accent-scroll`, the SAME var the countdown's
              own pulse-glow uses (globals.css `@keyframes pulse-glow`), so ring and glow cannot
              disagree and the warm/cool engine drives both together. The sweep is carried by
              alpha, not by a second colour — one token, no invented hue. */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--accent-scroll) / 0.45)" />
            <stop offset="100%" stopColor="hsl(var(--accent-scroll))" />
          </linearGradient>
        </defs>
        {/* Track — the UNFILLED remainder, so it takes the hollow mark's own token rather
            than a white wash that drifts with nothing. Geometry is unchanged. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-ui)"
          strokeOpacity={0.45}
          strokeWidth={strokeWidth}
        />
        {/* Progress — CSS-driven transition, skipped entirely under reduced motion so the
            ring never sweeps, only snaps to the live value. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          style={reducedMotion ? undefined : { transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
