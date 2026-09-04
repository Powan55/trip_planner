'use client';

import { useEffect, useState } from 'react';

/**
 * The ONE writer of `body[data-dialog-open]` — the seam `components/quick-add-fab.tsx` reads to
 * hide the FAB while any dialog is open.
 *
 * Five modals set this flag independently and each used to `delete` it on unmount, so closing a
 * dialog nested inside an open sheet cleared the flag while the sheet was still up (#130). The
 * count here makes that impossible: the attribute moves only on the empty↔non-empty transitions.
 *
 * It is a STACK rather than a counter because the order is the second thing it answers. Every
 * modal layer in the app already registers here, so the stack is the only place that knows one
 * layer is open over another — and a layer that is covered has to stand down from the
 * document-level keys the topmost one owns (see the Escape handler in `ui/sheet-dark.tsx`).
 * A count could not tell "two layers" from "I am the deeper one".
 */
let nextId = 1;
let stack: number[] = [];
const subscribers = new Set<() => void>();

/**
 * Holds `body[data-dialog-open]` for as long as `open` is true and the caller is mounted.
 *
 * Returns true while ANOTHER layer is registered above this one — i.e. this caller is covered.
 * Callers that only want the flag can ignore it.
 */
export function useDialogOpenFlag(open = true): boolean {
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = nextId++;
    const sync = () => setCovered(stack[stack.length - 1] !== id);
    stack.push(id);
    subscribers.add(sync);
    document.body.dataset.dialogOpen = '1';
    subscribers.forEach((notify) => notify());
    return () => {
      subscribers.delete(sync);
      stack = stack.filter((other) => other !== id);
      setCovered(false);
      if (stack.length === 0) delete document.body.dataset.dialogOpen;
      subscribers.forEach((notify) => notify());
    };
  }, [open]);

  return covered;
}
