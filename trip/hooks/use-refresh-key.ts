'use client';

import { useEffect, useState } from 'react';

/** A resumed tab refetches only when the data it holds is at least this old. */
export const REFRESH_AFTER_MS = 30 * 60_000;

/**
 * A number that bumps when cached network data should be re-read: on the `online` event, and
 * when the tab becomes visible again after `REFRESH_AFTER_MS`. Put it in an effect's deps.
 * Never bumps while `navigator.onLine` is false (a refetch there only burns the timeout).
 * Age is measured from mount / the last bump, which is when the consumer's effect last ran.
 */
export function useRefreshKey(): number {
  const [key, setKey] = useState(0);

  useEffect(() => {
    // From mount / last bump, not the real fetch time: over-fetch is bounded to one per 30 min.
    let last = Date.now();
    const bump = () => {
      if (!navigator.onLine) return;
      last = Date.now();
      setKey((k) => k + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > REFRESH_AFTER_MS) bump();
    };
    window.addEventListener('online', bump);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', bump);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return key;
}
