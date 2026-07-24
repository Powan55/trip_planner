import {
  Home,
  Calendar,
  Mountain,
  Compass,
  Map,
  Plane,
  BookOpen,
  ShieldCheck,
  Scroll,
  Luggage,
  Settings,
  Backpack,
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
 * S113D: Flights added as a sixth route-driven item (moved off Home onto its own
 * `/flights/` page) — measured to still clear the ≥44px mobile touch-target floor
 * at a 360px viewport, so it stays in the shared bottom-tab-bar too.
 *
 * `/journal`, `/safety`, `/recap` were shipped with their nav
 * wiring deliberately deferred. Adding them to NAV_ITEMS naively would push the mobile
 * tab bar to 9 tabs — at a 360px viewport that's ≈40px each, BELOW the ≥44px floor
 * So NAV_ITEMS stays the full 9-item catalog (consumed by the constrained-
 * width-agnostic surfaces: the mobile hamburger panel + the command palette), while the
 * 6 "primary" (daily-use) items are re-exported as `PRIMARY_NAV_ITEMS` for the two
 * width/slot-constrained surfaces (the bottom tab bar and the desktop top row).
 */
export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Absent/true = a primary item (tab bar + desktop top row). false = companion-only
   * (mobile hamburger panel + command palette), see above. */
  primary?: boolean;
  /** (Plan D10): N×J-specific — hidden on every nav surface on a CUSTOM trip. */
  defaultTripOnly?: true;
  /**: on a CUSTOM trip this companion is promoted into the 6-slot primary
   * set (tab bar + desktop top row) to fill the seats vacated by the defaultTripOnly
   * items. Ignored on the default trip (unused there — it already fills all 6 seats). */
  customPrimary?: true;
};

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Plan', href: '/plan/', icon: Calendar },
  { label: 'Flights', href: '/flights/', icon: Plane, defaultTripOnly: true },
  { label: 'Nepal', href: '/nepal/', icon: Mountain, defaultTripOnly: true },
  { label: 'Japan', href: '/japan/', icon: Compass, defaultTripOnly: true },
  { label: 'Map', href: '/map/', icon: Map },
  { label: 'Journal', href: '/journal/', icon: BookOpen, primary: false, customPrimary: true },
  { label: 'Safety', href: '/safety/', icon: ShieldCheck, primary: false },
  { label: 'Recap', href: '/recap/', icon: Scroll, primary: false },
  { label: 'Packing', href: '/packing/', icon: Backpack, primary: false, customPrimary: true }, //
  { label: 'Trips', href: '/trips/', icon: Luggage, primary: false, customPrimary: true }, //
  { label: 'Settings', href: '/settings/', icon: Settings, primary: false }, // — companion (hamburger + palette)
];

/** The 6 daily-use items for the width/slot-constrained surfaces (tab bar, desktop top row)
 * ON THE DEFAULT TRIP. Byte-identical to pre-. */
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
 * — the primary tab-bar/desktop-row set for the ACTIVE
 * trip. Default pack: `PRIMARY_NAV_ITEMS` verbatim (6 items, unchanged). Custom trip: the 3
 * `defaultTripOnly` seats (Flights/Nepal/Japan) are dropped and refilled by the 3
 * `customPrimary` companions (Journal/Packing/Trips), in NAV_ITEMS declaration order —
 * Home, Plan, Map, Journal, Packing, Trips. Still exactly 6.
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
