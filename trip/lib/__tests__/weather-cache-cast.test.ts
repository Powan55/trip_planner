// @vitest-environment jsdom
//
// #450 — getCachedForecastForDate dereferenced an unchecked cast.
//
// `weatherCache.get<T>` returns `map[city]` cast to `T` with nothing validating it, and
// `readJson`'s shape gate stops one level short: it proves the CONTAINER parsed to an object,
// never the per-city value. So a corrupt slot reached `.find()` and threw a TypeError — on Home's
// render path, which makes it a blank page rather than a missing forecast.

import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedForecastForDate } from '@/lib/weather';
import { keyFor } from '@/core/storage/gateway';

/** Write the weather slot directly, the way a corrupt profile or another script on the origin would.
 *
 * The forecast lives under the COMPOUND key `${city}:forecast`, not the bare city — seeding the
 * bare name instead makes every corrupt-value case below pass for the wrong reason (absent key
 * returns null on its own). The well-formed case at the bottom is what catches that.
 */
function seedForecast(city: string, value: unknown): void {
  localStorage.setItem(keyFor('weatherCache'), JSON.stringify({ [`${city}:forecast`]: value }));
}

beforeEach(() => localStorage.clear());

describe('#450 — a corrupt weather slot returns null instead of throwing', () => {
  it.each([
    ['a string', 'corrupt'],
    ['a number', 42],
    ['an object', { nope: true }],
    ['a boolean', true],
  ])('a city whose cached value is %s', (_label, value) => {
    // The container is a real object, so readJson's gate passes it through — this is exactly the
    // level the gate does not reach.
    seedForecast('Kathmandu', value);
    expect(() => getCachedForecastForDate('Kathmandu', '2026-12-12')).not.toThrow();
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')).toBeNull();
  });

  it('null for that city is still null', () => {
    seedForecast('Kathmandu', null);
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')).toBeNull();
  });

  it('an absent city is still null', () => {
    seedForecast('Tokyo', []);
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')).toBeNull();
  });

  // The guard must not have been "fixed" by making every read null.
  it('a well-formed cache still resolves the matching day', () => {
    const day = { date: '2026-12-12', tempMaxC: 19, tempMinC: 2, code: 0 };
    seedForecast('Kathmandu', [{ date: '2026-12-11', tempMaxC: 1, tempMinC: 0, code: 0 }, day]);
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')).toMatchObject({ date: '2026-12-12' });
  });

  it('a well-formed cache that does not cover the date is null', () => {
    seedForecast('Kathmandu', [{ date: '2026-12-11', tempMaxC: 1, tempMinC: 0, code: 0 }]);
    expect(getCachedForecastForDate('Kathmandu', '2026-12-12')).toBeNull();
  });
});
