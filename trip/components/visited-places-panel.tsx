'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Globe2, MapPin, Plus, X } from 'lucide-react';
import {
  addVisit,
  foldPlaceName,
  getVisited,
  hasVisitedCity,
  removeVisit,
  tidyPlaceName,
  PLACE_NAME_MAX,
  type PlaceNameRejection,
  type VisitedPlaces,
} from '@/core/places/visited';
import { ISO_COUNTRIES } from '@/lib/iso-countries';
import { allTripPlaces } from '@/lib/visit-autocount';

/**
 * VisitedPlacesPanel — the `/profile` route's body: the countries and cities you had already been
 * to before this trip (issue #4). It is the WRITE surface for the lifetime visit set
 * (`core/places/visited.ts`, gateway key 32, D-314), so that a total says "everywhere you have
 * been" rather than "everywhere this one holiday went".
 *
 * TWO INPUT SHAPES, ON PURPOSE — and the asymmetry is the design, not an oversight:
 * • COUNTRIES are a closed set, so they are a `<select>` over the bundled ISO list
 *   (`lib/iso-countries.ts`, 249 entries, ~3 kB). A country cannot be mistyped into existence, and
 *   the options already recorded are filtered OUT, so "already added" is unreachable rather than an
 *   error message.
 * • CITIES are free text, because no list of the world's cities is small enough to bundle and no
 *   lookup service is worth a network dependency on a page that must work on a plane. Free text
 *   means the trust boundary is real, and it lives in `tidyPlaceName` — read that, do not re-derive
 *   a second normalisation here. This component calls it only to learn WHICH refusal to say out
 *   loud; `addVisit` applies it again regardless of what any caller does.
 *
 * REMOVAL IS A FIRST-CLASS PATH, for the reason free text guarantees: someone will typo. Every row
 * carries its own remove button, focus returns to that section's add control afterwards (a removed
 * row cannot keep the focus it had), and the removal is announced like every other outcome.
 *
 * A REMOVAL THE ITINERARY WILL UNDO SAYS SO (issue #236). `lib/visit-autocount.ts` re-credits every
 * place the active trip names, so removing one of those is real but temporary — it comes back the
 * next time the trip is counted. That is the KNOWN CEILING at `core/places/visited.ts`'s
 * `removeVisit`, and this panel does not try to beat it: a suppression list is a decision about
 * which record wins, the itinerary or the person, and that decision is deliberately still open.
 * What it does is stop CLAIMING otherwise — a trip-claimed row is marked "From your trip", the
 * remove button's accessible name carries the caveat, and the live region says "for now" instead of
 * asserting a permanent change. The button itself stays: the removal genuinely happens, and taking
 * the control away would settle the open question in the itinerary's favour.
 *
 * A11Y — this is a form, so these are acceptance criteria and not polish (D-021 lineage):
 * • Every control has a real `<label>`; the section headings label their own `<ul>`.
 * • ONE `role="status"` region reports every outcome — added, already there, refused, removed. It
 *   is keyed by a counter so that the SAME sentence twice is a DOM change and therefore a second
 *   announcement, rather than silence.
 * • A refused city is also stated inline, tied to the field by `aria-describedby` + `aria-invalid`,
 *   because a live region a screen reader announced once is not something a sighted user can go
 *   back and read.
 * • Native `<form>` submit, so Enter works in both fields; ≥44px targets; visible focus rings.
 *
 * MOTION: none. `/profile` is Tier 3 (D-292 puts every form there whatever route opens it), so
 * there is no entrance, no loop and no celebration to fork under `prefers-reduced-motion` — the
 * content is simply present.
 *
 * TEXT COLOUR: born on issue #27's three tiers (`text-ink-hi`/`-mid`/`-lo`), never the
 * `text-white/NN` alpha ramp. The role→tier rule is recorded beside the tokens in app/globals.css.
 */

/** One sentence per refusal `tidyPlaceName` can return. The user reads these; keep them plain.
 *  The cap is interpolated rather than typed out, so the sentence cannot drift from the rule. */
const REFUSAL: Record<PlaceNameRejection, string> = {
  blank: 'Type a city name first.',
  'too-long': `That's too long for a place name — ${PLACE_NAME_MAX} characters at most.`,
  unreadable: "That doesn't look like a place name. Letters or numbers, please.",
};

