import { z } from 'zod';

/**
 * SAFETY-CRITICAL static content — an offline travel-safety reference for the
 * Nepal + Japan legs: emergency/embassy numbers, hazard/alert notes (earthquake response,
 * aftershocks, general strikes — #255), a Nepali/Japanese phrasebook (native script
 * plus romanization, #2), and a document checklist. Framework-free: plain TS + zod.
 *
 * DELIBERATELY SELF-CONTAINED: this file does NOT import from
 * or extend `core/content/schema.ts` —
 * it declares its own local `.strict()` Zod shapes below and `.parse()`s its own data at
 * MODULE LOAD (unlike `core/content/schema.ts`, whose schemas only run authoring/CI-time via
 * `lib/__tests__/content-validation.test.ts` — here the parse is eager, at import time, so a
 * malformed entry fails the build immediately, not just in a separate validate step). Static
 * data only — no fetch, no key, no persistence.
 *
 * ── SAFETY-CRITICAL ACCURACY (read before editing) ─────────────────────────────────────────
 * Every emergency/embassy contact below cites its official source in `sourceUrl` and carries
 * a `verified` flag:
 * - `verified: true` — the long-standing, universally-published national emergency number
 * for that service (Nepal Police 100 / Ambulance 102 / Fire 101; Japan Police 110 /
 * Fire+Ambulance 119). These have been stable for decades and are corroborated by every
 * government and embassy travel-safety page; high confidence.
 * - `verified: false` — a specific switchboard/hotline digit string (a tourist-police line,
 * an embassy main number, a tourist-info hotline) that this build environment could NOT
 * re-confirm against a LIVE fetch (no web-browsing tool was available this session) — each
 * carries a `note` telling the traveler to reconfirm on the linked official page before
 * relying on it. Flagged explicitly in the for a human spot-check. DO NOT
 * flip `verified` to `true` without an actual live check against `sourceUrl`.
 */

// ── Emergency & embassy contacts ────────────────────────────────────────────────────────────

