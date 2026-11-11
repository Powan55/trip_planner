import { useEffect, useState } from 'react';
import { CONFLICTS_CHANGED_EVENT, listConflicts, type ConflictEntry } from '@/core/sync/conflict-store';

/** The stored conflict for one item on this device, or undefined. Re-reads on every slot write. */
export function useItemConflict(itemId: string): ConflictEntry | undefined {
  const [entry, setEntry] = useState<ConflictEntry | undefined>(undefined);
  useEffect(() => {
    const read = () => setEntry(listConflicts().find((e) => e.itemId === itemId));
    read();
    window.addEventListener(CONFLICTS_CHANGED_EVENT, read);
    return () => window.removeEventListener(CONFLICTS_CHANGED_EVENT, read);
  }, [itemId]);
  return entry;
}
