'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { MapPin, ExternalLink, Trash2 } from 'lucide-react';
import { SectionHeading } from '@/components/section-heading';
import AddedBadge from '@/components/added-badge';
import AddToItineraryDialog from '@/components/add-to-itinerary-dialog';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useMyPlaces } from '@/hooks/use-my-places';
import type { MyPlace } from '@/core/places/model';
import type { ItineraryDraft } from '@/lib/itinerary-adapter';
import { showUndoToast } from '@/lib/undo-toast';

/**
 * MyPlacesSection — the user-owned "My places" card grid, its OWN section (NOT merged into the
 * static `RecommendationSection` grids — different card anatomy: no image/rating/bestTime, plan).
 * Rendered filtered by `legId`: on `/nepal/` (legId 'nepal') + `/japan/` (legId 'japan') for the
 * default pack, and on the custom-trip home surface (legId 'main'). Hidden ENTIRELY when this leg has
 * no places (and pre-hydration), so it never shows an empty box on a fresh visit.
 *
 * Card art is a CSS vibe-gradient + icon.
 * A card links out to `resolvedUrl ?? sourceUrl`, shows the standard "Added" badge via
 * `findPlacements('myplace-'+id)`, opens the shared add-to-plan dialog with a myplace draft, and
 * deletes with the shared undo toast (`lib/undo-toast`).
 */

// Leg-keyed CSS gradient for the card banner (Himalayan warmth for Nepal, winter-neon for Japan,
// a neutral premium sweep otherwise — CSS/gradient art only, D-imagery rule).
function bannerGradient(legId: string): string {
  if (legId === 'nepal') return 'from-orange-500/30 via-rose-500/20 to-amber-400/20';
  if (legId === 'japan') return 'from-sky-500/30 via-indigo-500/20 to-fuchsia-400/20';
  return 'from-gold-500/25 via-white/10 to-gold-400/15';
}

function toDraft(place: MyPlace): ItineraryDraft {
  return {
    title: place.name,
    location: undefined,
    notes: place.note,
    category: 'sightseeing',
    duration: undefined,
    time: undefined,
    sourceId: `myplace-${place.id}`,
    sourceType: 'recommendation',
  };
}

function MyPlaceCard({ place, onDelete }: { place: MyPlace; onDelete: () => void }) {
  const { findPlacements } = useItineraryContext();
  const reduce = useReducedMotion();
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const sourceId = `myplace-${place.id}`;
  const placements = findPlacements(sourceId);
  const link = place.resolvedUrl ?? place.sourceUrl;

  const openDialog = () => {
    triggerRef.current = (document.activeElement as HTMLButtonElement) ?? null;
    setDialogOpen(true);
  };

  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      data-testid={`myplace-card-${place.id}`}
      className="glass-card rounded-2xl overflow-hidden flex flex-col"
    >
      {/* Gradient banner (no photo — CSS art). */}
      <div className={`relative aspect-[16/7] bg-gradient-to-br ${bannerGradient(place.legId)} flex items-center justify-center`}>
        <MapPin className="w-8 h-8 text-white/60" aria-hidden="true" />
        <div className="absolute top-3 left-3">
          <AddedBadge added={placements.length > 0} testId={`myplace-added-${place.id}`} />
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <h3 className="font-display font-bold text-white text-sm leading-tight">{place.name}</h3>
          {place.note && <p className="text-[11px] text-white/40 mt-1 italic line-clamp-2">{place.note}</p>}
        </div>

        <div className="mt-auto flex items-center gap-2">
          <button
            ref={triggerRef}
            type="button"
            onClick={openDialog}
            aria-haspopup="dialog"
            data-testid={`myplace-add-${place.id}`}
            aria-label={`Add ${place.name} to your plan`}
            className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium text-white/70 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            {placements.length > 0 ? 'Added · edit plan' : 'Add to plan'}
          </button>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`myplace-link-${place.id}`}
              aria-label={`Open ${place.name} in Google Maps`}
              className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-gold-300 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={onDelete}
            data-testid={`myplace-delete-${place.id}`}
            aria-label={`Delete ${place.name}`}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:bg-red-500/20 hover:text-red-300 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <AnimatePresence onExitComplete={() => triggerRef.current?.focus?.()}>
        {dialogOpen && (
          <AddToItineraryDialog
            open={dialogOpen}
            draft={toDraft(place)}
            existingPlacements={placements}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </AnimatePresence>
    </m.div>
  );
}

export default function MyPlacesSection({ legId }: { legId: string }) {
  const { places, hydrated, addPlace, removePlace } = useMyPlaces();

  // Hidden entirely pre-hydration and when this leg has no places (no empty box on a fresh visit).
  if (!hydrated) return null;
  const legPlaces = places.filter((p) => p.legId === legId);
  if (legPlaces.length === 0) return null;

  const handleDelete = (place: MyPlace) => {
    removePlace(place.id);
    showUndoToast(`Removed “${place.name}”`, () => addPlace(place));
  };

  return (
    <section id={`my-places-${legId}`} aria-labelledby={`my-places-${legId}-heading`} className="py-16 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id={`my-places-${legId}-heading`}
          className="mb-10"
          title={<>My <span className="text-gradient-gold">places</span></>}
          subtitle="Spots you imported from Google Maps."
        />
        <div data-testid={`my-places-grid-${legId}`} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {legPlaces.map((place) => (
            <MyPlaceCard key={place.id} place={place} onDelete={() => handleDelete(place)} />
          ))}
        </div>
      </div>
    </section>
  );
}
