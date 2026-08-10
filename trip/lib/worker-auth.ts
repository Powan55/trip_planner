// The `Authorization` header the deployed Worker now requires (issue #10) — one line of policy,
// in one place, for the two callers that talk to it (`hooks/use-concierge-chat.ts` and
// `lib/place-resolve.ts`).
//
// WHY IT EXISTS: the Worker moved from token POSSESSION to rules-verified MEMBERSHIP. It used to
// treat "you sent me a trip id" as authorization, which is exactly as strong as the id being
// unguessable and no stronger. It now takes a Firebase ID token, and verifies the caller by
// GETting the trip document from the Firestore REST API AS THAT USER — so the same rules that
// guard the client guard the Worker, and there is no second copy of the access model to keep in
// step. Fail closed is the Worker's half of that; this is the client's half.
//
// ONLY WHEN A TOKEN EXISTS. On a build with no firebase configured — the default state of this
// repo, and every browser test run — there is no session, no header is attached, and the request
// is byte-identical to the one that shipped before. That is what lets the client ship first: the
// Worker's requirement can only be turned on after the client that satisfies it is live, and in
// the meantime an unauthenticated dormant build behaves exactly as it always did.
//
// DORMANT-SAFE: `itinerary-remote` (and firebase behind it) is reached only through the dynamic
// import below, after the gate — so the dormant bundle pulls neither.

import { isRemoteConfigured } from './firebase-config';

/**
 * `{ authorization: 'Bearer <id token>' }`, or `{}` when there is nothing to send. TOTAL — spreads
 * cleanly into a `headers` object either way, so no call site needs a branch.
 */
export async function workerAuthHeader(): Promise<Record<string, string>> {
  if (!isRemoteConfigured()) return {};
  try {
    const { getAuthIdToken } = await import('./itinerary-remote');
    const token = await getAuthIdToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {}; // an unreachable firebase must cost the user a header, never the whole request
  }
}
