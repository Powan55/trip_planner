/**
 * Did this error come from the security rules refusing the operation? (issue #10)
 *
 * THE ONE COPY of that test. Firestore stamps `code: 'permission-denied'` on the rejection of a
 * denied read/write and on a denied snapshot stream error alike, and every caller that must treat
 * a refusal differently from a transport failure — membership enrolment (dispatch, don't throw),
 * the presence heartbeat (stop the loop, don't retry forever), the door's identity probe, and the
 * offline outbox (stop re-pushing a chunk no retry can land, #267) — routes through here rather
 * than each spelling the string out.
 *
 * Deliberately narrow: only the code, never the message. A message match would fire on an
 * unrelated error that merely mentions permissions, and the consequence of a false positive here
 * is a heartbeat that stops or a toast the user cannot act on.
 *
 * IT LIVES IN `core/` BECAUSE THE OUTBOX NEEDS IT (D-423's "Changes if" clause). It used to be
 * declared in `lib/firebase-remote.ts`, which `core/sync/outbox.ts` may not import — the ESLint
 * negation list there names exactly two modules and D-423 says a third `lib/` import is the signal
 * that a value wants a core-side home, not another negation. So the declaration moved here and
 * `lib/firebase-remote.ts` re-exports it: every existing caller's import path is unchanged and
 * there is still exactly one copy. The move costs core nothing — this function imports nothing,
 * touches no `window`, and pulls no firebase onto the dormant hot path.
 */
export function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'permission-denied';
}
