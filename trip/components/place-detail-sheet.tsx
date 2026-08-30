'use client';

import { useId, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import Sheet from '@/components/ui/sheet-dark';
import { X, MapPin, Clock, Star, ExternalLink, CalendarClock, Coins, Check, CalendarDays } from 'lucide-react';
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

/**
 * THE SHEET TREATMENT. The recipe set in `globals.css` has no modal/sheet entry and this
 * is the app's busiest overlay, so the treatment is authored here as four class strings
 * rather than as new recipes — a sheet is a composition of `.plate` + `.list` + `.capline`
 * plus a frame, not a new primitive, and the token layer is not this file's to extend.
 * `import-place-sheet` shares the same `ui/sheet-dark` primitive and should import these
 * four rather than re-deriving them, so the two overlays cannot drift apart.
 *
 * What it is, and why:
 * - THE PANEL FILL IS NOT OURS TO SET. `ui/sheet-dark.tsx` stamps `.sheet-surface`, which
 *   is declared UNLAYERED in globals.css and therefore beats every Tailwind utility
 *   regardless of specificity — a `bg-*` here would be silently inert, not merely
 *   overridden. It is also the one glass recipe the token layer deliberately kept for the
 *   overlay tier. So the treatment governs the panel's GEOMETRY and everything INSIDE it,
 *   and leaves the fill alone rather than fighting it with `!important`.
 * - INSTRUMENT GEOMETRY at the corners: `--r-3`, not the surviving 40px `--radius-2xl`.
 *   A 40px corner on a 6px system is the one place the old scale shows through.
 * - TWO 2px RULES, top and bottom, mirroring `.head`'s `border-bottom: 2px`. The head band
 *   and the pinned footer are the printed page's head and foot; the scroll region between
 *   them is the page, and the foot takes an opaque `--surface-1` so the pinned actions
 *   never read as floating over the body.
 * - The head band is a running head, not a masthead: a `--t-micro` key over a `--t-label`
 *   value. The display title does not carry the screen here either.
 * - The close control sits on the FIELD, never on the photograph. A focus ring drawn
 *   inside a saturated fill measures 1.00:1 — i.e. no ring at all — and a control parked
 *   on a photograph has the same problem with no fixed value to measure against.
 * - The photograph is a `.plate`: halftone + ramp, captioned on a ruled `.capline`
 *   BENEATH it. No text is ever set over the image.
 * - The practical rows are a `.list`: `var(--tap)` minimum, hairline separators, zero
 *   backgrounds and zero shadows.
 */
export const SHEET_PANEL = 'rounded-t-r3 sm:rounded-t-none sm:rounded-l-r3';
export const SHEET_HEAD =
  'shrink-0 flex items-center justify-between gap-3 p-gut py-3 border-b-2 border-[color:hsl(var(--border))]';
export const SHEET_FOOT =
  'shrink-0 p-gut pt-3 pb-5 border-t-2 border-[color:hsl(var(--border))] bg-surface-low space-y-2.5';
export const SHEET_CLOSE =
  'shrink-0 grid place-items-center h-tap w-tap rounded-r1 border-hair border-[color:hsl(var(--border))] text-ink-mid transition-colors hover:border-[color:var(--border-ui)] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

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
  // Country identity is the leg channel, scoped to this sheet by `data-leg` on the panel —
  // the sheet portals to <body>, so it cannot inherit the route's leg and has to declare it.
  const leg = isNepal ? 'nepal' : 'japan';

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
      className={`${SHEET_PANEL} w-full sm:w-[440px] sm:max-w-full sm:h-full max-h-[88vh] sm:max-h-none`}
    >
      {/* The sheet portals to <body>, so it cannot inherit the route's leg. `display:
          contents` declares it without adding a box: custom properties inherit through a
          contents element, and the children stay direct flex items of the panel. */}
      {place && (
        <div data-leg={leg} className="contents">
            {/* The running head. A --t-micro key over a --t-label value, on the same 2px
                rule the app-wide head uses — the close control lives here, on the field,
                rather than parked on the photograph. */}
            <div className={SHEET_HEAD}>
              <div className="min-w-0">
                <span className="pr pr--lo block">{place.country}</span>
                <h3
                  id={titleId}
                  className="vt-shared pr pr--l truncate text-ink-hi"
                  style={{ ['--vt-name']: `place-title-${place.id}` } as CSSProperties}
                >
                  {place.name}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {place.mustSee && (
                  <span className="stamp border-[color:var(--now)] text-now">
                    <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                    Must-see
                  </span>
                )}
                <button
                  type="button"
                  data-testid="place-detail-close"
                  onClick={onClose}
                  aria-label="Close details"
                  className={SHEET_CLOSE}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* The plate. The image is capped at 38vh: on ultra-short viewports (e.g.
                740×360 landscape) the natural 16/10 height (~275px at the 440px
                panel width) would starve the flex column and push the pinned footer below
                the fold. max-h-[38vh] + object-cover crops the image instead, keeping BOTH
                footer actions on-screen. On tall viewports (390×844, 1280×900) 38vh always
                exceeds the natural height, so the cap never binds and the 16/10 framing is
                unchanged. Nothing is set over it — the caption is the ruled line beneath.
                The ratio is `--plate-ar` on the frame because that is what the recipe reads;
                `min-w-full` is load-bearing beside the cap, since a max-height on an
                aspect-ratio box transfers back through the ratio and shrinks the WIDTH. */}
            <div className="plate shrink-0 relative">
              {place.image ? (
                <div className="frame [--plate-ar:16_/_10] max-h-[38vh] min-w-full">
                  <div
                    className="fig vt-shared bg-surface-raised"
                    style={{ ['--vt-name']: `place-photo-${place.id}` } as CSSProperties}
                  >
                    <OptimizedImage
                      src={place.image}
                      alt={place.name}
                      fill
                      sizes="(min-width: 640px) 440px, 100vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="ramp" aria-hidden="true" />
                </div>
              ) : (
                // No photograph for this place: the frame keeps its size and goes hollow.
                <div className="empty-frame m-gut aspect-[16/10] max-h-[38vh] flex flex-col items-center justify-center gap-2">
                  <MapPin className="w-10 h-10 text-ink-lo" aria-hidden="true" />
                  <span className="hollow-tag">No plate on file</span>
                </div>
              )}
              <div className="capline">
                {place.location && (
                  <span className="pr">
                    <MapPin className="mr-1 inline-block h-3 w-3 align-[-1px]" aria-hidden="true" />
                    {place.location}
                  </span>
                )}
                {place.category && <span className="pr pr--lo">{place.category}</span>}
              </div>
            </div>

            {/* Scrollable body — the only scroll region. tabIndex=0 keeps it
                keyboard-reachable (axe scrollable-region-focusable): the body holds only
                read-only text, so at 17px it can scroll with no focusable child of its own. */}
            <div tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-4">
              {bodyText && (
                <p className="p-gut pt-0 text-t-lead text-ink-mid leading-relaxed">{bodyText}</p>
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
                // A `.list` of dt/dd pairs. The wrapping div holds EXACTLY one dt and one
                // dd (axe `only-dlitems`), so the decorative icon lives inside the dt; the
                // label keeps its own fixed box so every value starts at one x-offset.
                <dl className="list mt-4 border-t-hair border-[color:hsl(var(--border))]">
                  {place.bestTime && (
                    <div className="r [--lead:auto] !items-center">
                      <dt className="flex shrink-0 items-center gap-2.5">
                        <Clock className="w-4 h-4 shrink-0 text-ink-lo" aria-hidden="true" />
                        <span className="pr pr--lo w-24 shrink-0">Best time</span>
                      </dt>
                      <dd className="text-t-body text-ink-hi">{place.bestTime}</dd>
                    </div>
                  )}
                  {place.duration && (
                    <div className="r [--lead:auto] !items-center">
                      <dt className="flex shrink-0 items-center gap-2.5">
                        <CalendarClock className="w-4 h-4 shrink-0 text-ink-lo" aria-hidden="true" />
                        <span className="pr pr--lo w-24 shrink-0">Duration</span>
                      </dt>
                      <dd className="text-t-body text-ink-hi">{place.duration}</dd>
                    </div>
                  )}
                  {place.priceHint && (
                    <div className="r [--lead:auto] !items-center">
                      <dt className="flex shrink-0 items-center gap-2.5">
                        <Coins className="w-4 h-4 shrink-0 text-ink-lo" aria-hidden="true" />
                        <span className="pr pr--lo w-24 shrink-0">Price</span>
                      </dt>
                      <dd className="text-t-body text-ink-hi">{place.priceHint}</dd>
                    </div>
                  )}
                  {typeof place.rating === 'number' && place.rating > 0 && (
                    <div className="r [--lead:auto] !items-center">
                      <dt className="flex shrink-0 items-center gap-2.5">
                        <Star className="w-4 h-4 shrink-0 text-ink-lo" aria-hidden="true" />
                        <span className="pr pr--lo w-24 shrink-0">Photo rating</span>
                      </dt>
                      {/* FILLED means committed, unfilled means not yet — so the five slots
                          all render and the unearned ones stay as outlines. A short row of
                          stars and a short row of nothing are the same shape. */}
                      <dd className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-3 h-3 ${
                              i < Math.min(5, Math.max(0, Math.round(place.rating ?? 0)))
                                ? 'fill-current text-ink-hi'
                                : 'text-ink-lo'
                            }`}
                          />
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>

            {/* Pinned footer — Maps link + add-to-plan, always visible. */}
            <div className={SHEET_FOOT}>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--2 max-w-none w-full outline-none focus-visible:outline-none"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Search on Google Maps
                </a>
              )}

              {/* Source-linked add (recs / photos) — the shared state-aware control. */}
              {addSource && addSourceType && (
                <div data-testid="place-detail-add-to-plan" className="[&>button]:mt-0">
                  <AddToPlanButton source={addSource} sourceType={addSourceType} accentColor="text-now" />
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
                      // STRUCK once it is committed to a day; HOLLOW while it is only an
                      // idea. Both keep the same box, so the row never reflows on commit.
                      customIsAdded
                        ? 'btn max-w-none w-full outline-none focus-visible:outline-none'
                        : 'btn btn--2 max-w-none w-full outline-none focus-visible:outline-none'
                    }
                  >
                    {customIsAdded ? (
                      <>
                        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Added</span>
                        <span aria-hidden="true">·</span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3 shrink-0" aria-hidden="true" />
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
                    className="btn btn--2 max-w-none w-full outline-none focus-visible:outline-none"
                  >
                    Add to plan
                  </button>
                )
              )}
            </div>
        </div>
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
