import { describe, it, expect } from 'vitest';
import {
  emergencyContactSchema,
  phraseSchema,
  checklistItemSchema,
  EMERGENCY_CONTACTS,
  SAFETY_PHRASES,
  DOCUMENT_CHECKLIST,
} from '@/core/content/safety';

// S152 — the safety-content validator. Mirrors `lib/__tests__/content-validation.test.ts`'s
// shape (a valid-parse pass + a deliberately-broken inline fixture that the schema REJECTS),
// but self-contained: `core/content/safety.ts` owns its own local Zod schemas and already
// `.parse()`s its own data at module load (so if THIS import succeeded, the live content is
// already known-valid — the assertions below are red-proof, not the first check).

describe('safety content — valid data parses', () => {
  it('EMERGENCY_CONTACTS: 9 contacts, Nepal + Japan both represented', () => {
    expect(EMERGENCY_CONTACTS.length).toBe(9);
    expect(EMERGENCY_CONTACTS.some((c) => c.country === 'Nepal')).toBe(true);
    expect(EMERGENCY_CONTACTS.some((c) => c.country === 'Japan')).toBe(true);
    for (const c of EMERGENCY_CONTACTS) {
      expect(emergencyContactSchema.safeParse(c).success).toBe(true);
    }
  });

  it('SAFETY_PHRASES: ~20 entries, every entry has an English/Nepali/Japanese trio', () => {
    expect(SAFETY_PHRASES.length).toBe(20);
    for (const p of SAFETY_PHRASES) {
      expect(phraseSchema.safeParse(p).success).toBe(true);
      expect(p.english.length).toBeGreaterThan(0);
      expect(p.nepali.length).toBeGreaterThan(0);
      expect(p.japanese.length).toBeGreaterThan(0);
    }
  });

  it('DOCUMENT_CHECKLIST: every item parses and belongs to a known group', () => {
    expect(DOCUMENT_CHECKLIST.length).toBeGreaterThan(0);
    for (const item of DOCUMENT_CHECKLIST) {
      expect(checklistItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it('every emergency contact id is unique', () => {
    const ids = EMERGENCY_CONTACTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tel: value is a plain [+]digits string (D-074 href discipline)', () => {
    for (const c of EMERGENCY_CONTACTS) {
      expect(c.tel).toMatch(/^\+?[0-9]+$/);
    }
  });
});

describe('safety content — the validator HAS TEETH (broken fixture is rejected)', () => {
  it('rejects a bad emergency contact — malformed tel href', () => {
    const bad = {
      id: 'bad-1',
      country: 'Nepal',
      service: 'Police',
      number: '100',
      tel: 'call 100 now', // not a plain [+]digits string
      sourceUrl: 'https://nepalpolice.gov.np/',
      verified: true,
    };
    const r = emergencyContactSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('tel');
  });

  it('rejects a bad emergency contact — unknown country enum value', () => {
    const bad = {
      id: 'bad-2',
      country: 'Nowhereland',
      service: 'Police',
      number: '100',
      tel: '100',
      sourceUrl: 'https://example.com/',
      verified: true,
    };
    const r = emergencyContactSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('country');
  });

  it('rejects an emergency contact with an unrecognized key (typo guard, .strict())', () => {
    const bad = {
      id: 'bad-3',
      country: 'Japan',
      service: 'Police',
      number: '110',
      tel: '110',
      sourceUrl: 'https://www.npa.go.jp/',
      verified: true,
      extraTypoField: 'oops',
    };
    const r = emergencyContactSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some(
          (i) => i.code === 'unrecognized_keys' && i.keys.includes('extraTypoField'),
        ),
      ).toBe(true);
    }
  });

  it('rejects a phrase missing a required field', () => {
    const bad = {
      id: 'bad-phrase',
      category: 'Greetings',
      english: 'Hello',
      nepali: 'Namaste',
      // japanese missing
    };
    const r = phraseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('japanese');
  });

  it('rejects a phrase with an unknown category enum value', () => {
    const bad = {
      id: 'bad-phrase-2',
      category: 'Small Talk', // not in phraseCategories
      english: 'Hello',
      nepali: 'Namaste',
      japanese: 'Konnichiwa',
    };
    const r = phraseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('category');
  });

  it('rejects a checklist item with an unknown group enum value', () => {
    const bad = {
      id: 'bad-checklist',
      group: 'Miscellaneous', // not in checklistGroups
      label: 'Something',
    };
    const r = checklistItemSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('group');
  });
});
