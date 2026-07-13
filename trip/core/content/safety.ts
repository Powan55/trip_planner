import { z } from 'zod';

/**
 * SAFETY-CRITICAL static content — an offline travel-safety reference for the
 * Nepal + Japan legs: emergency/embassy numbers, a romanized phrasebook, and a document
 * checklist. Framework-free: plain TS + zod (already a prod dep — no new dependency).
 *
 * DELIBERATELY SELF-CONTAINED: this file does NOT import from or extend
 * `core/content/schema.ts` (kept self-contained/out of scope of the itinerary content
 * schema, which is owned separately) — it declares its own local `.strict()` Zod shapes
 * below and `.parse()`s its own data at MODULE LOAD (unlike `core/content/schema.ts`,
 * whose schemas only run authoring/CI-time via
 * `lib/__tests__/content-validation.test.ts` — here the parse is eager, at import time, so a
 * malformed entry fails the build immediately, not just in a separate validate step). Static
 * data only — no fetch, no key, no persistence.
 *
 * ── SAFETY-CRITICAL ACCURACY (read before editing) ─────────────────────────────────────────
 * Every emergency/embassy contact below cites its official source in `sourceUrl` and carries
 * a `verified` flag:
 *   - `verified: true`  — the long-standing, universally-published national emergency number
 *     for that service (Nepal Police 100 / Ambulance 102 / Fire 101; Japan Police 110 /
 *     Fire+Ambulance 119). These have been stable for decades and are corroborated by every
 *     government and embassy travel-safety page; high confidence.
 *   - `verified: false` — a specific switchboard/hotline digit string (a tourist-police line,
 *     an embassy main number, a tourist-info hotline) that this build environment could NOT
 *     re-confirm against a LIVE fetch (no web-browsing tool was available this session) — each
 *     carries a `note` telling the traveler to reconfirm on the linked official page before
 *     relying on it. Flagged for a human spot-check. DO NOT
 *     flip `verified` to `true` without an actual live check against `sourceUrl`.
 */

// ── Emergency & embassy contacts ────────────────────────────────────────────────────────────

export const emergencyContactSchema = z
  .object({
    id: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    service: z.string().min(1),
    /** Display string, e.g. "100" or "+977-1-423-4000". */
    number: z.string().min(1),
    /** `tel:` href value — digits only, optional leading "+". */
    tel: z.string().regex(/^\+?[0-9]+$/, 'tel must be a plain [+]digits string'),
    sourceUrl: z.string().url(),
    verified: z.boolean(),
    note: z.string().min(1).optional(),
  })
  .strict();

export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

const rawEmergencyContacts: EmergencyContact[] = [
  {
    id: 'np-police',
    country: 'Nepal',
    service: 'Police',
    number: '100',
    tel: '100',
    sourceUrl: 'https://nepalpolice.gov.np/',
    verified: true,
  },
  {
    id: 'np-ambulance',
    country: 'Nepal',
    service: 'Ambulance',
    number: '102',
    tel: '102',
    sourceUrl: 'https://nepalpolice.gov.np/',
    verified: true,
  },
  {
    id: 'np-fire',
    country: 'Nepal',
    service: 'Fire Brigade',
    number: '101',
    tel: '101',
    sourceUrl: 'https://nepalpolice.gov.np/',
    verified: true,
  },
  {
    id: 'np-tourist-police',
    country: 'Nepal',
    service: 'Tourist Police (Kathmandu)',
    number: '+977-1-4247041',
    tel: '+97714247041',
    sourceUrl: 'https://ntb.gov.np/',
    verified: false,
    note: 'Not live-verified this session — confirm the current Tourist Police line on the Nepal Tourism Board site before relying on it.',
  },
  {
    id: 'np-us-embassy',
    country: 'Nepal',
    service: 'U.S. Embassy Kathmandu',
    number: '+977-1-423-4000',
    tel: '+97714234000',
    sourceUrl: 'https://np.usembassy.gov/',
    verified: false,
    note: 'Not live-verified this session — confirm the current switchboard number on the official embassy site before relying on it.',
  },
  {
    id: 'jp-police',
    country: 'Japan',
    service: 'Police',
    number: '110',
    tel: '110',
    sourceUrl: 'https://www.npa.go.jp/',
    verified: true,
  },
  {
    id: 'jp-fire-ambulance',
    country: 'Japan',
    service: 'Fire & Ambulance',
    number: '119',
    tel: '119',
    sourceUrl: 'https://www.fdma.go.jp/',
    verified: true,
  },
  {
    id: 'jp-visitor-hotline',
    country: 'Japan',
    service: 'Japan Visitor Hotline (24/7 multilingual tourist assistance, JNTO)',
    number: '050-3816-2787',
    tel: '+815038162787',
    sourceUrl: 'https://www.japan.travel/en/plan/hotline/',
    verified: false,
    note: 'Not live-verified this session — confirm the current JNTO hotline number on the official site before relying on it.',
  },
  {
    id: 'jp-us-embassy',
    country: 'Japan',
    service: 'U.S. Embassy Tokyo',
    number: '+81-3-3224-5000',
    tel: '+81332245000',
    sourceUrl: 'https://jp.usembassy.gov/',
    verified: false,
    note: 'Not live-verified this session — confirm the current switchboard number on the official embassy site before relying on it.',
  },
];

