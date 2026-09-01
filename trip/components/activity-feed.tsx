'use client';

import { useMemo } from 'react';
import { History } from 'lucide-react';
import { type ItineraryCategory, formatDate } from '@/lib/trip-data';
import { useItineraryContext } from '@/components/itinerary-provider';
import { formatRelativeTime } from '@/lib/relative-time';

/**
 * Recent-changes activity feed.
 *
 * A presentational, READ-ONLY "who changed what, recently" list, DERIVED FOR FREE
 * from the attribution already on every item — `updatedBy` + `updatedAt`
 * It performs NO writes: no `plans`/localStorage mutation, no store
 * mutator, no firebase write, no append-log — it only reads the shared reactive store
 * and renders. This keeps it firmly within the Spark free tier (zero extra reads/writes,
 *) because it reads data the app already has.
 *
 * LIVE: it reads `plans` via `useItineraryContext()`, the one shared store that
 * re-reads on the same-tab `itinerary:changed` CustomEvent. So a same-tab edit (or a
 * remote snapshot fanned in through the same event,) re-renders the feed with no
 * reload — newer edits float to the top.
 *
 * DORMANT / NO-ATTRIBUTION (the portfolio case): when NO item carries
 * `updatedBy && updatedAt`, the derived list is empty and this renders NOTHING — exactly
 * like author filter and per-item attribution line. The portfolio build is
 * visually unchanged.
 *
 * A11y: a labeled region (`<section aria-labelledby>`) with a real
 * heading and an ordered `<ol>` (the list IS ordered, newest-first). No motion at all: the
 * feed is present when you arrive, so there is nothing for reduced motion to switch off.
 *
 * Static Tailwind literals only; dark-only; `min-w-0`/`truncate` so long
 * names/titles never overflow at narrow widths.
 */

/** How many recent edits to surface (newest first). Chosen from the 6–8 range. */
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
    <div className={className}>
      <section
        aria-labelledby="activity-feed-heading"
        className="mx-auto max-w-2xl border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]"
      >
        <h3
          id="activity-feed-heading"
          className="pr pr--l inline-flex items-center gap-2 border-b-2 border-[color:hsl(var(--border))] px-gut py-2 text-ink-hi"
        >
          <History className="w-3.5 h-3.5" aria-hidden="true" />
          Recent changes
        </h3>

        <ol className="list list-none">
          {entries.map((entry) => {
            const relative = formatRelativeTime(entry.updatedAt);
            return (
              <li key={entry.id} className="r [--lead:13px] !items-center text-left">
                {/* The struck mark — a filed edit is a committed fact. Category ink, decorative. */}
                <span className="mk mk--struck" aria-hidden="true" />
                <div className="min-w-0">
                  {/* "{author} edited {title}" — author and title both truncate so a long
                      name or title can never overflow the row. */}
                  <p className="truncate text-t-body leading-snug text-ink-hi">
                    <span className="font-semibold">{entry.author}</span>
                    <span className="text-ink-mid"> edited </span>
                    <span>{entry.title}</span>
                  </p>
                  <p className="mt">
                    {entry.dateLabel}
                    {relative ? <span> · {relative}</span> : null}
                  </p>
                </div>
                <span className="chip capitalize">{entry.category}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
