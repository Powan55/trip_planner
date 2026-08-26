/**
 * Critical-documents & day-zero-readiness checklist domain — the pure, framework-free core
 * Gateway key 25 stores a `DocItem[]`. SYNCED across travelers: each
 * item is an id-keyed row carrying the additive Sync-v2 stamps (`rev`/`hlc`), so two travelers'
 * concurrent offline toggles converge via `mergeItems` (the expenses row-merge algebra, applied to
 * a SINGLE doc `trips/{tripId}/docs/checklist` — see `lib/docs-remote.ts`).
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no
 * window, no storage, no firebase, no clock. Every function is TOTAL (a bad/missing/corrupt input
 * degrades to a safe value, never a throw).
 *
 * DORMANT BYTE-IDENTITY: the sync fields are OPTIONAL and are stamped ONLY when the hook's
 * caller has sync configured. A dormant (no-Firebase) build writes items as `{id, section, label,
 * checked, note?}` with NO `rev`/`hlc` — byte-identical to a local-only domain. The stamping GATE
 * lives in `hooks/use-docs.ts`; this core only threads an optional `stamp` through the mutators.
 *
 * FIXED TEMPLATE: two fixed sections seeded from a built-in template
 * on first load — check/uncheck + an optional per-item note are the ONLY mutations; there is no
 * add/remove of custom items in v1. Items never change shape or count, only `checked`/`note` (and,
 * under sync, the stamps) persist.
 */

import type { SyncedRow } from '@/core/sync/merge-items';

export type DocSection = 'critical' | 'dayzero';

/** One checklist row. Extends the id-keyed Sync-v2 row shape (rev/hlc/deleted/updatedAt are the
 * additive sync stamps — present only under sync; absent on the dormant build,). */
export interface DocItem extends SyncedRow {
  id: string;
  section: DocSection;
  label: string;
  checked: boolean;
  /** Optional free-text traveler note (passport #, policy #, expiry date …). Omitted when empty. */
  note?: string;
  /** Attribution, stamped alongside the sync fields under sync only. */
  updatedBy?: string;
}

/** A stamper the hook injects (under sync only) to advance an edited row's rev/hlc + attribution. */
export type DocStamper = (item: DocItem) => DocItem;

const SECTIONS: readonly DocSection[] = ['critical', 'dayzero'];

/** Type guard: the value is one of the 2 canonical sections. */
export function isDocSection(v: unknown): v is DocSection {
  return typeof v === 'string' && (SECTIONS as readonly string[]).includes(v);
}

/** Read-boundary options. Absent ⇒ STRICT: a caller that does not ask gets the allowlist rebuild. */
export interface SanitizeOptions {
  /**
   * Retain keys this build does not declare (#138). Set ONLY on the REMOTE read, where the
   * sanitized row is merged and written straight back to Firestore. Never on a LOCAL path.
   */
  keepUnknownKeys?: boolean;
}

/**
 * The built-in checklist template (18 items — 10 critical documents, 8 day-zero readiness), all
 * unchecked. Realistic copy for a Dec 2026 Kathmandu → Japan trip (Nepal visa-on-arrival, Visit
 * Japan Web, IC cards etc.). Ids are stable kebab-case strings — the persistence + merge key.
 */
