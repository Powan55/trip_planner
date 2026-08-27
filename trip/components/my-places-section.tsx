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
import { isSafeHref } from '@/lib/safe-href';

/**
 * MyPlacesSection — the user-owned "My places" card grid, its OWN section (NOT merged into the
 * static `RecommendationSection` grids — different card anatomy: no image/rating/bestTime, plan).
 * Rendered filtered by `legId`: on `/nepal/` (legId 'nepal') + `/japan/` (legId 'japan') for the
 * default pack, and on the custom-trip home surface (legId 'main'). Hidden ENTIRELY when this leg has
 * no places (and pre-hydration), so it never shows an empty box on a fresh visit.
 *
 * Card art is a CSS vibe-gradient + icon.
 * A card links out to the first of `resolvedUrl`/`sourceUrl` that passes the href scheme
 * allow-list (`lib/safe-href.ts`), shows the standard "Added" badge via
 * `findPlacements('myplace-'+id)`, opens the shared add-to-plan dialog with a myplace draft, and
 * deletes with the shared undo toast (`lib/undo-toast`).
 */

// The banner is a SCREENED FIELD, not a three-stop gradient: one custom property resolved
// from `data-leg`, mixed at the --now-screen ceiling. A custom trip's leg id is 'main',
// which lands on the Nepal default by construction rather than needing a third branch.
// Declared as the `background` shorthand so an engine without color-mix drops it whole and
// inherits the flat fill underneath — the same fallback order globals.css uses for `.dens`.
const SCREEN = {
  background: 'color-mix(in srgb, var(--now) var(--now-screen), rgb(var(--surface-raised)))',
} as const;

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
  // The LAST boundary, and the one that has to hold: a row already in storage — written by an
  // older client, or synced in from the other member's device — carries whatever it carries, so
  // guarding only the two producers would leave every such row live. First SAFE one wins, no link
  // at all if neither is.
  const link = [place.resolvedUrl, place.sourceUrl].find(
    (u): u is string => !!u && isSafeHref(u),
  );

  const openDialog = () => {
    triggerRef.current = (document.activeElement as HTMLButtonElement) ?? null;
    setDialogOpen(true);
  };

  return (
    // No entrance and no scroll-reveal: the card is present when you arrive.
    <m.div
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      data-testid={`myplace-card-${place.id}`}
      data-leg={place.legId}
      className="rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low overflow-hidden flex flex-col transition-colors hover:border-[color:var(--border-ui)] focus-within:border-[color:var(--border-ui)]"
    >
      {/* No photograph is ever attached to an imported place, so the banner is the
          screened country field rather than a plate. */}
      <div
        className="relative aspect-[16/7] bg-surface-raised flex items-center justify-center"
        style={SCREEN}
      >
        <MapPin className="w-8 h-8 text-ink-lo" aria-hidden="true" />
        <div className="absolute top-3 left-3">
          <AddedBadge added={placements.length > 0} testId={`myplace-added-${place.id}`} />
        </div>
      </div>

      <div className="p-gut flex flex-col gap-3 flex-1">
        <div>
          <h3 className="text-t-body font-semibold text-ink-hi leading-tight">{place.name}</h3>
          {place.note && <p className="text-t-sm text-ink-mid mt-1 line-clamp-2">{place.note}</p>}
        </div>

        <div className="mt-auto flex items-center gap-2">
          <button
            ref={triggerRef}
            type="button"
            onClick={openDialog}
            aria-haspopup="dialog"
            data-testid={`myplace-add-${place.id}`}
            aria-label={`Add ${place.name} to your plan`}
            className={`btn max-w-none flex-1 min-w-0 outline-none focus-visible:outline-none ${
              placements.length > 0 ? '' : 'btn--2'
            }`}
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
              className="shrink-0 grid place-items-center h-tap w-tap rounded-r1 border-hair border-[color:hsl(var(--border))] text-ink-mid transition-colors hover:border-[color:var(--border-ui)] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={onDelete}
            data-testid={`myplace-delete-${place.id}`}
            aria-label={`Delete ${place.name}`}
            className="shrink-0 grid place-items-center h-tap w-tap rounded-r1 border-hair border-[color:hsl(var(--border))] text-ink-mid transition-colors hover:border-[color:hsl(var(--destructive))] hover:text-[color:hsl(var(--destructive))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
          title="My places"
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
