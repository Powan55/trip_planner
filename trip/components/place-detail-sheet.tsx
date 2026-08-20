'use client';

import { useId, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import Sheet from '@/components/ui/sheet-dark';
import { X, MapPin, Clock, Star, ExternalLink, Tag, CalendarClock, Coins, Check, CalendarDays } from 'lucide-react';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import AddToItineraryDialog, { buildMapsPlaceUrl } from '@/components/add-to-itinerary-dialog';
import { formatPlacementSummary, type AddToPlanSource, type SourceType, type ItineraryDraft } from '@/lib/itinerary-adapter';
import { useItineraryContext } from '@/components/itinerary-provider';

/**
 * Shared, responsive place-detail sheet — ONE component that renders as a
 * bottom sheet on mobile and a right-side panel on desktop. It is opened by tapping a
 * card in the recommendation / photography / nightlife guides and shows the full
 * description, practical info, image, a Google Maps research link, and
 * an add-to-plan action.
 *
 * It inherits the full modal contract of the add-to-plan dialog:
 * -: portal to `document.body` (mount-guarded, SSR-safe under output:'export'),
 * so it escapes the transformed / overflow-hidden card ancestors.
 * -: document-level Esc (via `onCloseRef`), a Tab-trap inside the panel,
 * first-element autofocus, and PARENT-OWNED focus-return — the opening card captures
 * the trigger and refocuses it on `AnimatePresence onExitComplete` (NOT here).
 * -: flex-column with a NON-scrolling pinned footer holding the add action, so
 * it stays visible/clickable at any viewport height.
 * - It also sets the `body[data-dialog-open]` seam flag.
 *
 * Add-to-plan (two shapes, so all card families reuse it):
 * - `addSource` + `addSourceType`: a source-linked place (recommendation / photo) —
 * renders the shared state-aware `AddToPlanButton`.
 * - `customAddDraft`: a place with no adapter source (nightlife) — opens the custom
 * add dialog prefilled with the venue's title/location.: when the
 * draft carries a (namespaced) sourceId, the footer control mirrors the source-linked
 * state-aware "Added"/modify/remove treatment; an empty-sourceId draft (none today,
 * kept for shape-compat) still gets the plain static button.
 *
 * Reduced-motion: entrance/exit use opacity + a small translate; the global
 * reduced-motion CSS guard neutralizes transitions, and framer honors prefers-reduced-
 * motion, so nothing is left stuck at opacity-0. Tailwind classes are static literals
 *.
 */

export interface PlaceDetailData {
  /** Stable key for the place (source id or a derived id) — used for React keys. */
  id: string;
  name: string;
  /** Free-form category label shown as a chip (e.g. "Temple", "Sunset", "Cocktail bar"). */
  category?: string;
  /** City / neighbourhood line under the title. */
  location?: string;
  /** Country accent — 'Nepal' → himalaya, 'Japan' → sakura. */
  country: 'Nepal' | 'Japan';
  /** Root-relative image path. */
  image?: string;
  /** Short one-liner (the card's existing description). */
  description?: string;
  /** Longer, accurate description. Falls back to `description`. */
  longDescription?: string;
  /** Practical rows — filled with real facts; each optional. */
  bestTime?: string;
  duration?: string;
  priceHint?: string;
  /** 0-5 photo/quality rating for a star row (optional). */
  rating?: number;
  /** Curated highlight → "Must-see" badge. */
  mustSee?: boolean;
}

export interface PlaceDetailSheetProps {
  open: boolean;
  place: PlaceDetailData | null;
  onClose(): void;
  /** Source-linked add-to-plan (recommendations / photography). */
  addSource?: AddToPlanSource;
  addSourceType?: SourceType;
  /** Custom add-to-plan prefill (nightlife) — opens the custom dialog. */
  customAddDraft?: ItineraryDraft;
  /**
   * Parent-owned focus-return hook: fired once the sheet's exit animation
   * completes. The section captures the card trigger on open and refocuses it here,
   * so focus never gets stuck after the sheet closes.
   */
  onExitComplete?: () => void;
}

export default function PlaceDetailSheet({
  open,
  place,
  onClose,
  addSource,
  addSourceType,
  customAddDraft,
  onExitComplete,
}: PlaceDetailSheetProps) {
  // Custom-add dialog open state (nightlife path). The sheet stays open behind it; the
  // dialog portals over everything. Focus-return for the dialog is parent-owned here.
  // While it is open, the Sheet primitive's Escape is suppressed (disableEscape) so one
  // Esc closes the topmost layer at a time (the nested dialog owns its own Esc).
  const [customOpen, setCustomOpen] = useState(false);
  const customTriggerRef = useRef<HTMLButtonElement | null>(null);

  // reactive "already added" lookup for a non-empty-sourceId customAddDraft
  // (nightlife). Empty sourceId (none today, kept for shape-compat) never matches —
  // `findPlacements('')` reads as "not planned", so this stays a no-op for that shape.
  const { findPlacements } = useItineraryContext();
  const customPlacements = customAddDraft?.sourceId ? findPlacements(customAddDraft.sourceId) : [];
  const customIsAdded = customPlacements.length > 0;
  const customSummary = formatPlacementSummary(customPlacements);

  const baseId = useId();
  const titleId = `${baseId}-sheet-title`;

  const isNepal = place?.country === 'Nepal';

  // coordinate-first when a pin is known. `PlaceDetailData` carries no lat/lng today, so
  // this is currently always the buildMapsSearchUrl(name, location) fallback — swapped for
  // consistency with the other two link-out sites (add-to-itinerary-dialog, calendar-planner).
  const mapsUrl = place ? buildMapsPlaceUrl(place.name, undefined, undefined, place.location) : null;
  const bodyText = place?.longDescription || place?.description;
  const accentText = isNepal ? 'text-himalaya-400' : 'text-sakura-400';
  const accentChipBg = isNepal ? 'bg-himalaya-400/10' : 'bg-sakura-400/10';

  const handleCustomAdd = () => {
    customTriggerRef.current = (document.activeElement as HTMLButtonElement) ?? null;
    setCustomOpen(true);
  };

  return (
    <Sheet
      open={open && place != null}
      onClose={onClose}
      onExitComplete={onExitComplete}
      labelledBy={titleId}
      side="right"
      disableEscape={customOpen}
      testId="place-detail-sheet"
      // Mobile: rises from the bottom (bottom sheet). Desktop (sm+): right side panel.
      className="w-full sm:w-[440px] sm:max-w-full sm:h-full rounded-t-2xl sm:rounded-t-none sm:rounded-l-2xl max-h-[88vh] sm:max-h-none"
    >
      {place && (
        <>
            {/* Non-scrolling header. The image is capped at 38vh: on
                ultra-short viewports (e.g. 740×360 landscape) the natural
                aspect-[16/10] height (~275px at the 440px panel width) would
                starve the flex column and push the pinned footer below the fold.
                max-h-[38vh] + object-cover crops the image instead, keeping BOTH
                footer actions on-screen. On tall viewports (390×844, 1280×900)
                38vh always exceeds the natural height, so the cap never binds and
                the 16/10 framing is unchanged. */}
            <div className="shrink-0 relative">
              {place.image ? (
                <div
                  className="vt-shared relative aspect-[16/10] max-h-[38vh] bg-surface-raised overflow-hidden"
                  style={{ ['--vt-name']: `place-photo-${place.id}` } as CSSProperties}
                >
                  <OptimizedImage
                    src={place.image}
                    alt={place.name}
                    fill
                    sizes="(min-width: 640px) 440px, 100vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface/90 via-surface/20 to-transparent" />
                </div>
              ) : (
                <div className={`aspect-[16/10] max-h-[38vh] flex items-center justify-center ${isNepal ? 'bg-gradient-to-br from-himalaya-500/20 to-surface-raised' : 'bg-gradient-to-br from-sakura-500/20 to-surface-raised'}`}>
                  <MapPin className={`w-10 h-10 opacity-30 ${accentText}`} />
                </div>
              )}
              <button
                type="button"
                data-testid="place-detail-close"
                onClick={onClose}
                aria-label="Close details"
                className="absolute top-3 right-3 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-black/50 hover:bg-black/70 text-ink-hi backdrop-blur-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="w-5 h-5" />
              </button>
              {place.mustSee && (
                <span className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full bg-gold-500/90 text-surface text-[10px] font-bold uppercase tracking-wide">
                  <Star className="w-3 h-3 fill-surface" />
                  Must-see
                </span>
              )}
            </div>

            {/* Scrollable body — the only scroll region. tabIndex=0 keeps it
                keyboard-reachable (axe scrollable-region-focusable): the body holds only
                read-only text, so at 17px it can scroll with no focusable child of its own. */}
            <div tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h3
                  id={titleId}
                  className="vt-shared font-display text-xl font-bold text-white leading-tight"
                  style={{ ['--vt-name']: `place-title-${place.id}` } as CSSProperties}
                >
                  {place.name}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {place.location && (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-mid">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {place.location}
                  </span>
                )}
                {place.category && (
                  <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${accentText} ${accentChipBg}`}>
                    <Tag className="w-2.5 h-2.5" />
                    {place.category}
                  </span>
                )}
              </div>

              {bodyText && (
                <p className="text-sm text-ink-mid leading-relaxed mb-5">{bodyText}</p>
              )}

              {/* Practical info rows — each optional; omitted when unknown.
                  axe's `only-dlitems` requires every direct `<dl>` child to be a
                  `dt`/`dd` (or a wrapping div holding ONLY dt/dd) — the decorative icon
                  used to sit as a THIRD sibling in that wrapping div, which violated it.
                  Fix: each icon now lives INSIDE its `<dt>` (still purely decorative, no
                  text) so the wrapping `<div>` holds exactly one dt + one dd. The label
                  text keeps its ORIGINAL `w-24 shrink-0` box (unchanged,
                  now a `<span>` inside the dt) so it wraps exactly as before; `dt` just
                  flexes the icon and that span together with the same `gap-2.5` the icon
                  used to have as a dl-row sibling — so `<dd>` still starts at the same
                  x-offset (icon 16px + gap 10px + label 96px + gap 10px, unchanged). */}
              {(place.bestTime || place.duration || place.priceHint || typeof place.rating === 'number') && (
                <dl className="space-y-2.5 mb-2">
                  {place.bestTime && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <dt className="flex items-center gap-2.5 shrink-0">
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="text-ink-lo w-24 shrink-0">Best time</span>
                      </dt>
                      <dd className="text-ink-hi">{place.bestTime}</dd>
                    </div>
                  )}
                  {place.duration && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <dt className="flex items-center gap-2.5 shrink-0">
                        <CalendarClock className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
                        <span className="text-ink-lo w-24 shrink-0">Duration</span>
                      </dt>
                      <dd className="text-ink-hi">{place.duration}</dd>
                    </div>
                  )}
                  {place.priceHint && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <dt className="flex items-center gap-2.5 shrink-0">
                        <Coins className="w-4 h-4 text-green-400 shrink-0" aria-hidden="true" />
                        <span className="text-ink-lo w-24 shrink-0">Price</span>
                      </dt>
                      <dd className="text-ink-hi">{place.priceHint}</dd>
                    </div>
                  )}
                  {typeof place.rating === 'number' && place.rating > 0 && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <dt className="flex items-center gap-2.5 shrink-0">
                        <Star className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="text-ink-lo w-24 shrink-0">Photo rating</span>
                      </dt>
                      <dd className="flex items-center gap-0.5">
                        {Array.from({ length: Math.min(5, Math.max(0, Math.round(place.rating))) }).map((_, i) => (
                          <Star key={i} className="w-3 h-3 fill-current text-muted-foreground" />
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>

            {/* Pinned footer — Maps link + add-to-plan, always visible. */}
            <div className="shrink-0 px-5 sm:px-6 pt-3 pb-5 border-t border-white/10 bg-surface/40 space-y-2.5">
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-primary hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  Search on Google Maps
                </a>
              )}

              {/* Source-linked add (recs / photos) — the shared state-aware control. */}
              {addSource && addSourceType && (
                <div data-testid="place-detail-add-to-plan" className="[&>button]:mt-0">
                  <AddToPlanButton source={addSource} sourceType={addSourceType} accentColor={accentText} />
                </div>
              )}

              {/* Custom add (nightlife) — opens the custom dialog prefilled.:
                  a non-empty sourceId (the namespaced nightlife id) gets the same
                  state-aware "Added"/modify-remove treatment as AddToPlanButton; an
                  empty-sourceId draft (none today) keeps the plain static button. */}
              {customAddDraft && (
                customAddDraft.sourceId ? (
                  <button
                    ref={customTriggerRef}
                    type="button"
                    data-testid="place-detail-add-to-plan"
                    onClick={handleCustomAdd}
                    aria-haspopup="dialog"
                    aria-label={
                      customIsAdded
                        ? `${customAddDraft.title} is planned ${customSummary.toLowerCase()}. Modify or remove.`
                        : `Add ${customAddDraft.title} to your trip plan`
                    }
                    className={
                      customIsAdded
                        ? 'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-ring/40 text-primary text-xs font-medium hover:bg-primary/25 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                        : `w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none hover:bg-white/10 ${accentText}`
                    }
                  >
                    {customIsAdded ? (
                      <>
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>Added</span>
                        <span className="text-muted-foreground" aria-hidden="true">·</span>
                        <span className="flex items-center gap-1 text-foreground">
                          <CalendarDays className="w-3 h-3 shrink-0" />
                          {customSummary}
                        </span>
                      </>
                    ) : (
                      'Add to plan'
                    )}
                  </button>
                ) : (
                  <button
                    ref={customTriggerRef}
                    type="button"
                    data-testid="place-detail-add-to-plan"
                    onClick={handleCustomAdd}
                    aria-haspopup="dialog"
                    className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none hover:bg-white/10 ${accentText}`}
                  >
                    Add to plan
                  </button>
                )
              )}
            </div>
        </>
      )}

      {/* Custom-add dialog (nightlife path). Portals over the sheet (via its own
          createPortal), so it stacks above regardless of JSX position; parent-owned
          focus-return to the trigger button on exit-complete. */}
      {customAddDraft && (
        <AnimatePresence
          onExitComplete={() => {
            customTriggerRef.current?.focus?.();
          }}
        >
          {customOpen && (
            <AddToItineraryDialog
              open={customOpen}
              mode="custom"
              draft={customAddDraft}
              existingPlacements={customPlacements}
              onClose={() => setCustomOpen(false)}
            />
          )}
        </AnimatePresence>
      )}
    </Sheet>
  );
}
