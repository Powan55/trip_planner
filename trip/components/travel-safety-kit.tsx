'use client';

import { AlertTriangle } from 'lucide-react';
import { EMERGENCY_CONTACTS, HAZARD_NOTES, SAFETY_PHRASES, DOCUMENT_CHECKLIST } from '@/core/content/safety';
import type { EmergencyContact, HazardNote, Phrase, ChecklistItem } from '@/core/content/safety';
import { useWakeLock } from '@/lib/use-wake-lock';

/**
 * TravelSafetyKit — the offline travel-safety reference rendered on `/safety`:
 * emergency & embassy contacts, hazard/alert notes, a Nepali/Japanese phrasebook, and a document
 * checklist. Mostly static markup (no motion-only affordance, so it is reduced-motion-safe by
 * construction) — its ONE piece of state is the Screen Wake Lock (issue #247), held for as long
 * as this component is mounted: reading a phrase off the phone to someone else is the same
 * bounded, deliberate hold-up-the-phone interaction as Travel Mode's Essentials card
 * (`components/travel-essentials-card.tsx`), the wake lock's other always-on call site.
 *
 * A11y: each section is its own `<section>` with a real
 * `h2`, grouped content gets an `h3`; `tel:` links carry an explicit `aria-label` (accessible
 * name) distinct from their visible digit string; every interactive
 * `tel:` link is ≥44px tall; tables get a scroll wrapper so they never force page-level
 * horizontal overflow at narrow widths. #2 adds the native script to every phrase row,
 * each carrying `lang="ne"` / `lang="ja"` — see `ScriptCell` below.
 */
