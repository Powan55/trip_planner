import type { ItineraryCategory } from '@/lib/trip-data';
import type { Recommendation } from '@/lib/nepal-data';
import type { PhotoSpot } from '@/lib/photography-data';
import type { MapMarker } from '@/lib/map-data';
import type { FeaturedDestination } from '@/lib/travel-tips-data';

/**
 * Place -> ItineraryItem adapter.
 *
 * Every place card converts its source record into a prefilled candidate
 * (`ItineraryDraft`) through this ONE shared adapter, so "what category / notes /
 * duration does this place get" is decided in exactly one place across all four
 * card families. The user still picks date/time in the dialog.
 *
 * "Already added" is a pure `sourceId` equality — no fuzzy matching —
 * resolved at the card via `findPlacements(sourceId)`.
 *
 * All four source types (`'recommendation' | 'photo' | 'map' | 'featured'`) are
 * handled here so no card family reimplements the conversion.
 */

export type SourceType = 'recommendation' | 'photo' | 'map' | 'featured';

/** The union of every source record an add-to-plan control can accept. */
export type AddToPlanSource =
  | Recommendation
  | PhotoSpot
  | MapMarker
  | FeaturedDestination;

/**
 * Derive a stable, collision-free `sourceId` for a Featured destination.
 * Featured records have NO `id`, so it is slugged from the name:
 * "Boudhanath Stupa" -> "featured-boudhanath-stupa".
 * Exported so any other surface that needs the same id derives it identically.
 */
export function featuredSourceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `featured-${slug}`;
}

/**
 * The prefilled add-to-plan candidate. The user fills date (always) and may edit
 * time/category/duration/notes in the dialog before confirming.
 */
export interface ItineraryDraft {
  title: string;
  location?: string;
  notes?: string;
  category: ItineraryCategory;
  duration?: string;
  time?: string;
  sourceId: string;
  sourceType: SourceType;
}

/**
 * Source-category -> ItineraryCategory normalization.
 *
 * Source `category` strings are free-form (across NEPAL/JAPAN/PHOTO/MARKER
 * vocabularies) and must collapse to the canonical `ItineraryCategory` union.
 * Keys are LOWERCASED; lookups normalize the input to lowercase. Anything not
 * present here falls through to the default `sightseeing` (covers Attraction,
 * Hidden Gem, Day Trip, Experience, Anime, ...).
 *
 * `transportation` / `free` / `nightlife` are never produced by the adapter (no
 * source vocabulary maps to them) but remain user-selectable in the dialog.
 *
 * This mapping is DATA, not behavior — extending it for a new source category is
 * a purely additive edit.
 */
export const CATEGORY_MAP: Record<string, ItineraryCategory> = {
  // food family
  food: 'food',
  'café': 'food',
  cafe: 'food',
  restaurant: 'food',
  ramen: 'food',
  sushi: 'food',
  'street food': 'food',
  dessert: 'food',
  // cultural family
  temple: 'cultural',
  cultural: 'cultural',
  'must-see': 'cultural',
  'must-visit': 'cultural',
  // photography family
  photography: 'photography',
  'photo spot': 'photography',
  sunrise: 'photography',
  sunset: 'photography',
  night: 'photography',
  architecture: 'photography',
  instagram: 'photography',
  street: 'photography',
  // nature family
  nature: 'nature',
  scenic: 'nature',
  winter: 'nature',
  // single-mapping families
  shopping: 'shopping',
  hotel: 'hotel',
};

/**
 * Map a free-form source category to a canonical `ItineraryCategory`.
 * Case-insensitive; defaults to `sightseeing` for any unmapped value.
 */
export function normalizeCategory(raw: string | undefined | null): ItineraryCategory {
  if (!raw) return 'sightseeing';
  return CATEGORY_MAP[raw.trim().toLowerCase()] ?? 'sightseeing';
}

/**
 * Build an `ItineraryDraft` from a source record + its sourceType.
 *
 * A `switch` on `sourceType` so each card family has exactly one mapping entry.
 * Overloads keep each call site precisely typed: a `'recommendation'` source is a
 * `Recommendation`, `'photo'` a `PhotoSpot`, `'map'` a `MapMarker`, `'featured'` a
 * `FeaturedDestination`. The `unknown`/`SourceType` overload is the generic path
 * used by `AddToPlanButton`, which is discriminated by its own `sourceType` prop.
 *
 * @param source     the source record for the given card family
 * @param sourceType which card family produced it
 */
export function toItineraryDraft(source: Recommendation, sourceType: 'recommendation'): ItineraryDraft;
export function toItineraryDraft(source: PhotoSpot, sourceType: 'photo'): ItineraryDraft;
export function toItineraryDraft(source: MapMarker, sourceType: 'map'): ItineraryDraft;
export function toItineraryDraft(source: FeaturedDestination, sourceType: 'featured'): ItineraryDraft;
export function toItineraryDraft(source: AddToPlanSource, sourceType: SourceType): ItineraryDraft;
export function toItineraryDraft(source: unknown, sourceType: SourceType): ItineraryDraft;
export function toItineraryDraft(source: unknown, sourceType: SourceType): ItineraryDraft {
  switch (sourceType) {
    case 'recommendation': {
      const rec = source as Recommendation;
      return {
        title: rec.name,
        location: rec.location,
        notes: rec.notes || undefined,
        category: normalizeCategory(rec.category),
        duration: rec.duration || undefined,
        // bestTime is a free-text hint ("Sunrise", "Early morning"), not a clock
        // time — leave `time` for the user to set in the dialog.
        time: undefined,
        sourceId: rec.id,
        sourceType: 'recommendation',
      };
    }
    case 'photo': {
      // PhotoSpot {id,name,country,city,bestTime,style,gear,tip,category,image?}.
      const spot = source as PhotoSpot;
      return {
        title: spot.name,
        location: spot.city,
        notes: spot.tip || undefined,
        category: normalizeCategory(spot.category),
        // Photo spots carry no duration; bestTime ("Sunrise (6:00-7:00 AM)") is a
        // free-text hint, not a clock time — leave `time` for the user.
        duration: undefined,
        time: undefined,
        sourceId: spot.id,
        sourceType: 'photo',
      };
    }
    case 'map': {
      // MapMarker {id,name,category,country,area,description,x,y,image?}.
      const marker = source as MapMarker;
      return {
        title: marker.name,
        location: marker.area,
        notes: marker.description || undefined,
        category: normalizeCategory(marker.category),
        duration: undefined,
        time: undefined,
        sourceId: marker.id,
        sourceType: 'map',
      };
    }
    case 'featured': {
      // FeaturedDestination {name,country,blurb,emoji,image?} — NO id, NO category:
      // derive a stable sourceId from the name; category is always
      // 'sightseeing'; location/duration/time are undefined; notes = blurb.
      const dest = source as FeaturedDestination;
      return {
        title: dest.name,
        location: undefined,
        notes: dest.blurb || undefined,
        category: 'sightseeing',
        duration: undefined,
        time: undefined,
        sourceId: featuredSourceId(dest.name),
        sourceType: 'featured',
      };
    }
    default: {
      // Exhaustiveness guard — a new SourceType must extend the switch.
      const _exhaustive: never = sourceType;
      throw new Error(`toItineraryDraft: unknown sourceType "${String(_exhaustive)}".`);
    }
  }
}
