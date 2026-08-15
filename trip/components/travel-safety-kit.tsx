import { EMERGENCY_CONTACTS, SAFETY_PHRASES, DOCUMENT_CHECKLIST } from '@/core/content/safety';
import type { EmergencyContact, Phrase, ChecklistItem } from '@/core/content/safety';

/**
 * TravelSafetyKit — the offline travel-safety reference rendered on `/safety`:
 * emergency & embassy contacts, a Nepali/Japanese phrasebook, and a document
 * checklist. Pure presentational — no state, no fetch, no persistence. Static
 * markup only (no motion-only affordance), so it is reduced-motion-safe by construction.
 *
 * A11y: each of the three sections is its own `<section>` with a real
 * `h2`, grouped content gets an `h3`; `tel:` links carry an explicit `aria-label` (accessible
 * name) distinct from their visible digit string; every interactive
 * `tel:` link is ≥44px tall; tables get a scroll wrapper so they never force page-level
 * horizontal overflow at narrow widths. #2 adds the native script to every phrase row,
 * each carrying `lang="ne"` / `lang="ja"` — see `ScriptCell` below.
 */
export default function TravelSafetyKit() {
  const contactsByCountry = groupBy(EMERGENCY_CONTACTS, (c) => c.country);
  const phrasesByCategory = groupBy(SAFETY_PHRASES, (p) => p.category);
  const checklistByGroup = groupBy(DOCUMENT_CHECKLIST, (i) => i.group);

  return (
    <div data-testid="safety-kit" className="mx-auto w-full max-w-4xl px-4 pb-20 sm:px-6">
      {/* ── 1. Emergency & embassy contacts ─────────────────────────────────────────────── */}
      <section aria-labelledby="safety-emergency-heading" className="mb-14">
        <h2 id="safety-emergency-heading" className="font-display text-2xl font-bold text-white sm:text-3xl">
          Emergency &amp; Embassy Contacts
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Tap a number to call. Numbers flagged below could not be re-confirmed against a live
          source in this build — double-check them before you travel.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {(['Nepal', 'Japan'] as const).map((country) => (
            <div key={country} className="glass-subtle rounded-2xl p-5">
              <h3 className="font-display text-lg font-bold text-white">{country}</h3>
              <ul className="mt-3 flex flex-col gap-3">
                {(contactsByCountry[country] ?? []).map((c) => (
                  <ContactRow key={c.id} contact={c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. Phrasebook ────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="safety-phrasebook-heading" className="mb-14">
        <h2 id="safety-phrasebook-heading" className="font-display text-2xl font-bold text-white sm:text-3xl">
          Phrasebook
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          {SAFETY_PHRASES.length} essential phrases, each in the native script with a romanization
          you can read aloud. Nothing here needs a connection — if saying it does not land, show
          someone the script.
        </p>

        <div className="mt-6 flex flex-col gap-8">
          {Object.entries(phrasesByCategory).map(([category, phrases]) => (
            <div key={category}>
              <h3 className="font-display text-base font-semibold text-ink-hi">{category}</h3>
              <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                  <caption className="sr-only">{category} phrases — English, Nepali in Devanagari with romanization, Japanese in kana/kanji with romanization</caption>
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-ink-mid">
                      <th scope="col" className="px-4 py-2 font-medium">English</th>
                      <th scope="col" className="px-4 py-2 font-medium">Nepali</th>
                      <th scope="col" className="px-4 py-2 font-medium">Japanese</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phrases.map((p) => (
                      <PhraseRow key={p.id} phrase={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. Document checklist ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="safety-checklist-heading">
        <h2 id="safety-checklist-heading" className="font-display text-2xl font-bold text-white sm:text-3xl">
          Document Checklist
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">What to arrange, carry, and back up.</p>

        <div className="mt-6 flex flex-col gap-6">
          {Object.entries(checklistByGroup).map(([group, items]) => (
            <div key={group} className="glass-subtle rounded-2xl p-5">
              <h3 className="font-display text-base font-semibold text-ink-hi">{group}</h3>
              <ul className="mt-3 flex flex-col gap-3">
                {items.map((item) => (
                  <ChecklistRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContactRow({ contact }: { contact: EmergencyContact }) {
  return (
    <li data-testid={`safety-contact-${contact.id}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-hi">{contact.service}</span>
        <a
          href={`tel:${contact.tel}`}
          aria-label={`Call ${contact.service}, ${contact.number}`}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-primary/10 px-3 font-mono text-sm font-semibold text-primary outline-none transition-colors hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {contact.number}
        </a>
      </div>
      {!contact.verified && contact.note && (
        <p className="text-xs text-amber-300/90">Unverified this session: {contact.note}</p>
      )}
    </li>
  );
}

function PhraseRow({ phrase }: { phrase: Phrase }) {
  return (
    <tr data-testid={`safety-phrase-${phrase.id}`} className="border-b border-white/5 last:border-0">
      <td className="px-4 py-2 align-top text-ink-hi">{phrase.english}</td>
      <ScriptCell lang="ne" script={phrase.nepaliScript} roman={phrase.nepali} />
      <ScriptCell lang="ja" script={phrase.japaneseScript} roman={phrase.japanese} />
    </tr>
  );
}

/**
 * One phrase cell: the native script on top, the read-aloud romanization beneath it.
 *
 * `lang` is LOAD-BEARING (#2 accessibility AC), not decoration. Without it a screen
 * reader stays in the page's `lang="en"` voice and either spells Devanagari out or skips it;
 * with it the reader switches to a Nepali/Japanese voice, and the browser resolves each glyph
 * against that language's OS fallback face. The app ships no webfont covering either script and
 * deliberately never will — see the OFFLINE FONTS note in `core/content/safety.ts`.
 *
 * Two lines in one cell rather than five columns: the table already scrolls horizontally at
 * `min-w-[480px]` (D-022), and two more columns would make that scroll permanent on a phone.
 * Both lines sit at ≥ white/70 on the dark field (D-100 / D-235 AA-at-rest floor).
 */
function ScriptCell({ lang, script, roman }: { lang: 'ne' | 'ja'; script: string; roman: string }) {
  return (
    <td className="px-4 py-2 align-top">
      <span lang={lang} className="block text-base leading-snug text-ink-hi">
        {script}
      </span>
      <span className="mt-0.5 block text-xs text-ink-mid">{roman}</span>
    </td>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <li data-testid={`safety-checklist-${item.id}`} className="flex gap-2 text-sm">
      <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
        ✓
      </span>
      <span>
        <span className="text-ink-hi">{item.label}</span>
        {item.detail && <span className="block text-xs text-ink-mid">{item.detail}</span>}
      </span>
    </li>
  );
}

/** Groups `items` by `key(item)`, preserving first-seen key order. */
function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
