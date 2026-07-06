/**
 * Trip Vault — the versioned storage envelope.
 *
 * Local persisted domain data is wrapped in a minimal, versioned envelope so that
 * every future format change becomes a deterministic, ordered migration (see
 * `./migrations.ts`) rather than a defensive `try/catch` guess. The envelope is the
 * smallest shape that satisfies versioning + validation + migration — three fields,
 * no gold-plating (no `id` / `checksum` / `migratedFrom` history; add only when a
 * concrete need arises, recorded then).
 *
 * `T` is generic so the same envelope serves the itinerary now (`DayPlan[]`) and any
 * future corralled blob.
 */
export interface VaultEnvelope<T> {
  /** Integer, monotonically increasing. Drives the migration runner. Itinerary target = 3. */
  schemaVersion: number;
  /** ISO-8601 timestamp of the last write through the Vault. */
  updatedAt: string;
  /** The typed domain data (e.g. `DayPlan[]`). */
  payload: T;
}

/**
 * Build a current-version envelope around a payload.
 *
 * `updatedAt` is stamped by the Vault write path (NOT by a migration step — migrations
 * are pure and take no clock). `nowISO` is injected so the write path stays testable /
 * deterministic; production passes the real clock.
 */
export function makeEnvelope<T>(
  schemaVersion: number,
  payload: T,
  nowISO: string,
): VaultEnvelope<T> {
  return { schemaVersion, updatedAt: nowISO, payload };
}
