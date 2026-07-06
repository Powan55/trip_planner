/**
 * Journal domain — the pure, framework-free per-day text-journal core.
 * Gateway key 12 stores a `JournalEntry[]`.
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no next,
 * no fetch, no clock, no id generation, no storage. Every function is TOTAL (a bad / missing
 * / corrupt input degrades to a safe value, never a throw), so the store can never crash on a
 * corrupt slot and the panel can never render `undefined`. This mirrors `core/budget/expenses.ts`
 * exactly (the 4th persisted data domain on the same established pattern).
 *
 * ── One entry per trip day, keyed by date (upsert by date) ─────────────────────────────────
 * A journal entry is a short capture for a single `YYYY-MM-DD` trip day: a free-text body, an
 * OPTIONAL mood (one of the 4 `MOODS`), and an OPTIONAL short "highlight of the day". There is
 * at most ONE entry per date — `upsertEntry` merges a patch into the existing entry (or creates
 * one). Deleting all content (empty text + no mood + empty highlight) REMOVES the entry, so the
 * "clear everything" flow lands on a clean empty state with no phantom re-seed.
 *
 * ── timestamp injection (the pure-core pattern) ────────────────────────────────────────────
 * `upsertEntry` takes `nowIso` from the CALLER (the React hook injects `new Date().toISOString()`),
 * so this core stays deterministic and unit-testable without stubbing a clock. `createdAt` is set
 * only on create; `updatedAt` moves to `nowIso` on every write. Photos / IndexedDB are explicitly
 * OUT of scope (a future photo/story phase is a declared future boundary); the journal stays
 * localStorage-only, which is the whole reason the photo phase is held out.
 */

// ── Moods (a small closed enum) ──────────────────────────────────────────────────────────
export const MOODS = ['great', 'good', 'okay', 'rough'] as const;
export type Mood = (typeof MOODS)[number];

// ── The JournalEntry shape (gateway key 12 stores a `JournalEntry[]`) ────────────────────
/**
 * A single per-day journal entry. `date` keys the entry (≤ 1 per date). `text` is the free-form
 * body (may be `''` when only a mood/highlight is set). `mood` / `highlight` are optional.
 * `createdAt` / `updatedAt` are ISO timestamps INJECTED by the caller (keeps the core deterministic).
 */
export interface JournalEntry {
  /** 'YYYY-MM-DD' — the trip day this entry belongs to. Upsert key (≤ 1 entry per date). */
  date: string;
  /** Free-form body. May be '' when only a mood/highlight is set (content is still non-empty). */
  text: string;
  /** Optional mood — one of the 4 `MOODS`. Dropped when absent/invalid. */
  mood?: Mood;
  /** Optional short "highlight of the day". Trimmed; dropped when empty. */
  highlight?: string;
  /** ISO create timestamp — injected by the caller. Set once (never re-timed on edit). */
  createdAt: string;
  /** ISO last-write timestamp — injected by the caller. Moves on every write. */
  updatedAt: string;
}

/**
 * A partial patch merged into an entry (or used to create one). `mood`/`highlight` accept `null`
 * to EXPLICITLY clear that field (distinct from `undefined` = "leave unchanged"), so an edit can
 * remove a mood or a highlight while keeping the text.
 */
export type JournalPatch = { text?: string; mood?: Mood | null; highlight?: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Type guard: the value is one of the 4 canonical moods. */
export function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}

/**
 * Is a candidate's content "empty"? True iff trimmed text is '' AND no valid mood AND trimmed
 * highlight is ''. An empty candidate is not a persistable entry — `sanitizeEntry` rejects it and
 * `upsertEntry` removes the entry when a merge lands here (the "delete all content" path). TOTAL.
 */
export function isEmptyContent(c: { text?: string; mood?: Mood | null; highlight?: string | null }): boolean {
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  const highlight = typeof c.highlight === 'string' ? c.highlight.trim() : '';
  const hasMood = isMood(c.mood);
  return text === '' && highlight === '' && !hasMood;
}

/**
 * Coerce any parsed-from-storage / caller-supplied value into a valid `JournalEntry`, or `null`
 * when it is too malformed to salvage. A valid `date` (YYYY-MM-DD) AND non-empty content are
 * required (no safe default for either). `text` is trimmed (→ '' when absent/blank); `mood` is
 * kept only if `isMood`, else dropped; `highlight` is trimmed or dropped; `createdAt`/`updatedAt`
 * fall back to '' (kept sortable, never a throw). TOTAL.
 */
