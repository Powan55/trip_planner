// Single on/off gate for the AI concierge chat feature. Mirrors
// `lib/firebase-config.ts`'s `isRemoteConfigured()` pattern: one module owns the env read and
// the on/off decision, so no other module reads `process.env.NEXT_PUBLIC_CONCIERGE_URL` directly.
//
// ABSENCE => the feature stays entirely inert (no trigger, no panel, no fetch). This is the
// DEFAULT state of every build today — the Worker (`worker/`) is not deployed yet
// (`worker/README.md`); Lax sets this var post-deploy. `NEXT_PUBLIC_*` so it's inlined at build
// time.

/** The deployed Worker's URL, or '' when unset (the default, dormant state). */
export const CONCIERGE_URL = process.env.NEXT_PUBLIC_CONCIERGE_URL || '';

/** True only once Lax has deployed the Worker and set the env var. */
export function isConciergeConfigured(): boolean {
  return Boolean(CONCIERGE_URL);
}