export default function TravelSafetyKit() {
  // Always-on while this page is mounted, same as TravelEssentialsCard — feature-detected,
  // visibility-aware, releases on unmount, never throws (see lib/use-wake-lock.ts).
  useWakeLock(true);

  const contactsByCountry = groupBy(EMERGENCY_CONTACTS, (c) => c.country);
  const hazardsByCountry = groupBy(HAZARD_NOTES, (n) => n.country);
  const phrasesByCategory = groupBy(SAFETY_PHRASES, (p) => p.category);
  const checklistByGroup = groupBy(DOCUMENT_CHECKLIST, (i) => i.group);

  return (
    <div data-testid="safety-kit" className="mx-auto w-full max-w-4xl pb-20">
      {/* ── 1. Emergency & embassy contacts ─────────────────────────────────────────────── */}
      <section aria-labelledby="safety-emergency-heading" className="mb-14">
        <div className="sec px-gut">
          <h2 id="safety-emergency-heading">Emergency &amp; Embassy Contacts</h2>
          <span className="sub">{EMERGENCY_CONTACTS.length} numbers · offline</span>
        </div>
        <p className="mb-4 max-w-2xl px-gut text-t-sm text-ink-mid">
          Tap a row to call. Numbers flagged below could not be re-confirmed against a live source
          in this build — double-check them before you travel.
        </p>

        <div>
          {(['Nepal', 'Japan'] as const).map((country) => (
            <div key={country}>
              <div className="head static flex-wrap">
                <span className="f">
                  <span className="k">Country</span>
                  <h3 className="v">{country}</h3>
                </span>
                <span className="f">
                  <span className="k">Numbers</span>
                  <span className="v">{(contactsByCountry[country] ?? []).length}</span>
                </span>
              </div>
              <ul className="list">
                {(contactsByCountry[country] ?? []).map((c) => (
                  <ContactRow key={c.id} contact={c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. Hazard & alert notes ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="safety-hazards-heading" className="mb-14">
        <div className="sec px-gut">
          <h2 id="safety-hazards-heading">Hazards &amp; Local Alerts</h2>
          <span className="sub">background · not a live feed</span>
        </div>
        <p className="mb-4 max-w-2xl px-gut text-t-sm text-ink-mid">
          Two things worth knowing before you need them.
        </p>

        <div>
          {(['Japan', 'Nepal'] as const).map((country) => (
            <div key={country}>
              <div className="head static flex-wrap">
                <span className="f">
                  <span className="k">Country</span>
                  <h3 className="v">{country}</h3>
                </span>
              </div>
              <ul className="list">
                {(hazardsByCountry[country] ?? []).map((note) => (
                  <HazardRow key={note.id} note={note} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. Phrasebook ────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="safety-phrasebook-heading" className="mb-14">
        <div className="sec px-gut">
          <h2 id="safety-phrasebook-heading">Phrasebook</h2>
          <span className="sub">{SAFETY_PHRASES.length} phrases · offline</span>
        </div>
        <p className="mb-4 max-w-2xl px-gut text-t-sm text-ink-mid">
          Each phrase in the native script with a romanization you can read aloud. Nothing here
          needs a connection — if saying it does not land, show someone the script.
        </p>

        <div className="flex flex-col gap-8">
          {Object.entries(phrasesByCategory).map(([category, phrases]) => (
            <div key={category}>
              <div className="head static flex-wrap">
                <span className="f">
                  <span className="k">Category</span>
                  <h3 className="v">{category}</h3>
                </span>
                <span className="f">
                  <span className="k">Rows</span>
                  <span className="v">{phrases.length}</span>
                </span>
              </div>
              {/* tabIndex=0 keeps the horizontal scroller keyboard-reachable (axe
                  scrollable-region-focusable): the table holds only read-only text, so it has
                  no focusable child of its own to scroll it with. Same idiom as
                  place-detail-sheet.tsx, plus a visible ring since this one sits in the page. */}
              <div
                tabIndex={0}
                role="region"
                aria-label={`${category} phrases`}
                className="overflow-x-auto border-b-hair border-border outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {/* #223 — `print:min-w-0` releases the 480px floor on paper. The floor exists so
                    the three columns stay side by side on a phone and the wrapper above scrolls;
                    a sheet has no scroll to offer, so on anything narrower than A4 the table
                    would simply run off the right edge and lose the Japanese column. The print
                    block's `overflow: visible` unclips the wrapper; this is what lets the table
                    reflow into the width it is actually given. */}
                <table className="w-full min-w-[480px] border-collapse text-left text-t-body print:min-w-0">
                  <caption className="sr-only">{category} phrases — English, Nepali in Devanagari with romanization, Japanese in kana/kanji with romanization</caption>
                  <thead>
                    <tr className="border-b-hair border-border">
                      <th scope="col" className="pr px-gut py-2">English</th>
                      <th scope="col" className="pr px-gut py-2">Nepali</th>
                      <th scope="col" className="pr px-gut py-2">Japanese</th>
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

      {/* ── 4. Document checklist ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="safety-checklist-heading">
        <div className="sec px-gut">
          <h2 id="safety-checklist-heading">Document Checklist</h2>
          <span className="sub">{DOCUMENT_CHECKLIST.length} items · reference</span>
        </div>
        <p className="mb-4 max-w-2xl px-gut text-t-sm text-ink-mid">
          What to arrange, carry, and back up.
        </p>

        <div className="flex flex-col gap-6">
          {Object.entries(checklistByGroup).map(([group, items]) => (
            <div key={group}>
              <div className="head static flex-wrap">
                <span className="f">
                  <span className="k">Group</span>
                  <h3 className="v">{group}</h3>
                </span>
                <span className="f">
                  <span className="k">Items</span>
                  <span className="v">{items.length}</span>
                </span>
              </div>
              <ul className="list">
                {items.map((item, i) => (
                  <ChecklistRow key={item.id} item={item} n={i + 1} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * One contact. THE WHOLE ROW IS THE `tel:` LINK — one hand, cold, on a street you cannot read is
 * the scene this page exists for, so the tap target is the 44px row rather than the digits inside
 * it. Still exactly one `<a>` per row (e2e/safety.spec.ts locates it that way), and the
 * accessible name still differs from the visible digit string.
 *
 * An unverified number is drawn HOLLOW on its tag and its note, but its SERVICE NAME keeps the top
 * ink tier: the mark grammar says "not yet committed", and it is true of the confirmation, not of
 * the emergency service. Dimming "Police" to signal a stale source would be the wrong statement.
 *
 * TWO COLUMNS, NOT THREE: the row drops the leading icon slot the other lists keep. A phone glyph
 * beside a phone number is decoration, and at 390px it cost 70px that the longest service name
 * ("Japan Visitor Hotline (24/7 multilingual tourist assistance, JNTO)") needs, next to a
 * 15-character number set at the numeral tier.
 */
function ContactRow({ contact }: { contact: EmergencyContact }) {
  const unverified = !contact.verified && !!contact.note;
  return (
    <li data-testid={`safety-contact-${contact.id}`}>
      <a
        href={`tel:${contact.tel}`}
        aria-label={`Call ${contact.service}, ${contact.number}`}
        className="r [--cols:1fr_auto] no-underline"
      >
        <span className="min-w-0">
          <h3>{contact.service}</h3>
          {unverified && (
            <>
              <span className="hollow-tag mt-1">unverified</span>
              <span className="mt !normal-case !tracking-normal">{contact.note}</span>
            </>
          )}
        </span>
        <span className="num self-center whitespace-nowrap text-n-sm text-ink-hi">{contact.number}</span>
      </a>
    </li>
  );
}

function HazardRow({ note }: { note: HazardNote }) {
  return (
    <li data-testid={`safety-hazard-${note.id}`} className="r">
      <span className="tm flex items-center">
        <AlertTriangle className="h-4 w-4 text-ink-lo" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <h3>{note.title}</h3>
        <span className="mt !normal-case !tracking-normal text-ink-mid">{note.body}</span>
      </span>
    </li>
  );
}

function PhraseRow({ phrase }: { phrase: Phrase }) {
  return (
    <tr data-testid={`safety-phrase-${phrase.id}`} className="border-b-hair border-border last:border-0">
      <td className="px-gut py-2 align-top text-t-body text-ink-hi">{phrase.english}</td>
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
 * Both lines sit on the solid text tiers on the dark field, so both clear AA at rest
 * (issue #27 replaced the old `white/70` alpha; --text-mid is 8.85:1 at its worst step).
 */
function ScriptCell({ lang, script, roman }: { lang: 'ne' | 'ja'; script: string; roman: string }) {
  return (
    <td className="px-gut py-2 align-top">
      <span lang={lang} className="block text-t-lead leading-snug text-ink-hi">
        {script}
      </span>
      <span className="mt-0.5 block text-t-sm text-ink-mid">{roman}</span>
    </td>
  );
}

function ChecklistRow({ item, n }: { item: ChecklistItem; n: number }) {
  return (
    <li data-testid={`safety-checklist-${item.id}`} className="r">
      <span className="tm">{String(n).padStart(2, '0')}</span>
      <span className="min-w-0">
        <h3>{item.label}</h3>
        {item.detail && (
          <span className="mt !normal-case !tracking-normal text-ink-mid">{item.detail}</span>
        )}
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