export function sanitizeEntry(value: unknown): JournalEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Partial<Record<keyof JournalEntry, unknown>>;

  // A valid date is mandatory — it is the entry key and has no safe default.
  if (typeof v.date !== 'string' || !DATE_RE.test(v.date)) return null;

  const text = typeof v.text === 'string' ? v.text.trim() : '';
  const mood = isMood(v.mood) ? v.mood : null;
  const highlight = typeof v.highlight === 'string' && v.highlight.trim().length > 0 ? v.highlight.trim() : null;

  // Non-empty content is required, else the entry is not persistable (a blank day = no entry).
  if (isEmptyContent({ text, mood, highlight })) return null;

  const entry: JournalEntry = {
    date: v.date,
    text,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
  };
  if (mood !== null) entry.mood = mood;
  if (highlight !== null) entry.highlight = highlight;

  return entry;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `JournalEntry[]`: drop anything that
 * is not an array, drop each entry `sanitizeEntry` cannot salvage, and DEDUPE by date — if two
 * entries share a date, the LAST one wins (so a corrupt slot can never surface two entries for one
 * day, preserving the "≤ 1 entry per date" invariant). TOTAL — never throws.
 */
export function sanitizeEntries(value: unknown): JournalEntry[] {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, JournalEntry>();
  for (const raw of value) {
    const e = sanitizeEntry(raw);
    if (e !== null) byDate.set(e.date, e); // last write for a date wins (dedupe)
  }
  return Array.from(byDate.values());
}

/** The entry for `date`, or `null` when none exists. Pure lookup (does not sanitize the list). */
export function getEntry(entries: readonly JournalEntry[], date: string): JournalEntry | null {
  if (!Array.isArray(entries)) return null;
  return entries.find((e) => e !== null && typeof e === 'object' && e.date === date) ?? null;
}

/**
 * Merge `patch` into the entry for `date` (or create one), returning a NEW array. `createdAt` is
 * set only on create (preserved on edit); `updatedAt` becomes `nowIso` on every write. A `mood`/
 * `highlight` of `null` in the patch CLEARS that field; `undefined` leaves it unchanged.
 *
 * If the merged content is empty (blank text + no mood + blank highlight) the entry is REMOVED —
 * so "clear everything + save" lands on a clean empty state with no phantom re-seed. TOTAL:
 * an invalid `date` returns the list unchanged; a bad patch degrades to safe values, never throws.
 */
export function upsertEntry(
  entries: readonly JournalEntry[],
  date: string,
  patch: JournalPatch,
  nowIso: string,
): JournalEntry[] {
  const list = Array.isArray(entries) ? entries : [];
  if (typeof date !== 'string' || !DATE_RE.test(date)) return [...list];

  const existing = getEntry(list, date);

  // Resolve each field: patch `undefined` = keep existing; patch `null` = clear; else set.
  const nextText =
    patch.text !== undefined ? (typeof patch.text === 'string' ? patch.text.trim() : '') : (existing?.text ?? '');
  const nextMood: Mood | null =
    patch.mood !== undefined ? (isMood(patch.mood) ? patch.mood : null) : (existing?.mood ?? null);
  const nextHighlight: string | null =
    patch.highlight !== undefined
      ? (typeof patch.highlight === 'string' && patch.highlight.trim().length > 0 ? patch.highlight.trim() : null)
      : (existing?.highlight ?? null);

  // Emptying an entry (or creating with empty content) → remove it (clean empty state).
  if (isEmptyContent({ text: nextText, mood: nextMood, highlight: nextHighlight })) {
    return list.filter((e) => e.date !== date);
  }

  const merged: JournalEntry = {
    date,
    text: nextText,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  if (nextMood !== null) merged.mood = nextMood;
  if (nextHighlight !== null) merged.highlight = nextHighlight;

  if (existing) {
    return list.map((e) => (e.date === date ? merged : e));
  }
  return [...list, merged];
}

/** Remove the entry for `date`. Returns a NEW array; a non-matching date is a no-op. TOTAL. */
export function removeEntry(entries: readonly JournalEntry[], date: string): JournalEntry[] {
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((e) => e.date !== date);
}
