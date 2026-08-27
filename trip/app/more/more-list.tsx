'use client';

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, useCallback } from 'react';
import Link from 'next/link';
import { LogOut, Search } from 'lucide-react';
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
 *
 * Search mirrors navbar.tsx's "More" dropdown Search row (#281): a plain `<button>`,
 * not catalog-driven (the palette isn't a route), dispatching the same `palette:open`
 * window CustomEvent that `components/command-palette.tsx` listens for. Rendered
 * unconditionally (no mount gate) since it carries no trip-dependent data.
 *
 * THIS IS THE INDEX. It is the second tap of the "any tab -> INDEX (1) -> surface (2)"
 * claim, so every one of the 19 surfaces is reachable from here and the IA cost of the
 * five-tab bar is zero. Rows take `.list`, group heads take `.sec` with their own count,
 * and the catalog itself is READ, never re-authored — `lib/nav-items.ts` remains the one
 * source and `lib/__tests__/nav-items.test.ts` pins it down to the label list.
 */

// Group definitions keyed by href. Labels/icons come from the catalog.
// Exported so a test can assert every companion NAV_ITEM lands in exactly one group
// (see lib/__tests__/nav-items-more-coverage.test.ts) — this file is the only mobile
// path to a companion route, so a miss here is silent (#211).
export const GROUPS: { title: string; hrefs: string[] }[] = [
  { title: 'Plan & prep', hrefs: ['/flights/', '/packing/', '/checklist/', '/safety/', '/share/'] },
  { title: 'Memories', hrefs: ['/journal/', '/recap/', '/passport/'] },
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

  // The row: an icon in the recipe's leading column, the label, the route as printed meta.
  // KNOWN CEILING: the two `!` utilities are not decoration — `.list .r` is a 0,2,0
  // selector and a bare utility is 0,1,0, so it cannot reach the 58px timestamp track an
  // icon does not need. Every single-class recipe (`.cell`, `.chip`, `.btn`) composes with
  // plain utilities; only the descendant ones need this.
  const ROW =
    'r grid w-full [--lead:22px] !items-center text-left outline-none';

  return (
    <div className="mx-auto max-w-[680px] pb-24">
      <section aria-labelledby="more-group-search" className="mb-7">
        <div className="sec px-gut pt-2">
          <h2 id="more-group-search">Search</h2>
          <span className="sub">Every surface</span>
        </div>
        <ul className="list border-t-2 border-[hsl(var(--border))]">
          <li>
            <button
              type="button"
              data-testid="more-search"
              onClick={() => window.dispatchEvent(new CustomEvent('palette:open'))}
              className={ROW}
            >
              <Search className="h-[18px] w-[18px] shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
              <h3>Search</h3>
              <span className="chip">⌘K</span>
            </button>
          </li>
        </ul>
      </section>
      {!mounted ? (
        // The SHAPE arrives before the data, and the word is a real text node: a bare grey
        // block is indistinguishable from an empty one and is not announced.
        <div aria-busy="true" className="load pr pr--lo mx-gut h-40">
          Loading
        </div>
      ) : (
        GROUPS.map((group) => {
          const items = group.hrefs
            .map((href) => byHref.get(href))
            .filter((i): i is NavItem => Boolean(i));
          if (items.length === 0) return null; // empty group hidden
          const isAccount = group.title === 'Account';
          const headingId = `more-group-${group.title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
          const count = items.length + (isAccount ? 1 : 0);
          return (
            <section key={group.title} aria-labelledby={headingId} className="mb-7">
              <div className="sec px-gut">
                <h2 id={headingId}>{group.title}</h2>
                <span className="sub">
                  {count} {count === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              <ul className="list border-t-2 border-[hsl(var(--border))]">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={vtClick(item.href)}
                        data-testid={`more-link-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                        className={ROW}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
                        <h3>{item.label}</h3>
                        <span className="mt">{item.href.replace(/\//g, '') || 'home'}</span>
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
                        className={ROW}
                      >
                        <LogOut className="h-[18px] w-[18px] shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
                        <h3>Sign out</h3>
                        <span className="mt">Ends session</span>
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
