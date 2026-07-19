'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { travelModeGate, travelReturn } from '@/core/storage/travel-mode-store';

/**
 * — the Travel Mode exit affordance. A ≥44px X inside the chrome-free
 * `/travel` UI (the route hosts no navbar, so the escape hatch lives here). Mirrors the shared
 * dialog close idiom.
 *
 * HISTORY MODEL (no trap): exit clears the `travelMode` flag (downgrade to `'seen'`) and
 * `router.replace`s the remembered origin route (`travelReturn`), or `/` on a cold start / relaunch
 * / deep link. REPLACE — not push — so `/travel` is dropped from history: after exit, browser Back
 * never bounces back into `/travel`. The return route is cleared so a later cold entry starts fresh.
 */
export default function TravelExitButton() {
  const router = useRouter();

  const onExit = () => {
    const target = travelReturn.get() ?? '/';
    travelModeGate.exit();
    travelReturn.clear();
    router.replace(target);
  };

  return (
    <button
      type="button"
      onClick={onExit}
      aria-label="Exit Travel Mode"
      data-testid="travel-exit"
      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-white/60 outline-none transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
    >
      <X className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
