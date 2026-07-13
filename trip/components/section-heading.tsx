'use client';

import type { ReactNode } from 'react';
import { Reveal } from '@/components/reveal';

/**
 * SectionHeading — the one section masthead, replacing the ~6 hand-copied
 * `font-display text-3xl sm:text-4xl…` mastheads. Renders PIXEL-EQUIVALENT to
 * those (same tag structure, classes, heading id) so adoption drifts no baseline
 * — a display-token type-scale change is left for later, not done here.
 *
 * `id` is the h2's id (the aria-labelledby target — never change it per section).
 * `title` is a ReactNode so callers keep their inline gradient span. `className`
 * carries each site's wrapper spacing (mb-8 / mb-10 / mb-12).
 */
export function SectionHeading({
  id,
  title,
  subtitle,
  eyebrow,
  align = 'center',
  className,
}: {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  const alignClass = align === 'center' ? 'text-center' : 'text-left';
  return (
    <Reveal className={className ? `${alignClass} ${className}` : alignClass}>
      {eyebrow != null && (
        <p className="text-sm font-medium uppercase tracking-wider text-gold-400 mb-2">
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3"
      >
        {title}
      </h2>
      {subtitle != null && (
        <p className="text-white/50 max-w-xl mx-auto">{subtitle}</p>
      )}
    </Reveal>
  );
}
