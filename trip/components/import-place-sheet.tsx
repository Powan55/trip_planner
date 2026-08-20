'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import Sheet from '@/components/ui/sheet-dark';
import { X, Check, Link2, Search, Loader2, ChevronDown } from 'lucide-react';
import {
  TRIP_DATES,
  formatDate,
  type ItineraryCategory,
  CATEGORY_COLORS,
} from '@/lib/trip-data';
import { placeLabelForDate } from '@/lib/leg-label';
import { generateItemId } from '@/lib/item-id';
import { getActiveTrip } from '@/core/trips';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useMyPlaces } from '@/hooks/use-my-places';
import { inferLegId, isGooglePlaceUrl } from '@/core/places/model';
import { resolvePlaceLink } from '@/lib/place-resolve';

/**
 * ImportPlaceSheet — the ALWAYS-SHOWN confirm step for importing a Google place as a
 * user-owned "My place". Portal dialog copying the
 * contract from `add-to-itinerary-dialog.tsx` verbatim (portal to body with a mount guard,
 * document-level Esc, a lightweight Tab-trap, first-field autofocus, ≥44px targets, reduced-motion
 * via framer's global CSS, parent-owned focus return on `AnimatePresence onExitComplete`).
 *
 * It works FULLY MANUALLY: the Worker resolution (`lib/place-resolve.ts`) only PRE-FILLS the fields
 * and NEVER blocks — if it returns null (dormant Worker / unreachable / format drift) the user just
 * types the name themselves. This is why the feature ships before the Worker's /resolve route.
 *
 * Confirm ALWAYS writes the `MyPlace` (via `useMyPlaces`); it ALSO writes a plan item (via
 * `useItineraryContext().addItem`, `sourceId: 'myplace-'+id`, `sourceType: 'recommendation'` — the
 * vault enum is untouched, D-plan) only when the collapsed "Also add to plan" section has a day.
 */

const ALL_CATEGORIES: ItineraryCategory[] = [
  'sightseeing', 'food', 'photography', 'shopping', 'nature',
  'cultural', 'transportation', 'hotel', 'free', 'nightlife',
];

// "Tue, Dec 12 · Kathmandu, Nepal" (mirrors the add-to-plan dialog's dateOptionLabel —:
// both now go through the one shared place-label helper instead of mirroring a hardcoded pair).
function dateOptionLabel(dateStr: string): string {
  return `${formatDate(dateStr)} · ${placeLabelForDate(dateStr)}`;
}

function newPlaceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ImportPlaceSheetProps {
  open: boolean;
  /** A pre-known link — displayed read-only and auto-resolved on open. */
  initialUrl?: string;
  /** Paste mode (the /share header entry): the URL field is editable with a "Look up" action. */
  urlEditable?: boolean;
  onClose(): void;
  /** Fires AFTER a successful save (before onClose). The inbox path uses it to drop the source
   * row only on a real import — onClose alone can't distinguish a save from a cancel. */
  onImported?(): void;
  /** parent-owned focus-return, fired on the Sheet's exit-complete. */
  onExitComplete?(): void;
}

