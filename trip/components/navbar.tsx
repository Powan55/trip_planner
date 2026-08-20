'use client';

import { useState, useEffect, useMemo, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useViewTransition } from '@/hooks/use-view-transition';
import { usePathname } from 'next/navigation';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { MapPin, LogOut, Compass, ChevronDown, Search } from 'lucide-react';
import ScrollProgress from '@/components/scroll-progress';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import SignOutConfirm from '@/components/sign-out-confirm';
import { navItemsForActiveTrip, primaryItemsForActiveTrip, isRouteActive } from '@/lib/nav-items';
import { isTravelRoute } from '@/lib/travel-route';
import { useEnterTravelMode } from '@/hooks/use-travel-mode';
import { isDefaultTrip } from '@/core/trips';
import { isConciergeAllowedForActiveTrip } from '@/lib/concierge-config';
import { listKnownTrips } from '@/core/trips/registry';
import { getActiveTripId } from '@/core/storage/gateway';

// the AI concierge trigger + panel. A separate chunk (Radix Dialog + the chat hook), lazy
// client-only — it self-gates to `null` (dormant/guest) so most builds/sessions never even
// render its DOM, but the dynamic() split also keeps that chunk out of Navbar's own bundle.
const ConciergeChat = dynamic(() => import('@/components/concierge-chat'), { ssr: false });

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  // route-driven active state. usePathname() excludes basePath.
  const pathname = usePathname();
  // Reactive identity: the chip reflects sign-in / sign-out LIVE via identity:changed.
  const { traveler } = useActiveTraveler();

  // Navbar is `dynamic(ssr:false)` (see app/chrome-islands.tsx) — it
  // never renders server-side, so there is no SSR/CSR mismatch to gate against here (unlike
  // SSG'd routes). The active-trip pointer only changes via a full reload, so
  // it's stable for the component's lifetime — computed once.
  const primaryItems = useMemo(() => primaryItemsForActiveTrip(), []);
  const navItems = useMemo(() => navItemsForActiveTrip(), []);
  // the desktop "More" disclosure lists whatever companions this trip's
  // navItems carries that AREN'T already one of the 6 primary seats — sourced
  // from navItemsForActiveTrip, so a custom trip's promoted companions
  // show correctly here too.
  const moreItems = useMemo(
    () => navItems.filter((item) => !primaryItems.includes(item)),
    [navItems, primaryItems],
  );
  const brand = useMemo(() => {
    if (isDefaultTrip()) return null; // null = default brand, unchanged below
    const active = getActiveTripId();
    return listKnownTrips().find((t) => t.id === active)?.name ?? 'My trip';
  }, []);
  // The concierge speaks a hardcoded N×J boys-trip persona (Worker
  // SYSTEM_PROMPT), so it only belongs on the default pack. Same source + mount-safe
  // once-computed pattern as `brand`/`primaryItems` above (Navbar is ssr:false → no
  // hydration mismatch).
  // the trip-aware Worker prompt now EXISTS but is not deployed, so the rule moved
  // behind `CONCIERGE_ON_CUSTOM_TRIPS` in lib/concierge-config.ts — one constant the owner flips
  // after `npm run deploy`, read here and in components/travel-concierge.tsx through this one
  // helper so the two mounts cannot disagree.
  const conciergeAllowed = useMemo(() => isConciergeAllowedForActiveTrip(), []);

  // Reduced-motion-aware panel motion for the desktop "More" dropdown.
  // <MotionConfig reducedMotion="user"> neutralizes animated TRANSITIONS under
  // reduce, but a declared `initial={{ y:-20 }}` still paints one transform frame
  // before snapping. So under reduce we drop the `y` offset entirely → the panel is
  // OPACITY-ONLY (no transform-based motion at any frame). `prefersReducedMotion` is
  // null during SSR/first paint (treated as "no preference"); the panel only renders
  // after the user opens the dropdown.
  const prefersReducedMotion = useReducedMotion();
  const panelInitial = prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 };
  const panelAnimate = prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 };
  const panelExit = prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 };

  // — the desktop-only "More" disclosure. Hand-rolled (Plan D9: no new
  // dependency): trigger + aria-expanded/aria-controls, outside-click + Escape
  // close, focus return to the trigger. No scroll-lock/Tab-trap here —
  // it's a small inline dropdown, not a full-screen overlay; plain tab order is fine.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreToggleRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    moreToggleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !moreOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (morePanelRef.current?.contains(target) || moreToggleRef.current?.contains(target)) return;
      closeMore();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMore();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen, closeMore]);

  // route navigations run through the View Transitions helper — a
  // progressive enhancement that degrades to a plain router.push everywhere VT is
  // unsupported or reduced motion is on. `<Link>` is kept for prefetch + correct
  // markup (real href, keyboard/middle-click/new-tab semantics); we only intercept a
  // plain primary-button click. Modified clicks (new tab/window) fall through to the
  // browser untouched.
  const navigate = useViewTransition();

  // the persistent Travel Mode entry. Records the origin route + arms the gateway
  // flag, then pushes /travel through the same VT helper the nav links use.
  const enterTravel = useEnterTravelMode();
  const vtClick = useCallback(
    (href: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0
      ) {
        return;
      }
      e.preventDefault();
      navigate(href);
    },
    [navigate],
  );

  useEffect(() => {
    // `passive` lets the browser scroll without waiting to see if this listener
    // calls preventDefault(); the rAF gate coalesces a burst of scroll events into one
    // state read per frame (setScrolled is idempotent, so extra frames are free).
    let queued = false;
    const handleScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setScrolled(window.scrollY > 50);
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Travel Mode is a chrome-free route — the persistent navbar renders null
  // under `/travel`. Placed AFTER all hooks above (unconditional hook order) so only the
  // render is suppressed; the effects/listeners never mount visible chrome anyway.
  if (isTravelRoute(pathname)) return null;

  return (
    <>
      <ScrollProgress />
      <m.nav
        data-testid="navbar"
        aria-label="Primary"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          // v2 cosmetic: on scroll the bar reads as a richer "liquid glass"
          // surface — deeper navy fill, stronger blur+saturate, a luminous
          // hairline bottom edge keyed to the route accent, and the v2 elevation
          // ramp. Surfaces/type only; nav logic + a11y contracts untouched.
          scrolled
            ? 'bg-surface/80 backdrop-blur-xl backdrop-saturate-150 border-b border-white/[0.06] shadow-2xl'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <Link href="/" onClick={vtClick('/')} aria-label={brand ? `${brand} — home` : 'Nepal × Japan — home'} className="flex items-center gap-2.5 group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <MapPin className="w-5 h-5 text-muted-foreground group-hover:scale-110 transition-transform" />
              {/* on a custom trip the brand is the trip's own name (mount-safe — Navbar
                  never SSRs, see the primaryItems/brand comment above). Default trip: unchanged. */}
              {brand ? (
                <span data-testid="navbar-brand" className="font-display font-bold text-lg tracking-tight text-white truncate max-w-[40vw]">
                  {brand}
                </span>
              ) : (
                <span data-testid="navbar-brand" className="font-display font-bold text-lg tracking-tight text-white">
                  Nepal <span className="text-muted-foreground">×</span> Japan
                </span>
              )}
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {/* the desktop top row consolidates to the 4 shared primaries
                  (Today · Plan · Map · Guides) from the SAME source the mobile tab bar reads
                  Nepal/Japan are reachable via the Guides link; Flights/
                  Documents/Shared Links live in the "More" dropdown below (which sources
                  navItems − primary). On a custom trip Guides is dropped and refilled by the
                  promoted companion (Journal), still via primaryItemsForActiveTrip. */}
              {primaryItems.map((item) => {
                const isActive = isRouteActive(pathname, item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={vtClick(item.href)}
                    data-testid={`navbar-link-${item.label.toLowerCase()}`}
                    aria-current={isActive ? 'page' : undefined}
                    data-active={isActive ? 'true' : undefined}
                    className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      isActive ? 'text-white' : 'text-ink-mid hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-3 right-3 -bottom-0.5 h-0.5 rounded-full"
                        style={{ backgroundColor: 'hsl(var(--accent-scroll))' }}
                      />
                    )}
                  </Link>
                );
              })}

              {/* — desktop-only "More" disclosure: the companion routes (Journal/
                  Safety/Recap/etc, whatever navItemsForActiveTrip() leaves over once the
                  6 primary seats are subtracted) plus a Search row, so a mouse/keyboard
                  desktop user can SEE and reach them without the mobile hamburger or a
                  memorized ⌘K. Sits inside the same `hidden md:flex` cluster as the
                  primary links — never rendered below `md`. */}
              {moreItems.length > 0 && (
                <div className="relative">
                  <button
                    ref={moreToggleRef}
                    type="button"
                    data-testid="navbar-more-toggle"
                    onClick={() => setMoreOpen((v) => !v)}
                    aria-expanded={moreOpen}
                    aria-controls="navbar-more-menu"
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none text-ink-mid hover:text-white hover:bg-white/5"
                  >
                    More
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>

                  <AnimatePresence>
                    {moreOpen && (
                      <m.div
                        ref={morePanelRef}
                        id="navbar-more-menu"
                        data-testid="navbar-more-menu"
                        // `group`, not `menu`: this is a div of Links in plain tab order, and
                        // the role is what keeps `aria-label` exposed (a bare div is generic
                        // and drops the name).
                        role="group"
                        aria-label="More"
                        initial={panelInitial}
                        animate={panelAnimate}
                        exit={panelExit}
                        className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-white/[0.08] bg-surface/95 backdrop-blur-xl backdrop-saturate-150 shadow-2xl p-2 z-50"
                      >
                        {moreItems.map((item) => {
                          const isActive = isRouteActive(pathname, item.href);
                          return (
                            <Link
                              key={item.label}
                              href={item.href}
                              onClick={(e) => {
                                closeMore();
                                vtClick(item.href)(e);
                              }}
                              data-testid={`navbar-more-link-${item.label.toLowerCase()}`}
                              aria-current={isActive ? 'page' : undefined}
                              className={`flex items-center gap-2.5 w-full min-h-[40px] px-3 py-2 rounded-lg text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                                isActive ? 'text-white bg-white/5' : 'text-ink-mid hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <item.icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                              {item.label}
                            </Link>
                          );
                        })}

                        <div className="my-1.5 border-t border-white/[0.08]" aria-hidden="true" />

                        <button
                          type="button"
                          data-testid="navbar-more-search"
                          onClick={() => {
                            closeMore();
                            window.dispatchEvent(new CustomEvent('palette:open'));
                          }}
                          className="flex items-center justify-between gap-2.5 w-full min-h-[40px] px-3 py-2 rounded-lg text-sm text-ink-mid hover:text-white hover:bg-white/5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span className="flex items-center gap-2.5">
                            <Search className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            Search
                          </span>
                          <span className="text-xs text-ink-lo">⌘K / Ctrl+K</span>
                        </button>
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Right cluster: identity (desktop) · Travel Mode entry (all widths). Grouped so
                justify-between keeps the logo left and this pinned right, and the Travel Mode
                button never floats mid-bar on mobile. Mobile primary nav is the bottom tab bar
                — the mobile hamburger was removed in. */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Identity chip — desktop. "You are {name}" tinted with the traveler's
                  accent, + sign-out. With no
                  guest mode an unidentified visitor never reaches this render in practice
                  (TokenGate's wall covers it), so there is nothing to show when `traveler` is null.
                  Reactive via identity:changed so sign-in/out reflect live (no reload). */}
              <div className="hidden md:flex items-center shrink-0">
                {traveler && <TravelerChip name={traveler.name} accent={traveler.accent} />}
              </div>

              {/* — persistent Travel Mode entry, on EVERY page and EVERY trip phase,
                  reachable at both widths directly in the bar. Sits inside the navbar bar
                  (top row, z-50) — always above the sync-status pill, so
                  they never share space at any viewport. With no guest mode, only an
                  identified traveler ever reaches this button — the front-door wall covers everyone
                  else. Label collapses to icon-only below `sm` (the aria-label carries the name),
                  staying a ≥44px target. */}
              {conciergeAllowed && <ConciergeChat />}

              <button
                type="button"
                onClick={() => enterTravel(navigate)}
                data-testid="navbar-travel-mode"
                aria-label="Enter Travel Mode"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full border border-ring/30 bg-primary/10 px-2.5 text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/20 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-3.5"
              >
                <Compass className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Travel Mode</span>
              </button>
            </div>
          </div>
        </div>
      </m.nav>
    </>
  );
}

/**
 * "You are {name}" chip. The traveler's `accent` tints a subtle pill
 * background + dot via INLINE style, so any
 * of the three brand accents renders correctly without a safelist. Carries a sign-out
 * control —: sign-out is now a full local teardown, so the button is confirm-gated
 * via the shared `<SignOutConfirm>` (which itself calls `signOut()` then reloads) rather than a
 * bare onClick.
 */
function TravelerChip({ name, accent }: { name: string; accent: string }) {
  return (
    <div
      className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border bg-white/5"
      style={{ borderColor: `${accent}40` }}
    >
      <span className="flex items-center gap-1.5 min-w-0 text-xs text-ink-mid">
        <span
          aria-hidden="true"
          className="shrink-0 w-2 h-2 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="truncate">
          You are <span className="font-semibold text-white">{name}</span>
        </span>
      </span>
      <SignOutConfirm testId="navbar-sign-out">
        <button
          aria-label={`Sign out ${name}`}
          title="Sign out"
          data-testid="navbar-sign-out"
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-ink-mid hover:text-white hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </SignOutConfirm>
    </div>
  );
}
