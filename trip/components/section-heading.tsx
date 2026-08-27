'use client';

import type { ReactNode } from 'react';
import { Reveal } from '@/components/reveal';

/**
 * SectionHeading — the one section masthead, replacing the ~6 hand-copied
 * `font-display text-3xl sm:text-4xl…` mastheads.
 *
 * THE TAG STRUCTURE AND THE IDS ARE FIXED; ONLY THE TYPE MOVED. The h2 is now tracked
 * mono at --t-label instead of a 3xl/4xl serif, because in an instrument the loudest
 * object on a screen is a value and not a title.
 *
 * THE `<Reveal>` WRAPPER STAYS. It looks like an entrance this direction deletes, but it
 * is load-bearing structure: `e2e/reveal.spec.ts` resolves `#nepal-heading` and
 * `#photography-heading` through `ancestor::div[@data-scroll-driven]`, which is this
 * wrapper. It is already ledger-gated to once per session and already lands
 * reduced-motion users at rest. Removing it is a route-level sweep, not a primitive edit.
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
      {eyebrow != null && <p className="pr pr--lo mb-2">{eyebrow}</p>}
      {/* THE DISPLAY TITLE STOPS CARRYING THE SCREEN. In an instrument the loudest
          object is a VALUE, so the section masthead drops to tracked mono at --t-label
          and the weight moves to the numbers underneath it. The heading id and the tag
          are untouched — this is a type change, not an IA one. */}
      <h2 id={id} className="pr pr--l mb-3 text-[color:var(--text-hi)]">
        {title}
      </h2>
      {subtitle != null && (
        <p
          className={`max-w-xl text-t-body text-[color:var(--text-mid)] ${align === 'center' ? 'mx-auto' : ''}`}
        >
          {subtitle}
        </p>
      )}
    </Reveal>
  );
}