export const DEFAULT_TEMPLATE: readonly DocItem[] = [
  // ── Critical documents ──────────────────────────────────────────────────────
  { id: 'passport-validity', section: 'critical', label: 'Passport valid 6+ months beyond Jan 2027', checked: false },
  // The date is written into the label on purpose (#252): the online pre-application receipt is
  // valid 15 days, so an early tick is a false green on the row that gates entry. Arrival is
  // Dec 10 2026 and the trip dates are fixed, so the earliest useful day is a constant — not a
  // due-date field on DocItem, which extends the synced row type.
  { id: 'nepal-visa', section: 'critical', label: 'Nepal visa sorted — visa on arrival at KTM, or the online form from 26 Nov 2026 (its receipt is valid 15 days)', checked: false },
  { id: 'japan-entry', section: 'critical', label: 'Japan entry — Visit Japan Web done, QR saved offline', checked: false },
  { id: 'travel-insurance', section: 'critical', label: 'Travel insurance policy + 24h assistance number', checked: false },
  { id: 'flight-tickets', section: 'critical', label: 'Flight e-tickets (Kathmandu & Japan legs) saved offline', checked: false },
  { id: 'vaccination-cert', section: 'critical', label: 'Vaccination / health certificates', checked: false },
  { id: 'cards-cash', section: 'critical', label: 'Payment cards + emergency cash (USD / NPR / JPY)', checked: false },
  { id: 'license-idp', section: 'critical', label: "Driver's license + International Driving Permit", checked: false },
  { id: 'document-copies', section: 'critical', label: 'Photocopies + cloud scans of every document', checked: false },
  { id: 'emergency-contacts', section: 'critical', label: 'Emergency contacts & embassy details sheet', checked: false },
  // ── Day-zero readiness (pre-departure) ──────────────────────────────────────
  { id: 'online-checkin', section: 'dayzero', label: 'Online check-in completed', checked: false },
  { id: 'boarding-passes-offline', section: 'dayzero', label: 'Boarding passes saved offline', checked: false },
  { id: 'esim-data', section: 'dayzero', label: 'eSIM / data plan activated', checked: false },
  { id: 'home-utilities', section: 'dayzero', label: 'Home power, water & gas shut off', checked: false },
  { id: 'medications-packed', section: 'dayzero', label: 'Prescription meds + basics packed', checked: false },
  { id: 'chargers-adapters', section: 'dayzero', label: 'Chargers, cables & Type-A/C power adapters', checked: false },
  { id: 'luggage-weighed', section: 'dayzero', label: 'Luggage weighed against airline limits', checked: false },
  { id: 'airport-transfer', section: 'dayzero', label: 'Airport transfer / pickup booked', checked: false },
] as const;

/** Country-neutral fallback for a non-default (custom) trip — `DEFAULT_TEMPLATE` minus the 2
 * inherently Nepal/Japan items, with 4 labels genericized. Derived (filter + override), never a
 * second literal, so the 12 untouched items can't drift from `DEFAULT_TEMPLATE` on a future edit. */
const UNIVERSAL_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'flight-tickets': 'Flight e-tickets saved offline',
  'cards-cash': 'Payment cards + emergency cash',
  'passport-validity': 'Passport valid 6+ months beyond your return date',
  'chargers-adapters': 'Chargers, cables & power adapters',
};
export const UNIVERSAL_TEMPLATE: readonly DocItem[] = DEFAULT_TEMPLATE.filter(
  (i) => i.id !== 'nepal-visa' && i.id !== 'japan-entry'
).map((i) => (UNIVERSAL_LABEL_OVERRIDES[i.id] ? { ...i, label: UNIVERSAL_LABEL_OVERRIDES[i.id] } : i));

/**
 * Coerce any parsed-from-storage value into a valid `DocItem`, or `null` when too malformed to
 * salvage (no id, no label, or an invalid section). `checked` coerces to a strict boolean. The
 * optional `note` and the additive sync stamps (`rev`/`hlc`/`deleted`/`updatedAt`/`updatedBy`) are
 * preserved verbatim WHEN present with the right type, dropped otherwise — so a dormant slot round-
 * trips with no sync fields, and a synced slot keeps its merge stamps. TOTAL.
 *
 * UNDECLARED keys: DROPPED by default, kept only for `keepUnknownKeys` (#138). The default is the
 * field-by-field rebuild this has always been, and every LOCAL caller takes it (`loadDocs`/
 * `saveDocs`, `lib/trip-backup.ts`). The flag is set at exactly ONE call site — `docToRows`
 * (lib/docs-remote.ts), the REMOTE read — because that is where the loss lives: since D-365 the
 * sanitized row is merged and written straight back up by `pushChecklistMerged`, so an allowlist
 * there let an older client erase a newer client's fields from the server. Validation is identical
 * either way; only undeclared keys differ. Default-strict, so a new caller gets the safe behaviour.
 */
