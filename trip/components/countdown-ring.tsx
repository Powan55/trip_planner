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
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f4c46b" />
            <stop offset="100%" stopColor="#f48fb1" />
          </linearGradient>
        </defs>
        {}/* Track */
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={strokeWidth}
        />
        {/* Progress — CSS-driven transition, skipped entirely under reduced motion so the
}            ring never sweeps, only snaps to the live value. */
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
