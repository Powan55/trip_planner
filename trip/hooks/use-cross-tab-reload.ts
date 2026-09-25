import { useEffect } from 'react';
import { STORAGE_KEYS } from '@/core/storage/gateway';

let retiring = false;

/** True once this tab has started reloading because another tab changed the trip or identity. */
export function isTabRetiring(): boolean {
  return retiring;
}

function shouldReload(e: StorageEvent): boolean {
  if (e.key === null) return true;
  if (e.key === STORAGE_KEYS.activeTrip || e.key === STORAGE_KEYS.defaultTripShare) return true;
  // A rename rewrites the token in place; only sign-in/out flips it to or from null.
  return e.key === STORAGE_KEYS.token && (e.oldValue === null) !== (e.newValue === null);
}

/** Reload this tab when another tab switches trip, changes the default share, signs in/out or
 * clears storage, so its open listeners stop writing into slots that now belong to someone else. */
export function useCrossTabReload() {
  useEffect(() => {
    // KNOWN CEILING: a Firestore snapshot landing between the storage event and unload can
    // still persist into the new slots; closing it needs *-remote.ts edits.
    const onStorage = (e: StorageEvent) => {
      if (!shouldReload(e)) return;
      retiring = true;
      window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
