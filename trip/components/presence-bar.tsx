'use client';

import { m } from 'framer-motion';
import { usePresence } from '@/hooks/use-presence';

/**
 * Active-traveler presence bar (, M13 / ).
 *
 * A compact, premium "active now" cluster — accent-colored avatar dots (the traveler's
 * brand accent, ) + names — for the travelers who are on the trip right now. The
 * data + gating live in `usePresence` (which subscribes via `lib/presence.ts`); this
 * component is purely presentational.
 *
 * RENDERS NOTHING when there are no active OTHERS — which is exactly the dormant case (no
 * firebase env ⇒ `usePresence` short-circuits and returns []) and the guest case (no token
 * ⇒ same short-circuit). So the portfolio / guest build shows nothing AND loads no firebase
 * (the headline dormant-safety guarantee, /).
 *
 * Placement (, no collision): a small `fixed` cluster at the BOTTOM-LEFT at `z-40`.
 * That sits BELOW the navbar (z-50), the gate (z-[70]), the scroll-progress bar (z-[60])
 * and the name-prompt (z-[60]), and is on the OPPOSITE side from the bottom-right Sonner
 * toasts — so it never overlaps any of them. `fixed` means it never participates in layout
 * flow, so it can't cause horizontal overflow at any width. `max-w` + `truncate` keep long
 * names contained.
 *
 * A11y: a labeled live region (`role="status"` + `aria-live="polite"`) so a
 * screen reader announces who joins, with a visually-hidden summary sentence; the dots are
 * `aria-hidden` decoration. The only motion is one declarative `m` reveal, which the
 * app-wide `<MotionConfig reducedMotion="user">` auto-neutralizes under
 * prefers-reduced-motion — no manual guard, no rAF, no infinite pulse. Static Tailwind
 * literals only; dark-only.
 */
export default function PresenceBar() {
  const active = usePresence();

  // No active others / dormant / guest ⇒ render nothing (portfolio + guest unchanged).
  if (active.length === 0) return null;

  const names = active.map((p) => p.name).join(', ');
  const verb = active.length === 1 ? 'is' : 'are';

  return (
    <m.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      role="status"
      aria-live="polite"
      aria-label="Travelers active now"
      className="fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] sm:max-w-xs"
    >
      <div className="flex items-center gap-2.5 rounded-full glass-card px-3 py-2 shadow-lg">
        {/* Overlapping accent dots — one per active traveler, decorative (names follow). */}
        <span className="flex -space-x-1.5" aria-hidden="true">
          {active.map((p) => {
            const initial = p.name.trim().charAt(0).toUpperCase() || '?';
            return (
              <span
                key={p.uid}
                title={p.name}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-navy-900 text-[10px] font-semibold text-navy-900"
                style={{ backgroundColor: p.accent }}
              >
                {initial}
              </span>
            );
          })}
        </span>

        {/* Visible label: names + "active now". `min-w-0` + `truncate` so a long roster
            can never overflow the pill. */}
        <span className="min-w-0 truncate text-xs font-medium text-white/80">
          <span className="truncate">{names}</span>
          <span className="text-white/45"> · active now</span>
        </span>

        {/* Screen-reader summary (the dots are aria-hidden); polite live region above
            announces this when the roster changes. */}
        <span className="sr-only">
          {names} {verb} active on the trip right now.
        </span>
      </div>
    </m.aside>
  );
}