export default function ImportPlaceSheet({ open, initialUrl, urlEditable = false, onClose, onImported, onExitComplete }: ImportPlaceSheetProps) {
  const { addPlace } = useMyPlaces();
  const { addItem } = useItineraryContext();

  // The active trip's legs decide whether a country/leg choice is shown (default pack) or auto-
  // assigned (a single-leg custom trip → 'main'). Resolved once per mount (a pack switch reloads).
  const config = useMemo(() => getActiveTrip(), []);
  const legs = config.legs;
  const multiLeg = legs.length > 1;

  // Form state.
  const [url, setUrl] = useState(initialUrl ?? '');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [legId, setLegId] = useState(legs[0]?.id ?? 'main');
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(undefined);
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({});
  const [status, setStatus] = useState<'idle' | 'resolving' | 'found' | 'notfound'>('idle');
  const [showAddToPlan, setShowAddToPlan] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(TRIP_DATES[0]);
  const [category, setCategory] = useState<ItineraryCategory>('sightseeing');

  // Re-seed on every (re)open so a reused instance never shows stale values.
  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl ?? '');
    setName('');
    setNote('');
    setLegId(legs[0]?.id ?? 'main');
    setResolvedUrl(undefined);
    setCoords({});
    setStatus('idle');
    setShowAddToPlan(false);
    setSelectedDate(TRIP_DATES[0]);
    setCategory('sightseeing');
    lastResolvedRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  // Single-flight guard so the same URL is never resolved twice.
  const lastResolvedRef = useRef<string | null>(null);

  const runResolve = async (candidate: string) => {
    const u = candidate.trim();
    if (!isGooglePlaceUrl(u) || lastResolvedRef.current === u) return;
    lastResolvedRef.current = u;
    setStatus('resolving');
    const hints = await resolvePlaceLink(u);
    if (!hints) {
      setStatus('notfound');
      return;
    }
    setStatus('found');
    if (hints.finalUrl) setResolvedUrl(hints.finalUrl);
    if (typeof hints.lat === 'number' || typeof hints.lng === 'number') {
      setCoords({ lat: hints.lat, lng: hints.lng });
    }
    // Only pre-fill the name if the user hasn't typed one.
    setName((prev) => (prev.trim() === '' && hints.name ? hints.name : prev));
    // Pre-select the country/leg from the resolved coords (default pack only).
    if (multiLeg) {
      const inferred = inferLegId(config, hints.lat, hints.lng);
      if (inferred) setLegId(inferred);
    }
  };

  // Auto-resolve a pre-known link (the inbox path) once on open.
  useEffect(() => {
    if (!open) return;
    if (initialUrl && isGooglePlaceUrl(initialUrl)) void runResolve(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const urlFieldId = `${baseId}-url`;
  const nameFieldId = `${baseId}-name`;
  const noteFieldId = `${baseId}-note`;
  const legLabelId = `${baseId}-leg`;
  const dateFieldId = `${baseId}-date`;
  const catLabelId = `${baseId}-cat`;

  // Autofocus target on open (passed to the Sheet primitive): the URL input in paste
  // mode, else the Name input. The shared Sheet owns the rest of the contract
  // (portal, Esc, Tab-trap, body-flag, focus-return) —.
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const nameValid = name.trim().length > 0;

  const handleConfirm = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return; // guard (button also disabled)
    const id = newPlaceId();
    addPlace({
      id,
      name: trimmedName,
      legId,
      sourceUrl: url.trim() || undefined,
      resolvedUrl,
      lat: coords.lat,
      lng: coords.lng,
      note: note.trim() || undefined,
    });
    if (showAddToPlan && selectedDate) {
      addItem(selectedDate, {
        id: generateItemId(),
        title: trimmedName,
        category,
        sourceId: `myplace-${id}`,
        sourceType: 'recommendation',
        // — the actual link->pin bug: coords were resolved into local state (already used
        // above to pre-select the country leg) but never carried onto the plan item itself, so
        // even a perfect resolve produced no marker. stopMarkerFor (lib/itinerary-map.ts) already
        // prefers a manual pin over the name/sourceId join, so passing them through here is the
        // whole fix — the item plots immediately and the pin is reload-persistent like any other
        // item's lat/lng. Both undefined
        // is a no-op, same as never setting the field.
        lat: coords.lat,
        lng: coords.lng,
      });
      toast.success(`Saved “${trimmedName}” and added it to ${formatDate(selectedDate)}`);
    } else {
      toast.success(`Saved “${trimmedName}” to your places`);
    }
    onImported?.();
    onClose();
  };

  // AMENDMENT: a successful resolve very often returns a name with NO coordinates — the
  // dominant `share.google` share form has no pin anywhere in its redirect target, live-verified
  // in. That is the expected ceiling, not a bug, so it gets its own calm line rather than the
  // generic "Found this place" text implying a pin landed.
  const resolvedHasPin = typeof coords.lat === 'number' && typeof coords.lng === 'number';

  // A non-Google url typed into the editable field is an INPUT problem, not a resolve outcome —
  // derived straight off the current text (not `status`) so it updates the instant the field
  // becomes invalid/valid again, independent of whatever an earlier resolve on different text said.
  // Only meaningful in paste mode (urlEditable) — the read-only inbox path is always pre-screened.
  const invalidLink = urlEditable && url.trim() !== '' && !isGooglePlaceUrl(url.trim());

  const statusLine = invalidLink
    ? "That doesn't look like a Google Maps share link — open the place in Google Maps, tap Share, and paste that link."
    : status === 'resolving' ? 'Reading this link…'
      : status === 'found'
        ? resolvedHasPin
          ? 'Found this place — check the details below.'
          : "Found this place — no map pin came with this link. The name's filled in; you can add a pin yourself later."
        : status === 'notfound' ? "Couldn't read this link — fill in the name yourself."
          : null;

  // "notfound" and an invalid link are the two states that need the user to do something
  // differently; a coords-less "found" is a success path and must NOT read as a warning.
  const statusIsWarning = status === 'notfound' || invalidLink;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      labelledBy={titleId}
      side="center"
      initialFocusRef={firstFieldRef}
      testId="import-place-sheet"
      className="w-full max-w-md rounded-2xl max-h-[90vh]"
    >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 shrink-0">
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-lg font-bold text-white leading-tight">
              Import a place
            </h3>
            <p className="text-sm text-ink-mid mt-0.5">Save a spot from a Google Maps link.</p>
          </div>
          <button
            type="button"
            data-testid="import-place-cancel"
            onClick={onClose}
            aria-label="Close dialog"
            className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg hover:bg-white/10 text-ink-mid outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6">
          <div className="space-y-4">
            {/* Link */}
            <div>
              <label htmlFor={urlFieldId} className="text-xs text-ink-mid mb-1 block">
                Google Maps link
              </label>
              {urlEditable ? (
                <div className="flex gap-2">
                  <input
                    id={urlFieldId}
                    ref={firstFieldRef}
                    data-testid="import-place-url-input"
                    value={url}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void runResolve(url);
                      }
                    }}
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://maps.app.goo.gl/…"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2"
                  />
                  <button
                    type="button"
                    data-testid="import-place-lookup"
                    onClick={() => void runResolve(url)}
                    disabled={!isGooglePlaceUrl(url.trim()) || status === 'resolving'}
                    className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-white/5 border border-white/10 text-xs text-ink-hi hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {status === 'resolving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    Look up
                  </button>
                </div>
              ) : (
                <p
                  id={urlFieldId}
                  data-testid="import-place-url-readonly"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-ink-hi"
                >
                  <Link2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate break-all">{url || 'No link'}</span>
                </p>
              )}
              {statusLine && (
                <p
                  data-testid="import-place-status"
                  role="status"
                  className={`mt-1.5 text-xs ${statusIsWarning ? 'text-amber-300/80' : 'text-ink-mid'}`}
                >
                  {statusLine}
                </p>
              )}
            </div>

            {/* Name (required) */}
            <div>
              <label htmlFor={nameFieldId} className="text-xs text-ink-mid mb-1 block">Name *</label>
              <input
                id={nameFieldId}
                ref={urlEditable ? undefined : firstFieldRef}
                data-testid="import-place-name-input"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                autoComplete="off"
                placeholder="e.g., Fushimi Inari Shrine"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2"
              />
            </div>

            {/* Country/leg radio — default pack only (a custom trip auto-assigns 'main'). */}
            {multiLeg && (
              <div>
                <span id={legLabelId} className="text-xs text-ink-mid mb-1 block">Country</span>
                {/* B-5: `role="group"` + `aria-pressed`, not radiogroup/radio — the composite
                    role promises arrow-key navigation this toggle never implemented. */}
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby={legLabelId}>
                  {legs.map((leg) => {
                    const active = legId === leg.id;
                    return (
                      <button
                        key={leg.id}
                        type="button"
                        aria-pressed={active}
                        data-testid={`import-place-leg-${leg.id}`}
                        onClick={() => setLegId(leg.id)}
                        className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                          active ? 'bg-primary/10 border border-ring/40 text-primary' : 'bg-white/5 border border-white/10 text-ink-mid hover:bg-white/10'
                        }`}
                      >
                        {leg.countryLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Note (optional) */}
            <div>
              <label htmlFor={noteFieldId} className="text-xs text-ink-mid mb-1 block">Note</label>
              <textarea
                id={noteFieldId}
                data-testid="import-place-note-input"
                value={note}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                rows={2}
                placeholder="Why you saved it…"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2 resize-none"
              />
            </div>

            {/* Also add to plan (collapsed by default) */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03]">
              <button
                type="button"
                data-testid="import-place-toggle-plan"
                onClick={() => setShowAddToPlan((v) => !v)}
                aria-expanded={showAddToPlan}
                className="w-full flex items-center justify-between gap-2 min-h-[44px] px-3 text-sm text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-xl"
              >
                <span>Also add to plan</span>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${showAddToPlan ? 'rotate-180' : ''}`} />
              </button>
              {showAddToPlan && (
                <div className="px-3 pb-3 space-y-3">
                  <div>
                    <label htmlFor={dateFieldId} className="text-xs text-ink-mid mb-1 block">Day</label>
                    <select
                      id={dateFieldId}
                      data-testid="import-place-day-select"
                      value={selectedDate}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2"
                    >
                      {TRIP_DATES.map((d) => (
                        <option key={d} value={d} className="bg-surface text-white">
                          {dateOptionLabel(d)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span id={catLabelId} className="text-xs text-ink-mid mb-1 block">Category</span>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2" role="group" aria-labelledby={catLabelId}>
                      {ALL_CATEGORIES.map((cat) => {
                        const colors = CATEGORY_COLORS[cat];
                        const active = category === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setCategory(cat)}
                            aria-pressed={active}
                            aria-label={`Category: ${cat}`}
                            data-testid={`import-place-cat-${cat}`}
                            className={`min-h-[44px] px-1 rounded-lg text-[10px] capitalize leading-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                              active ? `${colors.bg} ${colors.text} ring-1 ${colors.border}` : 'text-ink-mid hover:bg-white/5'
                            }`}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="h-4" />
        </div>

        {/* Pinned footer */}
        <div className="shrink-0 px-5 sm:px-6 pt-4 pb-5 sm:pb-6 border-t border-white/10 bg-surface/40">
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="import-place-confirm"
            disabled={!nameValid}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary"
          >
            <Check className="w-4 h-4" />
            Save place
          </button>
        </div>
    </Sheet>
  );
}
