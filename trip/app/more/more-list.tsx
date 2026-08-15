'use client';

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, useCallback } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { navItemsForActiveTrip, primaryItemsForActiveTrip, type NavItem } from '@/lib/nav-items';
import SignOutConfirm from '@/components/sign-out-confirm';
import { useViewTransition } from '@/hooks/use-view-transition';

/**
 * MoreList — the body of the mobile `/more/` route: the long-tail companion
 * routes the 5-tab IA can't fit, as an inset-grouped list, plus the mobile home for sign-out.
 *
 * ONE SOURCE: the ROWS are derived from the shared nav catalog
 * (`navItemsForActiveTrip() − primaryItemsForActiveTrip()` — the exact same "companions"
 * projection the desktop navbar's "More" dropdown uses), NEVER a hand-authored item
 * list. Only the GROUPING (which href sits in which section, and the section order) is
 * declared here — that is genuinely new information specifies BY HREF, not a
 * duplicate of the catalog's label/icon data. Absent hrefs are skipped; empty groups hide.
 *
 * MOUNT GATE: `navItemsForActiveTrip()` reads `isDefaultTrip()` (the gateway pointer, i.e.
 * localStorage). SSG/first-client render both resolve the default pack, so we render a stable
 * placeholder until mounted, then compute — no hydration mismatch (same pattern as
 * DefaultTripOnly / home-trip-strip). A route page is static-export-safe this way.
 *
 * Sign-out mirrors the navbar's `TravelerChip`: a `<button>` wrapped in the shared
 * `<SignOutConfirm>` ( — sign-out is now a confirm-gated full local teardown, not a bare
 * `onClick`). Desktop keeps sign-out in the TravelerChip.
 */

// Group definitions keyed by href. Labels/icons come from the catalog.
const GROUPS: { title: string; hrefs: string[] }[] = [
  { title: 'Plan & prep', hrefs: ['/flights/', '/packing/', '/checklist/', '/safety/', '/share/'] },
  { title: 'Memories', hrefs: ['/journal/', '/recap/'] },
  { title: 'Account', hrefs: ['/trips/', '/profile/', '/settings/'] },
];

export default function MoreList() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const navigate = useViewTransition();
  const vtClick = useCallback(
    (href: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }
      e.preventDefault();
      navigate(href);
    },
    [navigate],
  );

  // Companions = the active trip's catalog minus the primary seats (identical reference
  // filter to navbar's `moreItems`). Recomputed once `mounted` flips so it reflects the
  // real active trip rather than the SSG default.
  const byHref = useMemo(() => {
    void mounted; // dependency: recompute after the client mount reads the real trip pointer
    const primaries = primaryItemsForActiveTrip();
    const companions = navItemsForActiveTrip().filter((i) => !primaries.includes(i));
    return new Map<string, NavItem>(companions.map((i) => [i.href, i]));
  }, [mounted]);

  return (
    <div className="mx-auto max-w-[680px] px-4 pb-24 sm:px-6">
      {!mounted ? (
        <div aria-busy="true" className="h-40" />
      ) : (
        GROUPS.map((group) => {
          const items = group.hrefs
            .map((href) => byHref.get(href))
            .filter((i): i is NavItem => Boolean(i));
          if (items.length === 0) return null; // empty group hidden
          const isAccount = group.title === 'Account';
          const headingId = `more-group-${group.title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
          return (
            <section key={group.title} aria-labelledby={headingId} className="mb-8">
              <h2
                id={headingId}
                className="mb-2 px-1 text-eyebrow uppercase tracking-wide text-white/70"
              >
                {group.title}
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/[0.06]">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={vtClick(item.href)}
                        data-testid={`more-link-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                        className="flex min-h-[52px] items-center gap-3 px-4 text-sm text-white/85 outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
                {isAccount && (
                  <li>
                    <SignOutConfirm testId="more-sign-out">
                      <button
                        type="button"
                        data-testid="more-sign-out"
                        className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-sm text-white/85 outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <LogOut className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1">Sign out</span>
                      </button>
                    </SignOutConfirm>
                  </li>
                )}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
