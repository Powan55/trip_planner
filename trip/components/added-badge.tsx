import { Check } from 'lucide-react';

/**
 * Compact card-corner planned-state chip. Renders nothing when not added.
 * State is conveyed by text + icon, never color alone (a11y). Static markup — no
 * motion; all Tailwind classes are literals. Presentational only:
 * callers pass `added` in; it holds no hooks/store access.
 *
 * It is a STRUCK chip: this place is committed to a day, so the border is the struck
 * --text-hi rule and the word says so. Solid backing rather than a blur, because it sits
 * over bright card imagery and a blur there is a per-frame cost for a 5-character label.
 */
export default function AddedBadge({ added, testId }: { added: boolean; testId: string }) {
  if (!added) return null;
  return (
    <span
      data-testid={testId}
      className="chip chip--struck bg-[rgb(var(--surface)/0.82)]"
    >
      <Check className="w-3 h-3 shrink-0" />
      Added
    </span>
  );
}
