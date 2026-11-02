// Home Screen install state, shared by the install toast (components/storage-persistence.tsx)
// and the night-before check (lib/preflight.ts). Client-only reads; false on the server.

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari's non-standard flag — no display-mode media query support there.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !!displayModeStandalone || iosStandalone;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
