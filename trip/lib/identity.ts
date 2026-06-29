// Local display identity for cross-friend attribution.
//
// This is purely the display "who" — a self-chosen first name / nickname persisted in
// localStorage and stamped onto an item's createdBy/updatedBy when remote sync is
// active. It is NOT an auth credential and carries no PII beyond a nickname (no email,
// no surname). The unspoofable security id (the anonymous-auth uid) is a separate
// concern handled by the remote layer, not here.
//
// SSR-safe: every localStorage access is guarded by a `typeof window` check so these
// helpers are inert during static export / server render (return null / no-op).

const USER_NAME_KEY = 'tripPlannerUserName';

/**
 * Return the persisted display name, or null if none is set (or during SSR).
 */
export function getUserName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(USER_NAME_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a trimmed display name. No-op during SSR or if storage is unavailable.
 */
export function setUserName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USER_NAME_KEY, name.trim());
  } catch {
    /* ignore (quota / disabled storage) */
  }
}