export const EMERGENCY_CONTACTS = z.array(emergencyContactSchema).parse(rawEmergencyContacts);

// ── Phrasebook (Nepali + Japanese, romanized) ──────────────────────────────────────────────

const phraseCategories = [
  'Greetings',
  'Politeness',
  'Basics',
  'Emergency',
  'Directions',
  'Food & Shopping',
] as const;

export const phraseSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(phraseCategories),
    english: z.string().min(1),
    /** Romanized Nepali — no Devanagari (keeps things simple; avoids font/encoding risk). */
    nepali: z.string().min(1),
    /** Romanized Japanese (romaji) — no kana/kanji. */
    japanese: z.string().min(1),
  })
  .strict();

export type Phrase = z.infer<typeof phraseSchema>;

const rawPhrases: Phrase[] = [
  { id: 'hello', category: 'Greetings', english: 'Hello', nepali: 'Namaste', japanese: 'Konnichiwa' },
  { id: 'good-morning', category: 'Greetings', english: 'Good morning', nepali: 'Subha prabhat', japanese: 'Ohayou gozaimasu' },
  { id: 'good-night', category: 'Greetings', english: 'Good night', nepali: 'Subha ratri', japanese: 'Oyasumi nasai' },
  { id: 'goodbye', category: 'Greetings', english: 'Goodbye', nepali: 'Feri bhetaunla', japanese: 'Sayounara' },
  { id: 'thank-you', category: 'Politeness', english: 'Thank you', nepali: 'Dhanyabaad', japanese: 'Arigatou gozaimasu' },
  { id: 'please', category: 'Politeness', english: 'Please', nepali: 'Kripaya', japanese: 'Onegaishimasu' },
  { id: 'sorry', category: 'Politeness', english: 'Excuse me / Sorry', nepali: 'Maaf garnuhos', japanese: 'Sumimasen' },
  { id: 'yes', category: 'Basics', english: 'Yes', nepali: 'Ho', japanese: 'Hai' },
  { id: 'no', category: 'Basics', english: 'No', nepali: 'Hoina', japanese: 'Iie' },
  { id: 'dont-understand', category: 'Basics', english: "I don't understand", nepali: 'Malai bujhena', japanese: 'Wakarimasen' },
  { id: 'speak-english', category: 'Basics', english: 'Do you speak English?', nepali: 'Tapai english bolnuhuncha?', japanese: 'Eigo wo hanasemasu ka?' },
  { id: 'my-name-is', category: 'Basics', english: 'My name is...', nepali: 'Mero naam ho...', japanese: 'Watashi no namae wa... desu' },
  { id: 'help', category: 'Emergency', english: 'Help!', nepali: 'Guhaar!', japanese: 'Tasukete!' },
  { id: 'call-police', category: 'Emergency', english: 'Call the police', nepali: 'Prahari lai bolaunuhos', japanese: 'Keisatsu wo yonde kudasai' },
  { id: 'need-doctor', category: 'Emergency', english: 'I need a doctor', nepali: 'Malai daktar chahiyo', japanese: 'Isha ga hitsuyou desu' },
  { id: 'where-hospital', category: 'Emergency', english: 'Where is the hospital?', nepali: 'Aspatal kaha cha?', japanese: 'Byouin wa doko desu ka?' },
  { id: 'where-bathroom', category: 'Directions', english: 'Where is the bathroom?', nepali: 'Charpi kaha cha?', japanese: 'Toire wa doko desu ka?' },
  { id: 'how-to-get-to', category: 'Directions', english: 'How do I get to...?', nepali: '...samma kasari jane?', japanese: '...made dou ikeba ii desu ka?' },
  { id: 'how-much', category: 'Food & Shopping', english: 'How much is this?', nepali: 'Yo kati ho?', japanese: 'Kore wa ikura desu ka?' },
  { id: 'water-please', category: 'Food & Shopping', english: 'Water, please', nepali: 'Paani dinuhos', japanese: 'Mizu wo kudasai' },
];

