'use client';

import { Users } from 'lucide-react';
import type { DayPlan } from '@/lib/trip-data';
import {
  type AuthorFilter,
  distinctAuthors,
} from '@/lib/author-filter';
import { useAuthorFilter } from '@/hooks/use-author-filter';

/**
 * Author filter control — a presentational, READ-ONLY view filter that
 * narrows the calendar's item list (and the rest of its day chrome — count pill, From pill,
 * clash badges, month dots, span bands, day map) to All / "My edits" / a specific traveler,
 * using the existing `createdBy` / `updatedBy` attribution. It NEVER mutates
 * stored data: selecting an option only updates the shared in-memory selection
 * (lib/author-filter), which every consumer reads.
 *
 * DORMANT / NO-ATTRIBUTION (the portfolio case): when NO item carries attribution,
 * `distinctAuthors` is empty and this control renders NOTHING — so the portfolio build is
 * visually unchanged. It also renders nothing if the only options would be "All" with no
 * real authors to pick.
 *
 * A11y: a labeled segmented control — a `<div role="group">` with an
 * accessible name, options as `<button aria-pressed>` with visible `focus-visible` rings,
 * fully keyboard-operable (native button semantics: Tab to reach, Enter/Space to pick).
 * No motion (no `m.*`, no rAF) — only static Tailwind color transitions, which the global
 * `prefers-reduced-motion` rule already neutralizes.
 *
 * Static Tailwind literals only; dark-only.
 *
 * Testids: `author-filter` on the row, `author-filter-all`,
 * `author-filter-mine`, `author-filter-author-<name>` on the chips.
 * `<name>` is the raw display name, so a name with a space yields e.g.
 * `author-filter-author-Jane Doe` — quote it in a selector.
 *
 * 🔴 S383 made this control render ONCE per page. It used to be mounted by BOTH
 * `calendar-planner.tsx` and `trip-timeline.tsx`, which since both render on `/plan` — so the
 * identical chip row appeared twice. (#94 has since deleted `trip-timeline.tsx` entirely, so
 * `calendar-planner.tsx` is the ONLY mount site now.) Do not re-mount it elsewhere without
 * checking what else is on that route.
 */
export default function AuthorFilterControl({
  plans,
  className = '',
}: {
  plans: DayPlan[];
  className?: string;
}) {
  const { filter, setFilter, myName, myPriorNames } = useAuthorFilter();

  //-C: prior names collapse into the current one, so a user who renamed gets ONE chip.
  const authors = distinctAuthors(plans, myName, myPriorNames);

  // Dormant / no-attribution: nothing to filter by → render nothing (portfolio unchanged).
  if (authors.length === 0) return null;

  // "My edits" is offered only when a display name is set AND that name actually appears
  // as an author in the data (otherwise it would always be empty / confusing).
  const showMine = !!myName && authors.includes(myName);

  // Build the option list: All, then (My edits), then each distinct author. "My edits" is
  // surfaced separately from the same-named per-author chip — selecting either filters to
  // the same items, but "My edits" tracks the live name, so we hide the redundant
  // per-author chip for the current user when "My edits" is shown.
  const authorOptions = showMine ? authors.filter((n) => n !== myName) : authors;

  const isActive = (candidate: AuthorFilter): boolean => {
    if (candidate.kind !== filter.kind) return false;
    if (candidate.kind === 'author' && filter.kind === 'author') {
      return candidate.name === filter.name;
    }
    return true;
  };

  // Shared chip classes — static literals, the shared `.chip` recipe. The selected option is
  // STRUCK (a full-strength border + hi ink), the rest are ordinary printed chips; `aria-pressed`
  // carries the state for anyone the material does not reach.
  // `transition-colors` is neutralized under reduced motion.
  const chip = (active: boolean) =>
    `chip min-h-tap px-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
      active ? 'chip--struck' : 'hover:bg-white/5 hover:text-ink-hi'
    }`;

  return (
    <div
      data-testid="author-filter"
      className={`flex flex-wrap items-center justify-center gap-2 ${className}`}
    >
      <span className="pr pr--lo inline-flex items-center gap-1.5 mr-0.5">
        <Users className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Filter by</span>
      </span>
      <div
        role="group"
        aria-label="Filter itinerary items by author"
        className="flex flex-wrap items-center justify-center gap-1.5"
      >
        {/* All — always present, the inert default. */}
        <button
          type="button"
          onClick={() => setFilter({ kind: 'all' })}
          aria-pressed={isActive({ kind: 'all' })}
          data-testid="author-filter-all"
          className={chip(isActive({ kind: 'all' }))}
        >
          All
        </button>

        {/* My edits — only when a display name is set and present in the data. */}
        {showMine && (
          <button
            type="button"
            onClick={() => setFilter({ kind: 'mine' })}
            aria-pressed={isActive({ kind: 'mine' })}
            aria-label={`My edits (${myName})`}
            data-testid="author-filter-mine"
            className={chip(isActive({ kind: 'mine' }))}
          >
            My edits
          </button>
        )}

        {/* One chip per distinct author present in the itinerary. */}
        {authorOptions.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setFilter({ kind: 'author', name })}
            aria-pressed={isActive({ kind: 'author', name })}
            aria-label={`Edits by ${name}`}
            data-testid={`author-filter-author-${name}`}
            className={chip(isActive({ kind: 'author', name }))}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
