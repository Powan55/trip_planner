'use client';

import { Button } from '@/components/ui/button';
import { useItemConflict } from '@/hooks/use-item-conflict';

const LABELS: Record<string, string> = { title: 'title', time: 'time', notes: 'notes', location: 'location' };

function summary(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, label] of Object.entries(LABELS)) {
    const v = fields[k];
    if (typeof v === 'string' && v) parts.push(`${label}: ${v.length > 40 ? `${v.slice(0, 40)}…` : v}`);
  }
  return parts.join(', ') || 'earlier details';
}

/** Shown under an item when another person's edit replaced something this device had (#1124). */
export function ConflictNotice({
  itemId,
  title,
  onRestore,
  onDismiss,
}: {
  itemId: string;
  title: string;
  onRestore: (itemId: string) => unknown;
  onDismiss: (itemId: string) => void;
}) {
  const entry = useItemConflict(itemId);
  if (!entry) return null;
  const full = summary(entry.loserFields);
  return (
    <div role="status" className="px-gut py-2 text-t-small text-ink-mid" data-testid={`conflict-notice-${itemId}`}>
      <p>
        Changed by {entry.winnerActor || 'someone'}. Your version: <span title={full}>{full}</span>
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onRestore(itemId)} aria-label={`Put mine back: ${title}`}>
          Put mine back
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss(itemId)} aria-label={`Dismiss change notice: ${title}`}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
