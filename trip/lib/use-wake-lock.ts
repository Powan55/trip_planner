'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Screen Wake Lock — keeps the display from sleeping while Travel
 * Mode's Essentials/agenda view is actively on-screen (transit days, day-of itinerary).
 *
 * Feature-detected (`'wakeLock' in navigator`; iOS Safari 18.4+, a quiet no-op everywhere
 * else) — zero dependency, zero polyfill. The browser auto-releases a lock when the tab is
 * hidden/backgrounded, so this re-acquires on `visibilitychange` back to `'visible'` while
 * `active`; it releases on unmount (route navigation away from `/travel`) or when `active`
 * flips false. Every call is wrapped in try/catch — a permission denial, an unsupported
 * call-time state, or a battery-saver rejection is silently a no-op, NEVER a console error.
 */
export interface WakeLockState {
  /** Whether the Wake Lock API exists in this browser. */
  supported: boolean;
  /** Whether a lock is CURRENTLY held (re-derives across visibility changes). */
  held: boolean;
}

export function useWakeLock(active: boolean): WakeLockState {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const [held, setHeld] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        lockRef.current = lock;
        setHeld(true);
        lock.addEventListener('release', () => setHeld(false));
      } catch {
        // Permission denied / unsupported at call-time / battery saver — quiet no-op.
      }
    };

    acquire();

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !lockRef.current) acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
      setHeld(false);
    };
  }, [active, supported]);

  return { supported, held };
}
