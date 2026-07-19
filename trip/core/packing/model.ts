/**
 * Packing checklist domain — the pure, framework-free packing-item core. Gateway
 * key 21 stores a `PackingItem[]`.
 *
 * FRAMEWORK-FREE: plain TypeScript — no
 * React, no window, no storage. Every function is TOTAL (a bad/missing/corrupt input degrades to
 * a safe value, never a throw).
 *
 * FIXED TEMPLATE, no empty state: unlike the journal/expenses/favorites domains
 * (which start empty), this domain seeds a fixed built-in template on first load — the checklist
 * items themselves never change shape or count, only their `checked` flag persists. There is no
 * add/remove; `toggleItem` is the only mutator.
 */

export type PackingCategory = 'nepal' | 'japan' | 'universal';

export interface PackingItem {
  id: string;
  label: string;
  category: PackingCategory;
  checked: boolean;
}

const CATEGORIES: readonly PackingCategory[] = ['nepal', 'japan', 'universal'];

/** Type guard: the value is one of the 3 canonical categories. */
export function isPackingCategory(v: unknown): v is PackingCategory {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/**
 * The built-in packing template (28 items — 10 universal, 9 Nepal-leg, 9 Japan-leg), all
 * unchecked. Realistic gear/clothing/toiletries for a Dec 9 Nepal → Japan trip (-style
 * static content, no live data). Ids are stable kebab-case strings — the persistence key.
 */
export const DEFAULT_TEMPLATE: readonly PackingItem[] = [
  // ── Universal (both legs) ────────────────────────────────────────────────
  { id: 'universal-passport-copies', label: 'Passport + printed/digital copies', category: 'universal', checked: false },
  { id: 'universal-travel-insurance', label: 'Travel insurance documents', category: 'universal', checked: false },
  { id: 'universal-phone-charger', label: 'Phone charger + cable', category: 'universal', checked: false },
  { id: 'universal-power-adapter', label: 'Universal power adapter', category: 'universal', checked: false },
  { id: 'universal-water-bottle', label: 'Reusable water bottle', category: 'universal', checked: false },
  { id: 'universal-first-aid', label: 'First-aid kit + basic medications', category: 'universal', checked: false },
  { id: 'universal-sunglasses', label: 'Sunglasses', category: 'universal', checked: false },
  { id: 'universal-daypack', label: 'Daypack / small backpack', category: 'universal', checked: false },
  { id: 'universal-toiletries', label: 'Toiletries kit', category: 'universal', checked: false },
  { id: 'universal-power-bank', label: 'Portable battery pack', category: 'universal', checked: false },
  // ── Nepal leg ─────────────────────────────────────────────────────────────
  { id: 'nepal-trekking-boots', label: 'Trekking boots', category: 'nepal', checked: false },
  { id: 'nepal-base-layers', label: 'Warm base layers', category: 'nepal', checked: false },
  { id: 'nepal-down-jacket', label: 'Down jacket', category: 'nepal', checked: false },
  { id: 'nepal-sleeping-bag-liner', label: 'Sleeping bag liner', category: 'nepal', checked: false },
  { id: 'nepal-water-purification', label: 'Water purification tablets', category: 'nepal', checked: false },
  { id: 'nepal-trekking-poles', label: 'Trekking poles', category: 'nepal', checked: false },
  { id: 'nepal-sun-hat', label: 'Sun hat + buff', category: 'nepal', checked: false },
  { id: 'nepal-sunscreen', label: 'High-SPF sunscreen', category: 'nepal', checked: false },
  { id: 'nepal-cash-npr', label: 'Nepali rupees (cash)', category: 'nepal', checked: false },
  // ── Japan leg ─────────────────────────────────────────────────────────────
  { id: 'japan-winter-coat', label: 'Warm winter coat', category: 'japan', checked: false },
  { id: 'japan-thermal-layers', label: 'Thermal underlayers', category: 'japan', checked: false },
  { id: 'japan-walking-shoes', label: 'Comfortable walking shoes', category: 'japan', checked: false },
  { id: 'japan-pocket-wifi', label: 'Portable Wi-Fi / SIM', category: 'japan', checked: false },
  { id: 'japan-ic-card', label: 'Suica/Pasmo IC card', category: 'japan', checked: false },
  { id: 'japan-umbrella', label: 'Compact umbrella', category: 'japan', checked: false },
  { id: 'japan-gloves-scarf', label: 'Gloves + scarf', category: 'japan', checked: false },
  { id: 'japan-cash-jpy', label: 'Japanese yen (cash)', category: 'japan', checked: false },
  { id: 'japan-slip-on-shoes', label: 'Slip-on shoes (temple visits)', category: 'japan', checked: false },
] as const;

/**
 * Coerce any parsed-from-storage value into a valid `PackingItem`, or `null` when too malformed
 * to salvage (no id, no label, or an invalid category). `checked` coerces to a strict boolean
 * (any non-`true` value reads as `false`). TOTAL.
 */
export function sanitizeItem(value: unknown): PackingItem | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Partial<Record<keyof PackingItem, unknown>>;
  if (typeof v.id !== 'string' || v.id.trim() === '') return null;
  if (typeof v.label !== 'string' || v.label.trim() === '') return null;
  if (!isPackingCategory(v.category)) return null;
  return { id: v.id, label: v.label, category: v.category, checked: v.checked === true };
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `PackingItem[]`, deduped by id (last
 * write wins). Returns `fallback` (the built-in template, by convention) when the input is not an
 * array or sanitizes down to zero items — this is the "seed the template on first load / corrupt
 * slot" path. TOTAL — never throws.
 */
export function sanitizeItems(value: unknown, fallback: readonly PackingItem[] = DEFAULT_TEMPLATE): PackingItem[] {
  if (!Array.isArray(value)) return [...fallback];
  const byId = new Map<string, PackingItem>();
  for (const raw of value) {
    const item = sanitizeItem(raw);
    if (item !== null) byId.set(item.id, item);
  }
  if (byId.size === 0) return [...fallback];
  return Array.from(byId.values());
}

/** Flip the `checked` flag for `id`. Returns a NEW array; a non-matching id is a no-op. TOTAL. */
export function toggleItem(items: readonly PackingItem[], id: string): PackingItem[] {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item));
}

/** `{ checked, total }` packed count across `items` (e.g. for a "12/28 packed" indicator). Pure. */
export function packingProgress(items: readonly PackingItem[]): { checked: number; total: number } {
  const list = Array.isArray(items) ? items : [];
  return { checked: list.filter((i) => i.checked).length, total: list.length };
}
