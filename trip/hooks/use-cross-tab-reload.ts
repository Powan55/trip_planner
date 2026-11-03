import { useEffect } from 'react';
import { STORAGE_KEYS, readString } from '@/core/storage/gateway';

let retiring = false;

/** True once this tab has started reloading because another tab changed the trip or identity. */
export function isTabRetiring(): boolean {
  return retiring;
}

function shouldReload(key: string | null, oldValue: string | null, newValue: string | null): boolean {
  if (key === null) return true;
  if (key === STORAGE_KEYS.activeTrip || key === STORAGE_KEYS.defaultTripShare) return true;
  // A rename rewrites the token in place; only sign-in/out flips it to or from null.
  return key === STORAGE_KEYS.token && (oldValue === null) !== (newValue === null);
}

const WATCHED = [STORAGE_KEYS.activeTrip, STORAGE_KEYS.defaultTripShare, STORAGE_KEYS.token];
const snapshot = () => WATCHED.map((k) => readString('local', k));

/** Reload this tab when another tab switches trip, changes the default share, signs in/out or
 * clears storage, so its open listeners stop writing into slots that now belong to someone else. */
export function useCrossTabReload() {
  useEffect(() => {
    // KNOWN CEILING: a Firestore snapshot landing between the storage event and unload can
    // still persist into the new slots; closing it needs *-remote.ts edits.
    const retire = () => {
      retiring = true;
      window.location.reload();
    };
    const onStorage = (e: StorageEvent) => {
      if (shouldReload(e.key, e.oldValue, e.newValue)) retire();
    };
    // A bfcache restore gets no storage events for what changed while frozen, so diff against boot.
    const boot = snapshot();
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const now = snapshot();
      if (WATCHED.some((k, i) => boot[i] !== now[i] && shouldReload(k, boot[i], now[i]))) retire();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}