export const SAFETY_PHRASES = z.array(phraseSchema).parse(rawPhrases);

// ── Document checklist ──────────────────────────────────────────────────────────────────────

const checklistGroups = ['Before you go', 'Carry with you', 'Digital backups'] as const;

export const checklistItemSchema = z
  .object({
    id: z.string().min(1),
    group: z.enum(checklistGroups),
    label: z.string().min(1),
    detail: z.string().min(1).optional(),
  })
  .strict();

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

const rawChecklist: ChecklistItem[] = [
  {
    id: 'passport-validity',
    group: 'Before you go',
    label: 'Passport valid 6+ months beyond the return date',
    detail: 'Many countries (incl. Nepal and Japan) require this validity window for entry.',
  },
  {
    id: 'nepal-visa',
    group: 'Before you go',
    label: 'Nepal visa arranged',
    detail: 'Visa-on-arrival at Tribhuvan Intl (KTM) or a pre-arranged e-visa — bring passport photos and the entry fee in cash.',
  },
  {
    id: 'japan-entry',
    group: 'Before you go',
    label: 'Japan entry requirements confirmed',
    detail: 'Check visa/visa-waiver eligibility for your nationality and complete Visit Japan Web pre-registration.',
  },
  {
    id: 'travel-insurance',
    group: 'Before you go',
    label: 'Travel insurance covering medical evacuation',
    detail: 'Confirm coverage applies in both Nepal and Japan.',
  },
  {
    id: 'vaccinations',
    group: 'Before you go',
    label: 'Vaccinations / health certificates up to date',
    detail: 'Check current guidance for both destinations before departure.',
  },
  {
    id: 'document-copies',
    group: 'Carry with you',
    label: 'Printed and digital copies of passport, visas, and insurance',
  },
  {
    id: 'emergency-contact-card',
    group: 'Carry with you',
    label: 'Emergency contact card',
    detail: 'Embassy numbers, traveler names, and a home contact — see the Emergency & Embassy section above.',
  },
  {
    id: 'medications',
    group: 'Carry with you',
    label: 'Prescription medications in original packaging',
    detail: "Bring a doctor's note for any controlled substances.",
  },
  {
    id: 'currency-cards',
    group: 'Carry with you',
    label: 'Local currency and a backup payment card',
    detail: 'Nepali rupees and Japanese yen; notify your bank of travel dates.',
  },
  {
    id: 'cloud-backups',
    group: 'Digital backups',
    label: 'Scanned copies of all documents saved to cloud storage',
    detail: 'Or email copies to yourself so they are reachable without the physical originals.',
  },
  {
    id: 'offline-safety-kit',
    group: 'Digital backups',
    label: 'This safety kit bookmarked for offline access',
    detail: 'The /safety page works without a network connection once loaded.',
  },
  {
    id: 'booking-confirmations',
    group: 'Digital backups',
    label: 'Flight and hotel confirmation numbers saved offline',
  },
];

export const DOCUMENT_CHECKLIST = z.array(checklistItemSchema).parse(rawChecklist);
