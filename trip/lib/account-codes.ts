// Shared by the firebase-free door and the account helpers. A leaf on purpose: no imports.

/** Account ids are lowercase UUIDs; the rules refuse anything else, so check before any probe or write. */
export const ACCOUNT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `writeAccountLink` rejects with this code when another user already owns the account id. */
export const ACCOUNT_CLAIMED = 'account/claimed';

/** `signInWithHandoff` rejects with this code when an owner grant failed; the session is unchanged. */
export const OWNER_HANDOFF_FAILED = 'handoff/owner-grant-failed';