export function sanitizeItem(value: unknown, opts: SanitizeOptions = {}): DocItem | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.trim() === '') return null;
  if (typeof v.label !== 'string' || v.label.trim() === '') return null;
  if (!isDocSection(v.section)) return null;
  const item: DocItem = {
    ...(opts.keepUnknownKeys ? (value as DocItem) : ({} as Partial<DocItem>)),
    id: v.id,
    section: v.section,
    label: v.label,
    checked: v.checked === true,
  };
  if (typeof v.note === 'string' && v.note.trim() !== '') item.note = v.note;
  else delete item.note;
  if (typeof v.rev === 'number') item.rev = v.rev;
  else delete item.rev;
  if (typeof v.hlc === 'string') item.hlc = v.hlc;
  else delete item.hlc;
  if (v.deleted === true) item.deleted = true;
  else delete item.deleted;
  if (typeof v.updatedAt === 'string') item.updatedAt = v.updatedAt;
  else delete item.updatedAt;
  if (typeof v.updatedBy === 'string') item.updatedBy = v.updatedBy;
  else delete item.updatedBy;
  return item;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `DocItem[]`, deduped by id (last write
 * wins). Returns `fallback` (the built-in template, by convention) when the input is not an array
 * or sanitizes down to zero items — the "seed the template on first load / corrupt slot" path
 * TOTAL — never throws.
 */
export function sanitizeItems(
  value: unknown,
  fallback: readonly DocItem[] = DEFAULT_TEMPLATE,
  opts: SanitizeOptions = {},
): DocItem[] {
  if (!Array.isArray(value)) return [...fallback];
  const byId = new Map<string, DocItem>();
  for (const raw of value) {
    const item = sanitizeItem(raw, opts);
    if (item !== null) byId.set(item.id, item);
  }
  if (byId.size === 0) return [...fallback];
  return Array.from(byId.values());
}

/** Apply the injected sync stamper (under sync only); identity when absent. */
function stamped(item: DocItem, stamp?: DocStamper): DocItem {
  return stamp ? stamp(item) : item;
}

/** Flip the `checked` flag for `id`. Returns a NEW array; a non-matching id is a no-op. TOTAL. */
export function toggleItem(items: readonly DocItem[], id: string, stamp?: DocStamper): DocItem[] {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => (item.id === id ? stamped({ ...item, checked: !item.checked }, stamp) : item));
}

/**
 * Set (or clear) the optional per-item `note` for `id`. An empty/whitespace note removes the field
 * (so a dormant row stays `{id,section,label,checked}`). Returns a NEW array; a non-matching id is
 * a no-op. TOTAL.
 */
export function setNote(items: readonly DocItem[], id: string, note: string, stamp?: DocStamper): DocItem[] {
  const list = Array.isArray(items) ? items : [];
  const trimmed = typeof note === 'string' ? note.trim() : '';
  return list.map((item) => {
    if (item.id !== id) return item;
    const next: DocItem = { ...item };
    if (trimmed === '') delete next.note;
    else next.note = trimmed;
    return stamped(next, stamp);
  });
}

export interface DocsCompletion {
  done: number;
  total: number;
  perSection: Record<DocSection, { done: number; total: number }>;
}

/**
 * `{done, total, perSection}` checked-count across `items` — the pure selector (Trip Wrapped)
 * consumes READ-ONLY for its readiness stat. Tombstoned rows (never produced in v1's fixed
 * template, but defensive) are excluded from both counts. Pure.
 */
export function docsCompletion(items: readonly DocItem[]): DocsCompletion {
  const list: readonly DocItem[] = Array.isArray(items) ? (items as readonly DocItem[]) : [];
  const live = list.filter((i) => i.deleted !== true);
  const perSection: Record<DocSection, { done: number; total: number }> = {
    critical: { done: 0, total: 0 },
    dayzero: { done: 0, total: 0 },
  };
  for (const i of live) {
    if (!isDocSection(i.section)) continue;
    perSection[i.section].total += 1;
    if (i.checked) perSection[i.section].done += 1;
  }
  return {
    done: live.filter((i) => i.checked).length,
    total: live.length,
    perSection,
  };
}
