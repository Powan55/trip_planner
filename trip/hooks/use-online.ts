'use client';

import { useEffect, useState } from 'react';

/**
 * Reactive `navigator.onLine` — the connectivity signal behind the
 * app-wide offline banner (`components/offline-banner.tsx`).
 *
 * SSR-safe: the server has no network state, so the initial value is always
 * `true` (online) — matching the server-rendered / first-client-paint DOM
 * (banner renders nothing). A mount effect corrects it to the REAL
 * `navigator.onLine` reading and then tracks the browser `online`/`offline`
 * events for the component's lifetime. Listeners are removed on unmount —
 * no leak across route changes (this hook is used from a root-layout-mounted
 * component, but stays clean for any other caller).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
