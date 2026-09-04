import { describe, it, expect } from 'vitest';

import { ISO_COUNTRIES } from '../iso-countries';

// ISO's official name on the left is what the list deliberately does NOT use.
const COMMON_FORM: [string, string][] = [
  ['South Korea', 'Korea (the Republic of)'],
  ['Bolivia', 'Bolivia (Plurinational State of)'],
  ['Vietnam', 'Viet Nam'],
  ['Türkiye', 'Turkey'],
];

describe('ISO_COUNTRIES', () => {
  it('holds every officially-assigned ISO 3166-1 entry exactly once', () => {
    expect(ISO_COUNTRIES).toHaveLength(249);
    expect(new Set(ISO_COUNTRIES).size).toBe(ISO_COUNTRIES.length);
  });

  // A plain `.sort()` is a code-unit sort, which exiles every name starting with an accent
  // to the very end of a 249-row picker. The authored order collates accent-insensitively.
  it('orders accented names where a reader would look for them', () => {
    const collated = [...ISO_COUNTRIES].sort(
      new Intl.Collator('en', { sensitivity: 'base' }).compare,
    );

    expect(ISO_COUNTRIES[1]).toBe('Åland Islands');
    expect([...ISO_COUNTRIES]).toEqual(collated);
  });

  it('uses the common English short form where ISO parenthesises', () => {
    for (const [common, official] of COMMON_FORM) {
      expect(ISO_COUNTRIES).toContain(common);
      expect(ISO_COUNTRIES).not.toContain(official);
    }
  });

  it('leaves out entries ISO has not assigned', () => {
    expect(ISO_COUNTRIES).not.toContain('Kosovo');
  });
});
