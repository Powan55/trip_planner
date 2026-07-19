// Flight/transit deep-links for Travel Mode's Essentials block (: flight-
// status APIs REJECTED — deep-links instead). Pure, React-free URL builders — the
// URL-not-API pattern (`lib/maps-link.ts` precedent: a plain string builder, no fetch, no key).
// Nothing here is fetched; every export is a byte-exact `<a href>` built from the confirmed
// booking data (`lib/booking-data.ts`) or a plain city-pair.

/** IATA carrier codes for the airlines that actually appear in `lib/booking-data.ts` —
 * deliberately BOUNDED to the 4 real carriers on this trip, not a general lookup. An
 * airline outside this map yields no tracker link (never a guessed/broken href). */
const AIRLINE_IATA: Record<string, string> = {
  Delta: 'DL',
  'Air India': 'AI',
  'China Southern': 'CZ',
  'Japan Airlines': 'JL',
};

/**
 * Build a FlightRadar24 flight-tracker URL from a booking `flightNumber` string
 * (e.g. `'Delta 5363'` → `https://www.flightradar24.com/data/flights/dl5363`). Returns `null`
 * when the airline isn't in the bounded IATA map above or the string doesn't split cleanly —
 * total, never throws, never guesses.
 */
export function buildFlightTrackerUrl(flightNumber: string): string | null {
  const trimmed = flightNumber.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace < 0) return null;
  const airline = trimmed.slice(0, lastSpace);
  const number = trimmed.slice(lastSpace + 1).trim();
  const iata = AIRLINE_IATA[airline];
  if (!iata || !/^[0-9]+$/.test(number)) return null;
  return `https://www.flightradar24.com/data/flights/${iata.toLowerCase()}${number}`;
}

/** Rome2Rio multimodal "how do I get from A to B" route search — free, keyless, no card
 * The scope-note's named precedent for inter-city transfer days. */
export function buildRome2RioUrl(fromCity: string, toCity: string): string {
  const enc = (s: string) => encodeURIComponent(s.trim());
  return `https://www.rome2rio.com/s/${enc(fromCity)}/${enc(toCity)}`;
}

/** Google Flights free-text route search — a URL query, not the paid Flights API
 * */
export function buildGoogleFlightsUrl(fromCity: string, toCity: string): string {
  const query = `Flights from ${fromCity.trim()} to ${toCity.trim()}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}
