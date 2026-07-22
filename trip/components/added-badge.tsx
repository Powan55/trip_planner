import { Check } from 'lucide-react';

/**
 * Compact card-corner planned-state chip. Renders nothing when not added.
 * State is conveyed by text + icon, never color alone (a11y). Static markup — no
 * motion; all Tailwind classes are literals. Presentational only:
 * callers pass `added` in; it holds no hooks/store access.
 *
 * Solid dark backing + gold text reads over bright card imagery (mirrors the
 * photo-rating pill) and stays visually distinct from the solid-gold "Must-see" chip.
 */
export default function AddedBadge({ added, testId }: { added: boolean; testId: string }) {
  if (!added) return null;
  return (
    <span
      data-testid={testId}
      className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-gold-400/40 text-gold-300 text-[10px] font-semibold uppercase tracking-wide"
    >
      <Check className="w-3 h-3 shrink-0" />
      Added
    </span>
  );
}
