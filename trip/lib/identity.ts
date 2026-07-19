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
//
// As of the raw localStorage access + the `tripPlannerUserName` key
// literal live in the typed storage gateway (`core/storage/gateway.ts`). These functions
// keep their exact signatures and behavior (SSR-safe, never-throw, trim on write) and
// simply delegate to `identityStore` — the key string and on-disk value are unchanged.

import { identityStore } from '@/core/storage/gateway';

/**
 * Return the persisted display name, or null if none is set (or during SSR).
 */
export function getUserName(): string | null {
  return identityStore.getName();
}

/**
 * Persist a trimmed display name. No-op during SSR or if storage is unavailable.
 */
export function setUserName(name: string): void {
  identityStore.setName(name);
}
