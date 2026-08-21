'use client';

import { useEffect } from 'react';

/**
 * The ONE writer of `body[data-dialog-open]` — the seam `components/quick-add-fab.tsx` reads to
 * hide the FAB while any dialog is open.
 *
 * Five modals set this flag independently and each used to `delete` it on unmount, so closing a
 * dialog nested inside an open sheet cleared the flag while the sheet was still up (#130). The
 * count here makes that impossible: the attribute moves only on the 0↔1 transitions.
 */
let openCount = 0;

/** Holds `body[data-dialog-open]` for as long as `open` is true and the caller is mounted. */
export function useDialogOpenFlag(open = true): void {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    document.body.dataset.dialogOpen = '1';
    return () => {
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        delete document.body.dataset.dialogOpen;
      }
    };
  }, [open]);
}