export default function VisitedPlacesPanel() {
  // `null` until the first client read: this island is `ssr:false`, but the store still must not
  // be read during render (the gateway is SSR-total, and this keeps the first paint honest).
  const [visited, setVisited] = useState<VisitedPlaces | null>(null);
  // `n` makes a repeated sentence a real DOM change, so the live region announces it again.
  const [status, setStatus] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const [cityDraft, setCityDraft] = useState('');
  const [cityError, setCityError] = useState<string | null>(null);
  const [countryDraft, setCountryDraft] = useState('');
  const cityInputRef = useRef<HTMLInputElement>(null);
  const countrySelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => setVisited(getVisited()), []);

  const announce = (text: string) => setStatus((prev) => ({ text, n: prev.n + 1 }));

  /** The ISO list minus what is already recorded — folded through the store's own rule, never a
   *  local `toLowerCase()`, so "already added" means here exactly what it means to `addVisit`. */
  const countryOptions = useMemo(() => {
    const taken = new Set((visited?.countries ?? []).map(foldPlaceName));
    return ISO_COUNTRIES.filter((name) => !taken.has(foldPlaceName(name)));
  }, [visited]);

  /** Every place the ITINERARY itself claims, folded through the store's own rule so "claimed"
   *  means here exactly what "already added" means to `addVisit`. The WHOLE trip rather than the
   *  arrived prefix `runVisitAutocount` counts today: a city whose day is still ahead is re-credited
   *  too, when its day comes, so "this will be counted again" is true of it as well. */
  const tripClaimed = useMemo(() => {
    const places = allTripPlaces();
    return {
      city: new Set(places.map((p) => foldPlaceName(p.city))),
      // A single-leg custom trip labels no country (`countryLabelForDate` returns ''); a blank
      // claims nothing.
      country: new Set(places.map((p) => foldPlaceName(p.country)).filter(Boolean)),
    };
  }, []);

  const claimedByTrip = (kind: 'city' | 'country', name: string) =>
    tripClaimed[kind].has(foldPlaceName(name));

  const submitCountry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tidy = tidyPlaceName(countryDraft);
    if (!tidy.ok) return; // unreachable from the select; the store would refuse it anyway
    setVisited(addVisit({ country: tidy.value }));
    setCountryDraft('');
    announce(`Added ${tidy.value} to your countries.`);
  };

  const submitCity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tidy = tidyPlaceName(cityDraft);
    if (!tidy.ok) {
      setCityError(REFUSAL[tidy.reason]);
      announce(REFUSAL[tidy.reason]);
      return;
    }
    if (hasVisitedCity(tidy.value)) {
      const already = `${tidy.value} is already on your list.`;
      setCityError(already);
      announce(already);
      return;
    }
    setVisited(addVisit({ city: tidy.value }));
    setCityDraft('');
    setCityError(null);
    announce(`Added ${tidy.value} to your cities.`);
  };

  const remove = (visit: { city?: string; country?: string }) => {
    const kind = visit.city ? 'city' : 'country';
    const name = visit.city ?? visit.country ?? '';
    setVisited(removeVisit(visit));
    // Both sentences are true of what just happened: the write really did run, and for a place the
    // trip names it really will be undone. The old unconditional one was true of only half of them.
    announce(
      claimedByTrip(kind, name)
        ? `Removed ${name} for now — your trip goes there, so it will be counted again.`
        : `Removed ${name}.`,
    );
    // The button that had focus has just been unmounted; park it on the matching add control
    // rather than letting it fall to <body>.
    if (visit.city) cityInputRef.current?.focus();
    else countrySelectRef.current?.focus();
  };

  if (visited === null) {
    return (
      <section
        aria-labelledby="visited-heading"
        data-testid="visited-places-panel"
        className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6"
      >
        <h2 id="visited-heading" className="sr-only">
          Places you have already been
        </h2>
        <p className="text-sm text-ink-mid">Loading your travel history…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="visited-heading"
      data-testid="visited-places-panel"
      className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6"
    >
      <h2 id="visited-heading" className="sr-only">
        Places you have already been
      </h2>

      {/* The one announcement channel for every outcome in this panel. It is in the DOM from the
          first interactive render, several renders before anything can be announced — a live
          region created in the same commit as its own text is not reliably read out. */}
      <div role="status" aria-live="polite" data-testid="visited-status" className="sr-only">
        <p key={status.n}>{status.text}</p>
      </div>

      <div className="flex flex-col gap-8">
        <PlaceGroup
          icon={Globe2}
          eyebrow="Been there"
          title="Countries"
          count={visited.countries.length}
          countTestId="visited-country-count"
          listTestId="visited-country-list"
          emptyTestId="visited-country-empty"
          empty="No countries yet. Add the ones you'd visited before this trip."
          headingId="visited-countries-heading"
          items={visited.countries}
          removeTestId={(name) => `visited-country-remove-${name}`}
          isClaimed={(name) => claimedByTrip('country', name)}
          onRemove={(name) => remove({ country: name })}
        >
          <form
            onSubmit={submitCountry}
            data-testid="visited-country-form"
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <label
                htmlFor="visited-country-select"
                className="text-xs uppercase tracking-widest text-ink-lo"
              >
                Country
              </label>
              <select
                id="visited-country-select"
                data-testid="visited-country-select"
                ref={countrySelectRef}
                value={countryDraft}
                onChange={(e) => setCountryDraft(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Choose a country…</option>
                {countryOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={countryDraft === ''}
              data-testid="visited-country-add"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-[color:var(--border-ui)] px-4 py-2.5 text-sm font-semibold text-ink-hi transition-colors hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add country
            </button>
          </form>
        </PlaceGroup>

        <PlaceGroup
          icon={MapPin}
          eyebrow="Been there"
          title="Cities"
          count={visited.cities.length}
          countTestId="visited-city-count"
          listTestId="visited-city-list"
          emptyTestId="visited-city-empty"
          empty="No cities yet. Type any city you'd been to before this trip."
          headingId="visited-cities-heading"
          items={visited.cities}
          removeTestId={(name) => `visited-city-remove-${name}`}
          isClaimed={(name) => claimedByTrip('city', name)}
          onRemove={(name) => remove({ city: name })}
        >
          <form
            onSubmit={submitCity}
            data-testid="visited-city-form"
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <label
                htmlFor="visited-city-input"
                className="text-xs uppercase tracking-widest text-ink-lo"
              >
                City
              </label>
              <input
                id="visited-city-input"
                data-testid="visited-city-input"
                ref={cityInputRef}
                type="text"
                value={cityDraft}
                onChange={(e) => {
                  setCityDraft(e.target.value);
                  setCityError(null);
                }}
                placeholder="Pokhara"
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                aria-invalid={cityError !== null}
                aria-describedby={cityError === null ? undefined : 'visited-city-error'}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-ink-hi placeholder:text-ink-lo outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              type="submit"
              data-testid="visited-city-add"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-[color:var(--border-ui)] px-4 py-2.5 text-sm font-semibold text-ink-hi transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add city
            </button>
          </form>
          {cityError !== null && (
            <p
              id="visited-city-error"
              data-testid="visited-city-error"
              className="mt-2 text-sm text-rose-300"
            >
              {cityError}
            </p>
          )}
        </PlaceGroup>
      </div>

      <p className="mt-8 text-sm text-ink-lo">
        This list is yours, not the trip&rsquo;s: it stays on this device when a trip is cleared or
        you sign out. It never leaves the device.
      </p>
    </section>
  );
}

/** One titled group: the add control (as `children`), the count, and the removable list. */
function PlaceGroup({
  icon: Icon,
  eyebrow,
  title,
  count,
  countTestId,
  listTestId,
  emptyTestId,
  empty,
  headingId,
  items,
  removeTestId,
  isClaimed,
  onRemove,
  children,
}: {
  icon: typeof Globe2;
  eyebrow: string;
  title: string;
  count: number;
  countTestId: string;
  listTestId: string;
  emptyTestId: string;
  empty: string;
  headingId: string;
  items: readonly string[];
  removeTestId: (name: string) => string;
  /** Does the active trip name this place? A claimed row's removal is undone by the next count. */
  isClaimed: (name: string) => boolean;
  onRemove: (name: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-subtle rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="mb-1 text-[0.65rem] uppercase tracking-widest text-ink-lo">{eyebrow}</p>
          <h3 id={headingId} className="flex items-center gap-2 font-display text-lg font-bold text-ink-hi">
            <Icon className="h-4 w-4 text-ink-mid" aria-hidden="true" />
            {title}
          </h3>
        </div>
        <span data-testid={countTestId} className="shrink-0 text-xs font-medium text-ink-mid">
          {count} recorded
        </span>
      </div>

      <div className="mt-3">{children}</div>

      {items.length === 0 ? (
        <p data-testid={emptyTestId} className="mt-4 text-sm text-ink-mid">
          {empty}
        </p>
      ) : (
        <ul
          aria-labelledby={headingId}
          data-testid={listTestId}
          className="mt-4 flex flex-wrap gap-2"
        >
          {items.map((name) => {
            // Marked, not disabled (issue #236): the remove still works, it just does not last.
            const claimed = isClaimed(name);
            return (
              <li
                key={name}
                data-trip-claimed={claimed ? 'true' : undefined}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pl-3 pr-0.5 text-sm text-ink-hi"
              >
                {name}
                {claimed && (
                  <span className="text-[0.65rem] uppercase tracking-wide text-ink-mid">
                    From your trip
                  </span>
                )}
                {/* 44px, the house tap-target floor — a delete is the one control nobody should hit
                    by accident or miss by a pixel. */}
                <button
                  type="button"
                  data-testid={removeTestId(name)}
                  onClick={() => onRemove(name)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-mid transition-colors hover:bg-white/10 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {/* The caveat rides in the NAME, not a description: someone moving button to
                      button hears only the name, and "Remove" alone would be the same claim the
                      old announcement made. */}
                  <span className="sr-only">
                    {claimed ? `Remove ${name} — your trip will count it again` : `Remove ${name}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
