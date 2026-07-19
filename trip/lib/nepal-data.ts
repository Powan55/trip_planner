export interface Recommendation {
  id: string;
  name: string;
  category: string;
  description: string;
  bestTime: string;
  duration: string;
  photoRating: number;
  notes: string;
  location?: string;
  image?: string;
  // --- optional enrichment ---
  /** Curated genuine highlight — drives the "Must-see" badge (~5-8 per country). */
  mustSee?: boolean;
  /** Longer, accurate description shown in the detail sheet. Real facts only. */
  longDescription?: string;
  /** Practical fee/price hint (e.g. "NPR 1000 foreigner entry"). Omit if unknown. */
  priceHint?: string;
}

// (v5 Phase 1, track b): this file is now a re-export FACADE over
// `core/content/registry.ts` ( pattern, same as `lib/trip-data.ts` over
// `core/dates`) — same exported names, same values (byte-identical data), so
// every existing consumer here is untouched. The literal guide data lives in
// the registry now, resolved there via `contentRef`/`contentKey`.
export { NEPAL_ATTRACTIONS, NEPAL_FOOD, NEPAL_CATEGORIES } from '@/core/content/registry';
