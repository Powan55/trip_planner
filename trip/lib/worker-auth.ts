// The `Authorization` header the client sends to the Worker (issue #10) — one line of policy, in
// one place, for the two callers that talk to it (`hooks/use-concierge-chat.ts` and
// `lib/place-resolve.ts`). A Firebase ID token when there is a session, and none when there isn't.
//
// WHY IT EXISTS: the client half of a membership check that was never deployed. Worker 1.9.0 was
// to stop treating "you sent me a trip id" as authorization and verify the caller by GETting the
// trip document from the Firestore REST API AS THAT USER. 1.9.0 is not what is live: the running
// Worker verifies nothing, and `/resolve` with no bearer answers `400 unsupported url` — it fails
// on the url, not on the missing caller.
//
// NOT A BOUNDARY: nothing on the client is access control, and adding more client-side gating
// cannot make it into any — the check has to land on the Worker first.
//
// ONLY WHEN A TOKEN EXISTS. On a build with no firebase configured — the default state of this
// repo, and every browser test run — there is no session, no header is attached, and the request
// is byte-identical to the one that shipped before.
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
