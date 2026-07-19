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
  Settings,
  type LucideIcon,
} from 'lucide-react';

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
};

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Plan', href: '/plan/', icon: Calendar },
  { label: 'Flights', href: '/flights/', icon: Plane },
  { label: 'Nepal', href: '/nepal/', icon: Mountain },
  { label: 'Japan', href: '/japan/', icon: Compass },
  { label: 'Map', href: '/map/', icon: Map },
  { label: 'Journal', href: '/journal/', icon: BookOpen, primary: false },
  { label: 'Safety', href: '/safety/', icon: ShieldCheck, primary: false },
  { label: 'Recap', href: '/recap/', icon: Scroll, primary: false },
  { label: 'Settings', href: '/settings/', icon: Settings, primary: false }, // — companion (hamburger + palette)
];

/** The 6 daily-use items for the width/slot-constrained surfaces (tab bar, desktop top row). */
export const PRIMARY_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.primary !== false);

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
