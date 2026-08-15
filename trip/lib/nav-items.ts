import {
  Home,
  Calendar,
  Map,
  Plane,
  BookOpen,
  BookMarked,
  ShieldCheck,
  Scroll,
  Luggage,
  Settings,
  Backpack,
  FileCheck2,
  Inbox,
  User,
  type LucideIcon,
} from 'lucide-react';
import { isDefaultTrip } from '@/core/trips';

/**
 * Single source of truth for the route-driven nav items, shared by the desktop
 * `navbar.tsx` and the mobile `bottom-tab-bar.tsx` ( closing — the two
 * components previously each carried a byte-identical local copy of this array + the
 * route-match helpers below).
 *
 * the nav is ROUTE-driven, trailing-slash canonical hrefs
 * (`trailingSlash:true`). next/link handles basePath; active state comes from
 * usePathname() (which EXCLUDES basePath), so the whole nav is basePath-agnostic.
 *
 * Flights added as a sixth route-driven item (moved off Home onto its own
 * `/flights/` page) — measured to still clear the ≥44px mobile touch-target floor
 * at a 360px viewport, so it stays in the shared bottom-tab-bar too.
 *
 * `/journal`, `/safety`, `/recap` were shipped with their nav
 * wiring deliberately deferred. Adding them to NAV_ITEMS naively would push the mobile
 * tab bar past the ≥44px floor. So NAV_ITEMS stays the full companion catalog (consumed by
 * the width-agnostic surfaces: the `/more/` page + the command palette), while the
 * "primary" (daily-use) items are re-exported as `PRIMARY_NAV_ITEMS` for the two
 * width/slot-constrained surfaces (the bottom tab bar and the desktop top row).
 *
 * the mobile IA is now 5 tabs —
 * Today · Plan · Map · Guides · More. `Home` relabels to `Today`; `Nepal`/`Japan` leave
 * NAV_ITEMS and a
 * single `Guides` primary takes their place; `Flights` drops to a companion; `Documents`
 * (`/checklist/`) and `Shared Links` (`/share/`), previously palette-only, join as
 * companions. `PRIMARY_NAV_ITEMS` now yields FOUR primaries (Today · Plan · Map · Guides),
 * consumed by BOTH the desktop top row AND the mobile tab bar (which appends one synthetic
 * `More → /more/` tab → 5). The `/more/` page renders `navItems − primary`.
 */
export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Absent/true = a primary item (tab bar + desktop top row). false = companion-only
   * (the `/more/` page + command palette), see / above. */
  primary?: boolean;
  /** (Plan D10): N×J-specific — hidden on every nav surface on a CUSTOM trip. */
  defaultTripOnly?: true;
  /**: on a CUSTOM trip this companion is promoted into the primary
   * set (tab bar + desktop top row) to fill the seat vacated by the defaultTripOnly
   * `Guides`. Ignored on the default trip (already full). Now only `Journal` carries it —
   * Packing/Trips fell to the `/more/` page. */
  customPrimary?: true;
};

export const NAV_ITEMS: NavItem[] = [
  { label: 'Today', href: '/', icon: Home },
  { label: 'Plan', href: '/plan/', icon: Calendar },
  { label: 'Map', href: '/map/', icon: Map },
  { label: 'Guides', href: '/guides/', icon: BookMarked, defaultTripOnly: true }, // — fronts Nepal/Japan
  { label: 'Flights', href: '/flights/', icon: Plane, primary: false, defaultTripOnly: true },
  { label: 'Journal', href: '/journal/', icon: BookOpen, primary: false, customPrimary: true },
  { label: 'Safety', href: '/safety/', icon: ShieldCheck, primary: false },
  { label: 'Recap', href: '/recap/', icon: Scroll, primary: false },
  { label: 'Packing', href: '/packing/', icon: Backpack, primary: false }, // →: no longer customPrimary
  { label: 'Documents', href: '/checklist/', icon: FileCheck2, primary: false }, // — was palette-only
  { label: 'Shared Links', href: '/share/', icon: Inbox, primary: false }, // — was palette-only
  { label: 'Trips', href: '/trips/', icon: Luggage, primary: false }, // →: no longer customPrimary
  // Issue #4 — the lifetime travel record. A companion, never a primary: it is a
  // write-once-in-a-while surface, and the four daily-use seats are spoken for.
  { label: 'Profile', href: '/profile/', icon: User, primary: false },
  { label: 'Settings', href: '/settings/', icon: Settings, primary: false }, // — companion (More page + palette)
];

/** The daily-use primaries for the width/slot-constrained surfaces (tab bar, desktop top row)
 * ON THE DEFAULT TRIP.: Today · Plan · Map · Guides (4). */
export const PRIMARY_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.primary !== false);

/**
 * (Plan D10) — the full nav catalog for the ACTIVE trip: on the default pack this is
 * `NAV_ITEMS` verbatim; on a custom trip the N×J-specific `defaultTripOnly` items (Flights/
 * Nepal/Japan) are dropped. Pure — reads `isDefaultTrip()` (the gateway pointer), never
 * `window`/localStorage directly. Callers must sit behind their own mount/hydration gate
 * (SSR always resolves the default pack — see `core/trips/index.ts`).
 */
export function navItemsForActiveTrip(): NavItem[] {
  return isDefaultTrip() ? NAV_ITEMS : NAV_ITEMS.filter((item) => !item.defaultTripOnly);
}

/**
 * — the primary tab-bar/desktop-row set for the ACTIVE trip. Default
 * pack: `PRIMARY_NAV_ITEMS` verbatim (Today · Plan · Map · Guides). Custom trip: the
 * `defaultTripOnly` `Guides` seat is dropped and refilled by the one `customPrimary`
 * companion (Journal), in NAV_ITEMS declaration order — Today · Plan · Map · Journal (4).
 * The FORMULA is unchanged from; only the flag DATA above changed what it yields.
 */
export function primaryItemsForActiveTrip(): NavItem[] {
  if (isDefaultTrip()) return PRIMARY_NAV_ITEMS;
  const base = NAV_ITEMS.filter((item) => item.primary !== false && !item.defaultTripOnly);
  const promoted = NAV_ITEMS.filter((item) => item.customPrimary);
  return [...base, ...promoted];
}

// Trailing-slash-agnostic pathname compare ('' and '/' both mean Home).
function normalizePath(p: string | null): string {
  const stripped = (p ?? '/').replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
}

// Active when the pathname IS the route or sits below it.
// Home is exact-match only, otherwise it would claim every route.
export function isRouteActive(pathname: string | null, href: string): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(href);
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}
