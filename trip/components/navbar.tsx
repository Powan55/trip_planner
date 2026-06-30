'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { MapPin, Calendar, Camera, Compass, Mountain, Menu, X, Plane, Map, LogOut, UserRound } from 'lucide-react';
import ScrollProgress from '@/components/scroll-progress';
import { useActiveSection } from '@/hooks/use-active-section';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { signOut, IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

const NAV_ITEMS = [
  { label: 'Itinerary', href: '#itinerary', icon: Calendar },
  { label: 'Flights', href: '#flights', icon: Plane },
  { label: 'Nepal', href: '#nepal', icon: Mountain },
  { label: 'Japan', href: '#japan', icon: Compass },
  { label: 'Photography', href: '#photography', icon: Camera },
  { label: 'Map', href: '#map', icon: Map },
  { label: 'Inspiration', href: '#inspiration', icon: Plane },
];

// Section ids the scroll-spy watches — derived from the nav anchors so the two
// can never drift apart.
const SECTION_IDS = NAV_ITEMS.map((item) => item.href.replace('#', ''));

// Clearing the guest opt-in re-arms the gate: with no active traveler and the guest flag
// gone, TokenGate's identity:changed listener re-evaluates `!traveler && !guest` → re-shows
// the wall. SSR-guarded; dispatches the same reactive signal sign-in/out use (pattern).
function exitGuest(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('tripPlannerGuest');
  } catch {
    /* ignore (disabled storage) */
  }
  window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT));
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeSection = useActiveSection(SECTION_IDS);
  // Reactive identity: the chip reflects sign-in / sign-out LIVE via identity:changed.
  const { traveler, isGuest } = useActiveTraveler();

  // reduced-motion-aware panel motion. <MotionConfig reducedMotion="user">
  // neutralizes animated TRANSITIONS under reduce, but a declared `initial={{ y:-20 }}`
  // still paints one transform frame before snapping. So under reduce we drop the `y`
  // offset entirely → the panel is OPACITY-ONLY (no transform-based motion at any frame).
  // The scrim is already opacity-only. `prefersReducedMotion` is null during SSR/first
  // paint (treated as "no preference"); the panel only renders after a user opens it.
  const prefersReducedMotion = useReducedMotion();
  const panelInitial = prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 };
  const panelAnimate = prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 };
  const panelExit = prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 };

  // the hamburger toggle (focus returns here on close, ) and the open
  // panel (so the Tab-trap can scope its focusables to the menu).
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // single close path. Returns focus to the hamburger toggle so a
  // keyboard user lands back on the control that opened the menu, regardless of
  // whether close came from Esc, the scrim, the X, or a nav item. `preventScroll`
  // because the scroll-lock effect (below) pins the body with position:fixed
  // focusing while still pinned must not nudge the viewport before the offset is
  // restored on the same tick by the effect cleanup.
  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  }, []);

  // while the menu is open: lock background scroll, listen for Escape, and
  // trap Tab within the panel. SSR-guarded; everything is torn down on close so
  // there is no residual listener or locked body.
  
  // Scroll-lock technique: on THIS page the scrolling element is <html>, so a bare
  // `body { overflow:hidden }` does NOT stop the viewport (verified — the page
  // still scrolled behind the open menu). We instead PIN the body with
  // `position:fixed; top:-<scrollY>px; width:100%`, which truly freezes the
  // background, and on close we remove the pin and `scrollTo` the saved offset
  // so scroll POSITION is preserved exactly (brief §4: the sanctioned position:fixed
  // path). No layout shift / no horizontal overflow (width:100% + the page already
  // hides the scrollbar via.scrollbar-hide / hidden OS scrollbars).
  useEffect(() => {
    if (typeof document === 'undefined' || !mobileOpen) return;

    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMobile();
        return;
      }
      if (e.key === 'Tab') {
        // Minimal focus-trap: cycle Tab/Shift+Tab within the open panel so focus
        // can't escape behind the scrim into the page underneath (logical
        // tab order). The hamburger toggle stays the focus-return target on close.
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !panel.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Unpin and restore the exact prior scroll offset.
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen, closeMobile]);

  const handleNav = (href: string) => {
    const wasOpen = mobileOpen;
    closeMobile();
    const scrollToTarget = () => {
      const el = document.querySelector(href);
      el?.scrollIntoView?.({ behavior: 'smooth' });
    };
    // When the mobile menu was open, the scroll-lock effect pins the body
    // (position:fixed) and, on close, restores the saved offset — both of which
    // would clobber an immediate scrollIntoView. Defer past the React commit +
    // effect cleanup (double rAF) so we scroll AFTER the body is unpinned. On
    // desktop (menu never open) scroll immediately — no pin, no defer needed.
    if (wasOpen) {
      requestAnimationFrame(() => requestAnimationFrame(scrollToTarget));
    } else {
      scrollToTarget();
    }
  };

  const handleSignOut = () => {
    closeMobile();
    signOut(); // dispatches identity:changed → gate re-shows, chip clears, remote tears down
  };

  const handleSignIn = () => {
    closeMobile();
    exitGuest(); // clears guest flag + dispatches identity:changed → gate returns
  };

  return (
    <>
      <ScrollProgress />
      <m.nav
        aria-label="Primary"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-navy-900/90 backdrop-blur-xl shadow-lg shadow-black/20' : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <button onClick={() => handleNav('#hero')} aria-label="Nepal × Japan — back to top" className="flex items-center gap-2 group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none">
              <MapPin className="w-5 h-5 text-gold-400 group-hover:scale-110 transition-transform" />
              <span className="font-display font-bold text-lg tracking-tight text-white">
                Nepal <span className="text-gold-400">×</span> Japan
              </span>
            </button>

            <div className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = activeSection === item.href.replace('#', '');
                return (
                  <button
                    key={item.label}
                    onClick={() => handleNav(item.href)}
                    aria-current={isActive ? 'true' : undefined}
                    data-active={isActive ? 'true' : undefined}
                    className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                      isActive ? 'text-white' : 'text-white/70 hover:text-white hover:bg-white/5'
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
                  </button>
                );
              })}
            </div>

            {/* Identity chip — desktop. "You are {name}" tinted with the traveler's
                accent (inline style, NOT a dynamic Tailwind class — ), + sign-out.
                Guest → a quiet "Guest · Sign in" affordance that returns to the gate.
                Reactive via identity:changed so sign-in/out reflect live (no reload). */}
            <div className="hidden md:flex items-center shrink-0">
              {traveler ? (
                <TravelerChip name={traveler.name} accent={traveler.accent} onSignOut={handleSignOut} />
              ) : isGuest ? (
                <GuestChip onSignIn={handleSignIn} />
              ) : null}
            </div>

            <button
              ref={toggleRef}
              onClick={() => (mobileOpen ? closeMobile() : setMobileOpen(true))}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-menu"
              className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </m.nav>

      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Scrim. Sits BELOW the panel (z-40) and the nav (z-50) but above
                page content — tap/click anywhere off the menu to dismiss. Decorative
                (aria-hidden); the menu items carry the a11y. Opacity-only fade, so
                <MotionConfig reducedMotion="user"> renders it instantly (no transform)
                under prefers-reduced-motion. `inset-0` introduces no overflow. Stays under the Trip Token gate (z-70) and toasts. */}
            <m.div
              key="mobile-nav-scrim"
              aria-hidden="true"
              onClick={closeMobile}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-30 bg-navy-900/60 backdrop-blur-sm md:hidden"
            />

            <m.div
              ref={panelRef}
              id="mobile-nav-menu"
              initial={panelInitial}
              animate={panelAnimate}
              exit={panelExit}
              className="fixed inset-x-0 top-16 z-40 bg-navy-900/95 backdrop-blur-xl border-b border-white/5 md:hidden"
            >
              <div className="p-4 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = activeSection === item.href.replace('#', '');
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleNav(item.href)}
                      aria-current={isActive ? 'true' : undefined}
                      data-active={isActive ? 'true' : undefined}
                      className={`relative flex items-center gap-3 w-full min-h-[44px] px-4 py-3 rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                        isActive ? 'text-white bg-white/5' : 'text-white/80 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
                          style={{ backgroundColor: 'hsl(var(--accent-scroll))' }}
                        />
                      )}
                      <item.icon className="w-5 h-5 text-gold-400" />
                      {item.label}
                    </button>
                  );
                })}

                {/* Identity row — mobile. Same reactive states as desktop. */}
                {(traveler || isGuest) && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    {traveler ? (
                      <div className="flex items-center justify-between gap-2 px-4 py-3 min-h-[44px]">
                        <span className="flex items-center gap-2 min-w-0 text-sm text-white/80">
                          <span
                            aria-hidden="true"
                            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full"
                            style={{ backgroundColor: `${traveler.accent}26`, color: traveler.accent }}
                          >
                            <UserRound className="w-4 h-4" />
                          </span>
                          <span className="truncate">
                            You are <span className="font-semibold text-white">{traveler.name}</span>
                          </span>
                        </span>
                        <button
                          onClick={handleSignOut}
                          className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                        >
                          <LogOut className="w-4 h-4" aria-hidden="true" />
                          Sign out
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleSignIn}
                        className="flex items-center gap-3 w-full min-h-[44px] px-4 py-3 rounded-lg text-white/80 hover:text-white hover:bg-white/5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                      >
                        <UserRound className="w-5 h-5 text-white/50" aria-hidden="true" />
                        <span className="text-sm">Guest · <span className="text-gold-400">Sign in</span></span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * "You are {name}" chip (, desktop). The traveler's `accent` tints a subtle pill
 * background + dot via INLINE style (forbids dynamic Tailwind class names), so any
 * of the three brand accents renders correctly without a safelist. Carries a sign-out
 * control; `signOut` then fires identity:changed → the gate re-shows and this chip clears.
 */
function TravelerChip({
  name,
  accent,
  onSignOut,
}: {
  name: string;
  accent: string;
  onSignOut: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border bg-white/5"
      style={{ borderColor: `${accent}40` }}
    >
      <span className="flex items-center gap-1.5 min-w-0 text-xs text-white/70">
        <span
          aria-hidden="true"
          className="shrink-0 w-2 h-2 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="truncate">
          You are <span className="font-semibold text-white">{name}</span>
        </span>
      </span>
      <button
        onClick={onSignOut}
        aria-label={`Sign out ${name}`}
        title="Sign out"
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
      >
        <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Guest affordance (, desktop): a quiet "Guest · Sign in" pill. Clicking clears the
 * guest opt-in and fires identity:changed → the gate returns so the guest can sign in.
 */
function GuestChip({ onSignIn }: { onSignIn: () => void }) {
  return (
    <button
      onClick={onSignIn}
      className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-white/60 hover:text-white hover:border-white/20 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
    >
      <UserRound className="w-3.5 h-3.5" aria-hidden="true" />
      <span>
        Guest · <span className="text-gold-400 font-medium">Sign in</span>
      </span>
    </button>
  );
}
