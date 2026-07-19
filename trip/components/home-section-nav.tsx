'use client';

import { useEffect, useState } from 'react';

/**
 * Home in-page sticky section nav — a slim `position:sticky` strip jumping to Home's
 * sections via their existing, unchanged ids (`hero`/`dashboard`/`timeline`/`inspiration` —
 * legacy v1 ids). Real `<a href="#id">` anchors: keyboard-focusable and
 * Enter-activated for free, and the smooth-scroll + reduced-motion behavior is ALREADY global
 * (`app/globals.css`: `html{scroll-behavior:smooth}`, neutralized to `auto` under
 * `prefers-reduced-motion` —), so this component ships NO scroll JS of its own.
 * The visible focus ring is also free — the global `:focus-visible` fallback rule in
 * `globals.css` already rings every focusable element that doesn't set its own, so no
 * per-link focus-ring classes are needed here.
 *
 * `aria-current="true"` tracks whichever section occupies the reading band via a small native
 * `IntersectionObserver`. The below-the-fold sections mount
 * lazily, so their elements can appear a beat after this component
 * mounts; a short bounded poll attaches the observer to each target once it exists in the DOM.
 *
 * `position:sticky` (not `fixed`) reserves its own space in normal flow, so it can never
 * overlap page content on any breakpoint; `top-16` matches the fixed navbar's `h-16` so this
 * strip docks directly under it once it scrolls into sticky range. `z-20` — below the navbar
 * (`z-50`) AND below its mobile-menu scrim (`z-30`), so an open hamburger menu still overlays it.
 *
 * Kept a deliberately small, plain (non-`dynamic`) component: it must be present immediately
 * (its observer needs to attach as each section mounts) and Home's First Load JS budget is
 * tight — so its chrome lives in plain CSS classes (`.home-nav*`, `globals.css`)
 * rather than inline Tailwind utility strings repeated in the page's own JS chunk.
 */

const SECTIONS = [
  { id: 'hero', label: 'Overview' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'inspiration', label: 'Essentials' },
] as const;

const POLL_MS = 250;
const POLL_MAX_TRIES = 20; // ~5s ceiling; LazyVisible's idle fallback mounts within ~200ms anyway

export default function HomeSectionNav() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const seen = new Set<string>();
    const io = new IntersectionObserver(
      // A band near the top of the viewport: "active" = whichever section occupies the
      // reading area just under the sticky strip, not merely "any pixel on screen".
      (entries) => entries.forEach((e) => e.isIntersecting && setActiveId(e.target.id)),
      { rootMargin: '-15% 0px -70% 0px' },
    );

    const attach = () => {
      for (const { id } of SECTIONS) {
        if (seen.has(id)) continue;
        const el = document.getElementById(id);
        if (el) {
          io.observe(el);
          seen.add(id);
        }
      }
    };
    attach();

    let tries = 0;
    const timer =
      seen.size < SECTIONS.length
        ? setInterval(() => {
            attach();
            if (++tries >= POLL_MAX_TRIES || seen.size === SECTIONS.length) clearInterval(timer);
          }, POLL_MS)
        : undefined;

    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <nav aria-label="Home sections" data-testid="home-section-nav" className="home-nav">
      <div className="home-nav-inner">
        {SECTIONS.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            data-testid={`home-section-nav-${id}`}
            aria-current={activeId === id ? 'true' : undefined}
            className="home-nav-link"
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
