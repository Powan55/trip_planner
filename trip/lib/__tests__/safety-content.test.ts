import { describe, it, expect } from 'vitest';
import {
  emergencyContactSchema,
  hazardNoteSchema,
  phraseSchema,
  checklistItemSchema,
  EMERGENCY_CONTACTS,
  HAZARD_NOTES,
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

  it('SAFETY_PHRASES: 33 entries, every entry has an English/Nepali/Japanese trio', () => {
    expect(SAFETY_PHRASES.length).toBe(33);
    for (const p of SAFETY_PHRASES) {
      expect(phraseSchema.safeParse(p).success).toBe(true);
      expect(p.english.length).toBeGreaterThan(0);
      expect(p.nepali.length).toBeGreaterThan(0);
      expect(p.japanese.length).toBeGreaterThan(0);
    }
  });

  // #2. The point of the phrasebook is that a traveler can POINT at the native script when
  // reading the romanization aloud does not land, so a row missing its script — or carrying a
  // romanization in the script field — is a silent content failure, not a cosmetic one.
  it('SAFETY_PHRASES: every entry carries real Devanagari and real kana/kanji', () => {
    for (const p of SAFETY_PHRASES) {
      expect(p.nepaliScript, `${p.id} nepaliScript is not Devanagari`).toMatch(/[\u0900-\u097F]/);
      expect(p.japaneseScript, `${p.id} japaneseScript has no kana/kanji`).toMatch(
        /[\u3040-\u30FF\u4E00-\u9FFF]/,
      );
    }
  });

  it('SAFETY_PHRASES: ids are unique and all 7 categories are populated', () => {
    const ids = SAFETY_PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(SAFETY_PHRASES.map((p) => p.category));
    expect([...categories].sort()).toEqual([
      'Basics',
      'Directions',
      'Emergency',
      'Food & Shopping',
      'Greetings',
      'Numbers',
      'Politeness',
    ]);
  });

  // #255 — one Japan earthquake note, one Nepal aftershock/bandh note.
  it('HAZARD_NOTES: one note per country, both parse', () => {
    expect(HAZARD_NOTES.length).toBe(2);
    expect(HAZARD_NOTES.some((n) => n.country === 'Japan')).toBe(true);
    expect(HAZARD_NOTES.some((n) => n.country === 'Nepal')).toBe(true);
    for (const n of HAZARD_NOTES) {
      expect(hazardNoteSchema.safeParse(n).success).toBe(true);
    }
    const ids = HAZARD_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // #280 — the more prominent (airport-read) safety.ts row must not say LESS than the
  // checklist row of the same id in core/docs/model.ts; assert the date anchor/QR detail
  // actually made it into this copy rather than drifting back to the shorter original.
  it('DOCUMENT_CHECKLIST: nepal-visa and japan-entry carry the same key facts as core/docs/model.ts (#280)', () => {
    const nepalVisa = DOCUMENT_CHECKLIST.find((i) => i.id === 'nepal-visa');
    const japanEntry = DOCUMENT_CHECKLIST.find((i) => i.id === 'japan-entry');
    expect(nepalVisa?.detail).toMatch(/26 Nov 2026/);
    expect(nepalVisa?.detail).toMatch(/15 days/);
    expect(japanEntry?.detail).toMatch(/QR/);
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

  it('rejects a hazard note with an unrecognized key (typo guard, .strict())', () => {
    const bad = {
      id: 'bad-hazard',
      country: 'Japan',
      title: 'Test',
      body: 'Test body',
      extraTypoField: 'oops',
    };
    const r = hazardNoteSchema.safeParse(bad);
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
      nepaliScript: 'नमस्ते',
      // japanese missing
      japaneseScript: 'こんにちは',
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
      nepaliScript: 'नमस्ते',
      japanese: 'Konnichiwa',
      japaneseScript: 'こんにちは',
    };
    const r = phraseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('category');
  });

  // #2 script guards. The realistic authoring mistake is copying the romanization into the
  // script column (it looks filled-in, it renders, and nothing throws) — these prove the schema
  // catches exactly that, per language.
  it('rejects a phrase whose nepaliScript is romanized rather than Devanagari', () => {
    const bad = {
      id: 'bad-phrase-3',
      category: 'Greetings',
      english: 'Hello',
      nepali: 'Namaste',
      nepaliScript: 'Namaste', // romanization pasted into the script field
      japanese: 'Konnichiwa',
      japaneseScript: 'こんにちは',
    };
    const r = phraseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('nepaliScript');
  });

  it('rejects a phrase whose japaneseScript carries no kana or kanji', () => {
    const bad = {
      id: 'bad-phrase-4',
      category: 'Greetings',
      english: 'Hello',
      nepali: 'Namaste',
      nepaliScript: 'नमस्ते',
      japanese: 'Konnichiwa',
      japaneseScript: 'Konnichiwa', // romaji pasted into the script field
    };
    const r = phraseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('japaneseScript');
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