export const emergencyContactSchema = z
  .object({
    id: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    service: z.string().min(1),
    /** Display string, e.g. "100" or "+977-1-423-4000". */
    number: z.string().min(1),
    /** `tel:` href value — digits only, optional leading "+". href discipline. */
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

// ── Hazard & alert notes (#255) ─────────────────────────────────────────────────────────────
// Deliberately static, not a live feed: this page's whole point is working offline in an
// emergency, so these are the two things worth knowing before a signal drops, not a disaster
// manual.

export const hazardNoteSchema = z
  .object({
    id: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export type HazardNote = z.infer<typeof hazardNoteSchema>;

const rawHazardNotes: HazardNote[] = [
  {
    id: 'jp-earthquake-alert',
    country: 'Japan',
    title: 'Earthquake Early Warning',
    body: 'A jarring alarm tone on phones, TVs, and public speakers means an earthquake alert — it plays in Japanese only, with no translation. When it sounds: drop, take cover under sturdy furniture, and hold on until the shaking stops.',
  },
  {
    id: 'np-aftershock-strike',
    country: 'Nepal',
    title: 'Aftershocks & Bandh (General Strikes)',
    body: "After any quake, move to open ground away from walls and buildings, and learn your accommodation's assembly point on arrival. Separately, a bandh (general strike) can halt road transport with little warning — ask your accommodation the evening before a travel day; a tourist-shuttle exemption typically applies.",
  },
];

export const HAZARD_NOTES = z.array(hazardNoteSchema).parse(rawHazardNotes);

// ── Phrasebook (Nepali + Japanese: native script AND romanization) ─────────────────────────
//
// #2 added the NATIVE SCRIPT to every row. Two fields per language, both required:
// the romanization is what the traveler READS ALOUD, the script is what they POINT AT when the
// reading-aloud fails. Neither replaces the other, so neither is optional.
//
// ── OFFLINE FONTS (read before "fixing" the rendering) ─────────────────────────────────────
// Nothing here downloads a font, and nothing here may start to. The app self-hosts exactly two
// faces, both `subsets: ['latin']` (app/layout.tsx: Geist + Instrument Serif), so NO webfont
// this app ships contains a Devanagari or a kana/kanji glyph — by design, because a font fetch
// is precisely the thing that fails on a plane, which is the one situation a phrasebook exists
// for. The browser's per-glyph fallback walks the `font-sans` stack
// (`var(--font-sans)` → `system-ui` → `sans-serif`, tailwind.config.ts) and resolves these
// glyphs from the OPERATING SYSTEM: Nirmala UI / Yu Gothic on Windows, Devanagari Sangam MN /
// Hiragino Sans on Apple, Noto Sans Devanagari / Noto Sans CJK on Android and most Linux.
// Zero bytes, zero requests, works with the radio off. Do NOT add a Devanagari or CJK subset
// to the `next/font` calls to "guarantee" the glyphs — that trades a working offline page for
// a download that can fail.
//
// The `lang="ne"` / `lang="ja"` attributes on the rendered script spans
// (`components/travel-safety-kit.tsx`) are the other half of this: they let a screen reader
// switch voice instead of spelling Devanagari out in English, and they let the browser pick
// the right per-language fallback face. They are an acceptance criterion, not decoration.

const phraseCategories = [
  'Greetings',
  'Politeness',
  'Basics',
  'Numbers',
  'Emergency',
  'Directions',
  'Food & Shopping',
] as const;

// Script guards: the failure mode these catch is a romanization pasted into a script field (or
// vice versa), which renders as plausible-looking nonsense rather than throwing. "Contains at
// least one" rather than "is entirely", because real rows legitimately carry ASCII: the "..."
// placeholder in "My name is ...", the "/" in "Left / Right", the "(१)" bracket in Numbers.
// Escapes, not literal ranges, so the guards stay legible (and diffable) in any editor.
/** At least one Devanagari codepoint (U+0900–U+097F — the block includes the १-९ digits). */
const devanagariText = z.string().regex(/[\u0900-\u097F]/, 'must contain Devanagari script');
/** At least one hiragana (U+3040–309F), katakana (U+30A0–30FF), or CJK ideograph (U+4E00–9FFF). */
const kanaKanjiText = z
  .string()
  .regex(/[\u3040-\u30FF\u4E00-\u9FFF]/, 'must contain kana or kanji');

export const phraseSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(phraseCategories),
    english: z.string().min(1),
    /** Romanized Nepali — the read-aloud field. */
    nepali: z.string().min(1),
    /** Nepali in Devanagari. Rendered with `lang="ne"`. */
    nepaliScript: devanagariText,
    /** Romanized Japanese (romaji) — the read-aloud field. Particle を is romanized "o", as spoken. */
    japanese: z.string().min(1),
    /** Japanese in kana/kanji. Rendered with `lang="ja"`. */
    japaneseScript: kanaKanjiText,
  })
  .strict();

export type Phrase = z.infer<typeof phraseSchema>;

// Row order here IS the display order: `travel-safety-kit.tsx` groups by category preserving
// first-seen order, so the categories render Greetings → … → Food & Shopping as listed.
const rawPhrases: Phrase[] = [
  { id: 'hello', category: 'Greetings', english: 'Hello', nepali: 'Namaste', nepaliScript: 'नमस्ते', japanese: 'Konnichiwa', japaneseScript: 'こんにちは' },
  { id: 'good-morning', category: 'Greetings', english: 'Good morning', nepali: 'Shubha prabhat', nepaliScript: 'शुभ प्रभात', japanese: 'Ohayou gozaimasu', japaneseScript: 'おはようございます' },
  { id: 'good-night', category: 'Greetings', english: 'Good night', nepali: 'Shubha ratri', nepaliScript: 'शुभ रात्रि', japanese: 'Oyasumi nasai', japaneseScript: 'おやすみなさい' },
  { id: 'goodbye', category: 'Greetings', english: 'Goodbye', nepali: 'Pheri bhetaunla', nepaliScript: 'फेरि भेटौंला', japanese: 'Sayounara', japaneseScript: 'さようなら' },
  { id: 'thank-you', category: 'Politeness', english: 'Thank you', nepali: 'Dhanyabaad', nepaliScript: 'धन्यवाद', japanese: 'Arigatou gozaimasu', japaneseScript: 'ありがとうございます' },
  { id: 'please', category: 'Politeness', english: 'Please', nepali: 'Kripaya', nepaliScript: 'कृपया', japanese: 'Onegaishimasu', japaneseScript: 'お願いします' },
  { id: 'sorry', category: 'Politeness', english: 'Excuse me / Sorry', nepali: 'Maaf garnuhos', nepaliScript: 'माफ गर्नुहोस्', japanese: 'Sumimasen', japaneseScript: 'すみません' },
  { id: 'yes', category: 'Basics', english: 'Yes', nepali: 'Ho', nepaliScript: 'हो', japanese: 'Hai', japaneseScript: 'はい' },
  { id: 'no', category: 'Basics', english: 'No', nepali: 'Hoina', nepaliScript: 'होइन', japanese: 'Iie', japaneseScript: 'いいえ' },
  { id: 'dont-understand', category: 'Basics', english: "I don't understand", nepali: 'Malai bujhena', nepaliScript: 'मलाई बुझेन', japanese: 'Wakarimasen', japaneseScript: 'わかりません' },
  // The Nepali half says "angreji", the Nepali word for English — the previous romanization
  // embedded the English word "english" mid-sentence, which is not what the script reads.
  { id: 'speak-english', category: 'Basics', english: 'Do you speak English?', nepali: 'Tapai angreji bolnuhunchha?', nepaliScript: 'तपाईं अङ्ग्रेजी बोल्नुहुन्छ?', japanese: 'Eigo o hanasemasu ka?', japaneseScript: '英語を話せますか？' },
  // Nepali puts the name BEFORE the verb: "Mero naam <name> ho", not "Mero naam ho <name>".
  { id: 'my-name-is', category: 'Basics', english: 'My name is ...', nepali: 'Mero naam ... ho', nepaliScript: 'मेरो नाम ... हो', japanese: 'Watashi no namae wa ... desu', japaneseScript: '私の名前は...です' },
  // Numbers carry the Devanagari digit in brackets: Nepali bus boards, fare charts and market
  // signs still print १-९, so the traveler needs to recognize the numeral, not just say it.
  { id: 'one', category: 'Numbers', english: 'One (1)', nepali: 'Ek', nepaliScript: 'एक (१)', japanese: 'Ichi', japaneseScript: '一' },
  { id: 'two', category: 'Numbers', english: 'Two (2)', nepali: 'Dui', nepaliScript: 'दुई (२)', japanese: 'Ni', japaneseScript: '二' },
  { id: 'three', category: 'Numbers', english: 'Three (3)', nepali: 'Tin', nepaliScript: 'तीन (३)', japanese: 'San', japaneseScript: '三' },
  { id: 'five', category: 'Numbers', english: 'Five (5)', nepali: 'Panch', nepaliScript: 'पाँच (५)', japanese: 'Go', japaneseScript: '五' },
  { id: 'ten', category: 'Numbers', english: 'Ten (10)', nepali: 'Das', nepaliScript: 'दश (१०)', japanese: 'Juu', japaneseScript: '十' },
  { id: 'hundred', category: 'Numbers', english: 'Hundred (100)', nepali: 'Saya', nepaliScript: 'सय (१००)', japanese: 'Hyaku', japaneseScript: '百' },
  { id: 'thousand', category: 'Numbers', english: 'Thousand (1000)', nepali: 'Hajar', nepaliScript: 'हजार (१०००)', japanese: 'Sen', japaneseScript: '千' },
  { id: 'help', category: 'Emergency', english: 'Help!', nepali: 'Guhaar!', nepaliScript: 'गुहार!', japanese: 'Tasukete!', japaneseScript: '助けて！' },
  { id: 'call-police', category: 'Emergency', english: 'Call the police', nepali: 'Praharilai bolaunuhos', nepaliScript: 'प्रहरीलाई बोलाउनुहोस्', japanese: 'Keisatsu o yonde kudasai', japaneseScript: '警察を呼んでください' },
  { id: 'need-doctor', category: 'Emergency', english: 'I need a doctor', nepali: 'Malai daktar chahiyo', nepaliScript: 'मलाई डाक्टर चाहियो', japanese: 'Isha ga hitsuyou desu', japaneseScript: '医者が必要です' },
  { id: 'where-hospital', category: 'Emergency', english: 'Where is the hospital?', nepali: 'Aspatal kaha cha?', nepaliScript: 'अस्पताल कहाँ छ?', japanese: 'Byouin wa doko desu ka?', japaneseScript: '病院はどこですか？' },
  { id: 'where-bathroom', category: 'Directions', english: 'Where is the bathroom?', nepali: 'Charpi kaha cha?', nepaliScript: 'चर्पी कहाँ छ?', japanese: 'Toire wa doko desu ka?', japaneseScript: 'トイレはどこですか？' },
  { id: 'how-to-get-to', category: 'Directions', english: 'How do I get to ...?', nepali: '... samma kasari jane?', nepaliScript: '... सम्म कसरी जाने?', japanese: '... made dou ikeba ii desu ka?', japaneseScript: '...までどう行けばいいですか？' },
  { id: 'where-station', category: 'Directions', english: 'Where is the station?', nepali: 'Steshan kaha cha?', nepaliScript: 'स्टेशन कहाँ छ?', japanese: 'Eki wa doko desu ka?', japaneseScript: '駅はどこですか？' },
  { id: 'go-straight', category: 'Directions', english: 'Go straight', nepali: 'Sidha januhos', nepaliScript: 'सीधा जानुहोस्', japanese: 'Massugu itte kudasai', japaneseScript: 'まっすぐ行ってください' },
  { id: 'left-right', category: 'Directions', english: 'Left / Right', nepali: 'Baya / Daya', nepaliScript: 'बायाँ / दायाँ', japanese: 'Hidari / Migi', japaneseScript: '左 / 右' },
  { id: 'how-much', category: 'Food & Shopping', english: 'How much is this?', nepali: 'Yo kati ho?', nepaliScript: 'यो कति हो?', japanese: 'Kore wa ikura desu ka?', japaneseScript: 'これはいくらですか？' },
  { id: 'water-please', category: 'Food & Shopping', english: 'Water, please', nepali: 'Paani dinuhos', nepaliScript: 'पानी दिनुहोस्', japanese: 'Mizu o kudasai', japaneseScript: '水をください' },
  { id: 'vegetarian', category: 'Food & Shopping', english: 'I am vegetarian', nepali: 'Ma shakahari hu', nepaliScript: 'म शाकाहारी हुँ', japanese: 'Watashi wa bejitarian desu', japaneseScript: '私はベジタリアンです' },
  { id: 'delicious', category: 'Food & Shopping', english: "It's delicious", nepali: 'Mitho cha', nepaliScript: 'मीठो छ', japanese: 'Oishii desu', japaneseScript: 'おいしいです' },
  { id: 'bill-please', category: 'Food & Shopping', english: 'The bill, please', nepali: 'Bil dinuhos', nepaliScript: 'बिल दिनुहोस्', japanese: 'O-kaikei onegaishimasu', japaneseScript: 'お会計お願いします' },
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
    // Kept in sync with core/docs/model.ts's DEFAULT_TEMPLATE row of the same id (#280,
    // #252's date anchor): the online pre-application receipt is valid 15 days, so an early
    // submission is a false green on the row that gates entry.
    detail: 'Visa-on-arrival at Tribhuvan Intl (KTM), or the online pre-application from 26 Nov 2026 (receipt valid 15 days) — bring passport photos and the entry fee in cash.',
  },
  {
    id: 'japan-entry',
    group: 'Before you go',
    label: 'Japan entry requirements confirmed',
    // Kept in sync with core/docs/model.ts's DEFAULT_TEMPLATE row of the same id (#280).
    detail: 'Check visa/visa-waiver eligibility for your nationality, complete Visit Japan Web pre-registration, and save the QR code offline before you land.',
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
