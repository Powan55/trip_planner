// Micro-interaction — "add to plan" flying chip.
//
// When an item is added to the itinerary, a small chip flies from the trigger toward
// the plan target (the mobile bottom tab bar, or the bottom-centre on desktop) and
// fades out — the premium "it went into your plan" cue.
//
// Design choices:
//   • NATIVE Web Animations API (element.animate), not framer — so it pulls no
//     animation lib into any route, and it lives OUTSIDE React so it survives the
//     add-dialog unmounting on confirm (the dialog closes immediately after add).
//   • Reduced-motion: the ONE gate — if the user prefers reduced motion we
//     return without creating anything (no-op, no flight, no DOM node).
//   • Z-ladder: the chip sits at z-50 (the nav/tab-bar/dialog tier) and is
//     pointer-events:none + aria-hidden, so it never blocks input, never punches above
//     a dialog incorrectly, and is invisible to assistive tech (purely decorative).
//   • Self-cleaning: removed on animation finish/cancel; if WAAPI is unavailable
//     (e.g. jsdom) it removes immediately — never leaves an orphan node.

export interface FlyChipOptions {
  /** Short label shown in the chip (e.g. the item title). Truncated for safety. */
  label?: string;
  /** A category text color class (e.g. 'text-sakura-400') for a subtle accent. */
  colorClass?: string;
}

/** Resolve the flight target: the bottom tab bar centre when present, else bottom-centre. */
function resolveTarget(): { x: number; y: number } {
  const bar = document.querySelector('[data-testid="tab-bar"]');
  if (bar) {
    const r = bar.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight - 40 };
}

/**
 * Launch a flying chip from a screen point (usually the confirm button's centre).
 * No-op under reduced motion, on the server, or when the point is unusable.
 */
export function flyChip(from: { x: number; y: number }, opts: FlyChipOptions = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // Reduced-motion gate (the #1 acceptance line): skip the effect entirely.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return;

  const to = resolveTarget();
  const label = (opts.label ?? 'Added').slice(0, 28);

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.textContent = `+ ${label}`;
  el.className = `glass-card-dark ${opts.colorClass ?? 'text-gold-300'}`;
  el.style.cssText = [
    'position:fixed',
    `left:${from.x}px`,
    `top:${from.y}px`,
    'z-index:50', // nav/tab-bar/dialog tier
    'pointer-events:none',
    'max-width:12rem',
    'padding:0.25rem 0.625rem',
    'border-radius:9999px',
    'font-size:0.75rem',
    'font-weight:600',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
    'will-change:transform,opacity',
    'transform:translate(-50%,-50%)',
  ].join(';');
  document.body.appendChild(el);

  const cleanup = () => el.remove();

  // Feature-detect WAAPI (absent in jsdom): without it, don't leave a static chip.
  if (typeof el.animate !== 'function') {
    cleanup();
    return;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const anim = el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: 0.15 },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35)`,
        opacity: 0,
      },
    ],
    { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
  );
  anim.onfinish = cleanup;
  anim.oncancel = cleanup;
}
