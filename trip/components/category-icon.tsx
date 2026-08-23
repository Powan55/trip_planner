'use client';

import {
  MapPin, UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Plane, Hotel, Coffee, Music,
} from 'lucide-react';
import type { ItineraryCategory } from '@/lib/trip-data';

/**
 * The one category → icon map. Byte-identical copies used to live in
 * `add-to-itinerary-dialog.tsx`, `calendar-sortable-item.tsx` and `expense-dialog.tsx`.
 *
 * It gets its OWN module rather than being exported from `calendar-sortable-item.tsx` (where the
 * calendar already imported it from) because that file pulls `@dnd-kit/core`, `/sortable` and
 * `/utilities` — importing the map from there would drag the whole drag-and-drop runtime into the
 * expense dialog's and the add dialog's chunks for the sake of ten `<svg>`s. This module's only
 * dependency is lucide-react, which every consumer already loads.
 */
export const CATEGORY_ICON_MAP: Record<ItineraryCategory, React.ReactNode> = {
  sightseeing: <MapPin className="w-3.5 h-3.5" />,
  food: <UtensilsCrossed className="w-3.5 h-3.5" />,
  photography: <Camera className="w-3.5 h-3.5" />,
  shopping: <ShoppingBag className="w-3.5 h-3.5" />,
  nature: <Trees className="w-3.5 h-3.5" />,
  cultural: <Landmark className="w-3.5 h-3.5" />,
  transportation: <Plane className="w-3.5 h-3.5" />,
  hotel: <Hotel className="w-3.5 h-3.5" />,
  free: <Coffee className="w-3.5 h-3.5" />,
  nightlife: <Music className="w-3.5 h-3.5" />,
};
