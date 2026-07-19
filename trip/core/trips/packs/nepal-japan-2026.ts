/**
 * The DEFAULT trip pack. Dates are copied
 * VERBATIM from the pre-pack `core/dates/trip-dates.ts` literals; leg ids are the legacy
 * 'nepal' | 'japan' union values. Currencies
 * per; offsets NPT 345 / JST 540 per; fallback cities keep trip-cities' fallback
 * byte-identical. Any edit to a date / id / offset here changes the whole app's date backbone
 * and goes loudly red against the unit suites.
 */
import type { TripConfig } from '../model';

export const NEPAL_JAPAN_2026: TripConfig = {
  id: 'nepal-japan-2026',
  label: 'Nepal × Japan 2026',
  start: '2026-12-09',
  end: '2027-01-09',
  contentRef: 'nepal-japan-2026',
  legs: [
    {
      id: 'nepal',
      countryLabel: 'Nepal',
      currency: 'NPR',
      start: '2026-12-09',
      end: '2026-12-18',
      contentKey: 'nepal',
      utcOffsetMin: 345,
      fallbackCity: 'Kathmandu',
    },
    {
      id: 'japan',
      countryLabel: 'Japan',
      currency: 'JPY',
      start: '2026-12-19',
      end: '2027-01-09',
      contentKey: 'japan',
      utcOffsetMin: 540,
      fallbackCity: 'Tokyo',
    },
  ],
};
