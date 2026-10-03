'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { clockOverride } from '@/core/storage/gateway';
import { getNow, isClockOverridden } from '@/lib/trip-now';

/**
 * #790: persistent marker while the `?today=` demo clock is active. The override sticks for the
 * tab (sessionStorage) and silently changes Day N everywhere; this makes it visible and gives a
 * one-tap way back to the real clock. Renders nothing on the server / first paint (no hydration
 * mismatch) and whenever the real clock is running. Write defaults (expense / quick-add dates)
 * ignore the override separately via `getTodayInTripForWrite`.
 */
export function ClockOverrideBanner() {
  const [simulated, setSimulated] = useState<string | null>(null);

  useEffect(() => {
    if (!isClockOverridden()) return;
    const d = getNow();
    const pad = (n: number) => String(n).padStart(2, '0');
    setSimulated(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }, []);

  if (!simulated) return null;

  const useRealClock = () => {
    clockOverride.clear();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('today', 'off'); // also wins over a stale ?today= in the URL
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  return (
    <div
      role="status"
      data-testid="clock-override-banner"
      className="fixed inset-x-0 bottom-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom)+0.5rem)] z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-r1 border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] px-2.5 py-1.5 md:bottom-4"
    >
      <CalendarClock className="h-3 w-3 shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
      <span className="pr whitespace-nowrap">Demo clock · {simulated}</span>
      <span className="sr-only">
        The app is showing a simulated date, not today. New expenses and entries do not use it.
      </span>
      <button type="button" onClick={useRealClock} className="pr underline underline-offset-2">
        Use real clock
      </button>
    </div>
  );
}

export default ClockOverrideBanner;
