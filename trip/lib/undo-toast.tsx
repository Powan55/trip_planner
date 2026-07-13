// The ONE undo utility. A destructive op removes its payload,
// then calls this to show a sonner toast with a single "Undo" action that restores it.
// Generalizes the budget panel's proven inline pattern so every destructive op —
// expense delete, itinerary item delete — offers undo through one code path.
//
// It is deliberately thin: the RESTORE semantics (same-id vs fresh-id under sync) live
// with the caller's store method, not here. This only owns the toast + action wiring.
//
// Micro-interaction — undo progress ring: the toast's icon is a small SVG ring
// that depletes over the (default 4s) undo window as a subtle "time left to undo" cue.
// PRESENTATIONAL ONLY: it does NOT set or change the toast's duration/timing (sonner's
// default lifetime is unchanged), so undo behavior is byte-identical to before. The ring
// sweep is a CSS keyframe (`.animate-undo-ring`) that is hard-neutralized under
// prefers-reduced-motion (globals.css) → the ring simply rests FULL/static, no motion.
import { toast } from 'sonner';

/** Depleting ring shown as the undo toast's icon. Decorative → aria-hidden. */
function UndoRing() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="-rotate-90 shrink-0"
    >
      {/* Track */}
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      {/* Depleting arc — base dashoffset 0 (full ring); the keyframe sweeps it to 44
          (2πr ≈ 44) over the undo window. Under reduced motion the animation is off,
          so it holds the base full ring. */}
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="44"
        className="animate-undo-ring"
        style={{ strokeDashoffset: 0 }}
      />
    </svg>
  );
}

export function showUndoToast(message: string, onUndo: () => void): void {
  toast.success(message, {
    icon: <UndoRing />,
    action: {
      label: 'Undo',
      onClick: onUndo,
    },
  });
}
