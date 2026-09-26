'use client';

import { getSyncCode, identityStore } from '@/core/storage/gateway';
import { PRIOR_NAMES_CHANGED_EVENT } from '@/core/storage/events';
import { isRemoteConfigured } from './firebase-config';
import { DEFAULT_TRAVELER_NAME } from './token-auth';

/**
 * D-601: prior names follow the person. Unions this device's list into the account's
 * `priorNames` pref and adopts the union here, so "My edits" matches on every device. The set
 * only grows; the local list keeps working with no sync code, and a failed push is retried on
 * the next call because the local list always goes up whole.
 *
 * The login placeholder is recorded locally on every adopt, and the account list can never shed
 * a name, so it is only sent when the user explicitly claims it (`claimed`).
 */
export async function syncPriorNames(claimed?: string): Promise<void> {
  const code = getSyncCode()?.trim();
  if (!isRemoteConfigured() || !code) return;
  const names = identityStore.getPriorNames().filter((n) => n !== DEFAULT_TRAVELER_NAME);
  if (claimed) names.push(claimed);
  const { unionPref } = await import('@/lib/account-prefs-remote');
  if (getSyncCode()?.trim() !== code) return;
  const union = await unionPref('priorNames', names);
  // Signed out or switched account while the write was in flight: don't hand this list to them.
  if (!union || getSyncCode()?.trim() !== code) return;
  if (identityStore.mergePriorNames(union)) window.dispatchEvent(new CustomEvent(PRIOR_NAMES_CHANGED_EVENT));
}
