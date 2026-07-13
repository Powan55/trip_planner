'use client';

import { useMemo } from 'react';
import { History } from 'lucide-react';
import { CATEGORY_COLORS, type ItineraryCategory, formatDate } from '@/lib/trip-data';
import { useItineraryContext } from '@/components/itinerary-provider';
import { formatRelativeTime } from '@/lib/relative-time';
import { FadeIn } from '@/components/ui/animate';

/**
 * Recent-changes activity feed.
 *
 * A presentational, READ-ONLY "who changed what, recently" list, derived for free
 * from the attribution already on every item — `updatedBy` + `updatedAt`. It performs
 * NO writes: no `plans`/localStorage mutation, no store mutator, no remote write, no
 * append-log — it only reads the shared reactive store and renders. This keeps writes
 * and reads to a minimum since it reads data the app already has.
 *
 * LIVE: it reads `plans` via `useItineraryContext()`, the one shared store that
 * re-reads on the same-tab `itinerary:changed` CustomEvent. So a same-tab edit (or a
 * remote snapshot fanned in through the same event) re-renders the feed with no
 * reload — newer edits float to the top.
 *
 * DORMANT / NO-ATTRIBUTION (the portfolio case): when NO item carries
 * `updatedBy && updatedAt`, the derived list is empty and this renders NOTHING — exactly
 * like the author filter and the per-item attribution line elsewhere in the app. The
 * portfolio build is visually unchanged.
 *
 * A11y: a labeled region (`<section aria-labelledby>`) with a real heading and an
 * ordered `<ol>` (the list IS ordered, newest-first). The only motion is one
 * declarative `FadeIn` reveal (the shared motion primitive), which
 * `<MotionConfig reducedMotion="user">` auto-neutralizes under prefers-reduced-motion —
 * no scroll-linked transform, no rAF, nothing that needs a manual guard.
 *
 * Static Tailwind literals only; dark-only; `min-w-0`/`truncate` so long
 * names/titles never overflow at narrow widths.
 */

/** How many recent edits to surface (newest first). Brief: N = 6–8. */
const FEED_LIMIT = 8;

interface ActivityEntry {
  /** Stable key: the item id is unique per placement across the whole itinerary. */
  id: string;
  title: string;
  category: ItineraryCategory;
  /** Last editor (guaranteed present — we only collect attributed items). */
  author: string;
  /** ISO timestamp of the last edit (guaranteed present). */
  updatedAt: string;
  /** Human date of the day this item belongs to (its DayPlan date). */
  dateLabel: string;
}

export default function ActivityFeed({ className = '' }: { className?: string }) {
  // Read the shared reactive store so the feed updates live on same-tab edits.
  // READ-ONLY: we never call a mutator — `plans` is only consumed here.
  const { plans } = useItineraryContext();

  // Derive the feed: every attributed item across all days, sorted by `updatedAt` DESC,
  // capped at FEED_LIMIT. Pure derivation from props/store — no storage, no DOM.
  const entries = useMemo<ActivityEntry[]>(() => {
    const collected: ActivityEntry[] = [];
    for (const plan of plans) {
      for (const item of plan.items ?? []) {
        // Only items that carry BOTH a last-editor and a timestamp qualify (an entry
        // needs an author AND a sortable/relative time). Dormant items (no attribution)
        // are skipped, which is what makes the no-attribution feed empty → render null.
        if (item.updatedBy && item.updatedAt) {
          collected.push({
            id: item.id,
            title: item.title,
            category: item.category,
            author: item.updatedBy,
            updatedAt: item.updatedAt,
            dateLabel: formatDate(plan.date),
          });
        }
      }
    }
    // Newest first. Compare ISO strings via Date for correctness across formats; ISO-8601
    // also sorts lexically, but parsing is explicit and equally cheap at this size.
    collected.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return collected.slice(0, FEED_LIMIT);
  }, [plans]);

  // Dormant / no-attribution: nothing to show → render nothing (portfolio unchanged).
  if (entries.length === 0) return null;

  return (
    <FadeIn className={className}>
      <section
        aria-labelledby="activity-feed-heading"
        className="max-w-2xl mx-auto glass-card rounded-2xl px-5 py-4"
      >
        <h3
          id="activity-feed-heading"
          className="inline-flex items-center gap-2 text-sm font-semibold text-white/80 mb-3"
        >
          <History className="w-4 h-4 text-gold-400" aria-hidden="true" />
          Recent changes
        </h3>

        <ol className="space-y-2.5">
          {entries.map((entry) => {
            const colors = CATEGORY_COLORS[entry.category];
            const relative = formatRelativeTime(entry.updatedAt);
            return (
              <li key={entry.id} className="flex items-start gap-2.5 text-left">
                {/* Small category cue (cheap — reuses the shared color map). Decorative. */}
                <span
                  className={`shrink-0 mt-1 w-2 h-2 rounded-full ${colors.bg} ring-1 ${colors.border}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  {/* "{author} edited {title}" — author and title both truncate so a long
                      name or title can never overflow the row. */}
                  <p className="text-sm text-white/80 leading-snug truncate">
                    <span className="font-medium text-white">{entry.author}</span>
                    <span className="text-white/50"> edited </span>
                    <span className="text-white/90">{entry.title}</span>
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {entry.dateLabel}
                    {relative ? <span> · {relative}</span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </FadeIn>
  );
}
