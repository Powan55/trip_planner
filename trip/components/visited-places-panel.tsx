'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Globe2, MapPin, Plus, X } from 'lucide-react';
import {
  addVisit,
  foldPlaceName,
  getVisited,
  hasVisitedCity,
  isTripClaimedCity,
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
 * What it does is stop CLAIMING otherwise — a trip-claimed row is marked "In your trip", the
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

  /** Every country the ITINERARY itself claims, folded through the store's own rule so "claimed"
   *  means here exactly what "already added" means to `addVisit`. The WHOLE trip rather than the
   *  arrived prefix `runVisitAutocount` counts today: a country whose day is still ahead is
   *  re-credited too, when its day comes, so "this will be counted again" is true of it as well.
   *  Cities use `isTripClaimedCity` instead (issue #332) — this set covers countries only, which
   *  that function does not answer. */
  const tripClaimedCountries = useMemo(() => {
    const places = allTripPlaces();
    // A single-leg custom trip labels no country (`countryLabelForDate` returns ''); a blank
    // claims nothing.
    return new Set(places.map((p) => foldPlaceName(p.country)).filter(Boolean));
  }, []);

  const claimedByTrip = (kind: 'city' | 'country', name: string) =>
    kind === 'city' ? isTripClaimedCity(name) : tripClaimedCountries.has(foldPlaceName(name));

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
        className="mx-auto w-full max-w-3xl px-gut pb-16"
      >
        <h2 id="visited-heading" className="sr-only">
          Places you have already been
        </h2>
        <p className="empty">Loading your travel history…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="visited-heading"
      data-testid="visited-places-panel"
      className="mx-auto w-full max-w-3xl pb-16"
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
          empty="Nothing on file yet — add the countries you'd been to before this trip and they join your lifetime total."
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
                className="pr pr--lo"
              >
                Country
              </label>
              <select
                id="visited-country-select"
                data-testid="visited-country-select"
                ref={countrySelectRef}
                value={countryDraft}
                onChange={(e) => setCountryDraft(e.target.value)}
                className="mt-1 min-h-tap w-full rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface-raised px-3 py-2.5 text-t-body text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="btn btn--2 shrink-0 px-4"
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
          empty="Nothing on file yet — type any city you'd been to before this trip and it joins your lifetime total."
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
                className="pr pr--lo"
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
                className="mt-1 min-h-tap w-full rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface-raised px-3 py-2.5 text-t-body text-ink-hi placeholder:text-ink-lo outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              type="submit"
              data-testid="visited-city-add"
              className="btn btn--2 shrink-0 px-4"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add city
            </button>
          </form>
          {cityError !== null && (
            <p
              id="visited-city-error"
              data-testid="visited-city-error"
              className="err mt-2 text-t-body"
            >
              {cityError}
            </p>
          )}
        </PlaceGroup>
      </div>

      <p className="mt-8 max-w-2xl px-gut text-t-sm text-ink-lo">
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
    <div>
      {/* The running-head field strip, deliberately NOT sticky: the app ships a fixed navbar at
          top:0, and a second sticky bar per group would stack under it. */}
      <div className="head static flex-wrap">
        <span className="f">
          <span className="k">{eyebrow}</span>
          <h3 id={headingId} className="v !flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-ink-lo" aria-hidden="true" />
            {title}
          </h3>
        </span>
        <span className="f">
          <span className="k">On file</span>
          <span data-testid={countTestId} className="v">
            {count} recorded
          </span>
        </span>
      </div>

      <div className="px-gut pt-3">{children}</div>

      {items.length === 0 ? (
        // Empty copy sits at --t-body / --text-mid, never --t-micro, and points forward.
        <p data-testid={emptyTestId} className="empty mt-4 max-w-2xl px-gut">
          {empty}
        </p>
      ) : (
        <ul
          aria-labelledby={headingId}
          data-testid={listTestId}
          className="mt-4 flex flex-wrap items-center gap-2 px-gut"
        >
          {items.map((name) => {
            // Marked, not disabled (issue #236): the remove still works, it just does not last.
            const claimed = isClaimed(name);
            return (
              <li
                key={name}
                data-trip-claimed={claimed ? 'true' : undefined}
                className={`chip gap-0 py-0 pe-0 ps-2 normal-case tracking-normal ${
                  claimed ? 'chip--hollow' : 'chip--struck'
                }`}
              >
                <span className="text-t-body">{name}</span>
                {claimed && <span className="pr pr--lo ms-1.5">In your trip</span>}
                {/* The house tap-target floor — a delete is the one control nobody should hit by
                    accident or miss by a pixel. */}
                <button
                  type="button"
                  data-testid={removeTestId(name)}
                  onClick={() => onRemove(name)}
                  className="ms-1 inline-flex min-h-tap min-w-tap items-center justify-center text-ink-mid transition-colors hover:bg-[hsl(var(--destructive)/0.08)] hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
