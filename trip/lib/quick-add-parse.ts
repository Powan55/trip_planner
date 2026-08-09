import { parseTimeString } from '@/core/dates';

/**
 * — the sticky composer's time EXTRACTOR.
 *
 * `parseTimeString` is ANCHORED (`^…$`): it parses a
 * whole trimmed string and returns `undefined` for anything with text around it. It is shared
 * with the v4→v5 vault migration, whose comment requires both call sites to agree, so it must
 * NOT be widened. This module is the widening-free way to get "7pm dinner" to work: it peels a
 * candidate token off the FRONT or the BACK of the typed text and hands that token — alone — to
 * the pinned parser. All time knowledge stays in exactly one place.
 *
 * Returns the 0–1439 minutes-from-midnight convention `parseTimeString` already uses, or no
 * `startMinutes` at all when nothing parses (an untimed item, which is the common case).
 *
 * Two rules that matter:
 * - A candidate is only accepted if a NON-EMPTY title survives it. "7pm" typed alone stays the
 * title — an item with no title can't be added, so swallowing the whole string is never right.
 * - The seam is cleaned: the connector left behind ("dinner at" ← "dinner at 7pm", "- breakfast"
 * ← "08:30 - breakfast") is trimmed, so the stored title reads like a title.
 *
 * Deliberately minimal: word-window candidates + one delegation, no grammar, no new dep. Two words is the
 * widest window because that is the widest shape the parser accepts ("12:30 p.m.", "7 pm").
 */

/** Connector junk left at the seam after a LEADING token is peeled. */
const LEAD_JUNK = /^(?:[-–—:,;@]+\s*|at\s+)+/i;
/** Connector junk left at the seam after a TRAILING token is peeled. */
const TRAIL_JUNK = /(?:\s*[-–—:,;@]+|\s+at)+$/i;

export interface QuickAddParts {
  /** The typed text with the time token (and its seam connector) removed. Trimmed. */
  title: string;
  /** Minutes from midnight, 0–1439 — omitted when nothing parsed (untimed item). */
  startMinutes?: number;
}

export function extractQuickAddTime(raw: string): QuickAddParts {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '') return { title: '' };
  // The WHOLE input is a time ("7pm", "12:30 p.m.") → it is the title, untimed. Checked before
  // the windows below, which would otherwise peel "12:30" and leave a title of "p.m.".
  if (parseTimeString(trimmed) !== undefined) return { title: trimmed };

  const words = trimmed.split(/\s+/);
  // Widest window first on each side, so "7 pm dinner" beats the bare "7".
  const candidates: Array<{ token: string; rest: string; lead: boolean }> = [];
  for (const n of [2, 1]) {
    if (words.length <= n) continue; // a candidate that eats every word leaves no title
    candidates.push({ token: words.slice(0, n).join(' '), rest: words.slice(n).join(' '), lead: true });
    candidates.push({ token: words.slice(-n).join(' '), rest: words.slice(0, -n).join(' '), lead: false });
  }

  for (const { token, rest, lead } of candidates) {
    const startMinutes = parseTimeString(token);
    if (startMinutes === undefined) continue;
    const title = (lead ? rest.replace(LEAD_JUNK, '') : rest.replace(TRAIL_JUNK, '')).trim();
    if (title === '') continue; // never produce a titleless item
    return { title, startMinutes };
  }

  return { title: trimmed };
}
