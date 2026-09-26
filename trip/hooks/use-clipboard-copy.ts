'use client';

import { useState } from 'react';

/**
 * Shared clipboard-copy-with-fallback: `navigator.clipboard.writeText` rejects outright on an
 * insecure origin or a denied permission, and a swallowed failure reads as a successful copy of
 * whatever secret was on screen. Mirrors the fallback wording in
 * `components/user-token-show-once.tsx` — the value stays visible/selectable, this just says so.
 */
export function useClipboardCopy() {
  const [error, setError] = useState<string | null>(null);

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      return true;
    } catch {
      setError('This browser blocked the clipboard. Select the value above and copy it by hand.');
      return false;
    }
  };

  return { copy, error, clearError: () => setError(null) };
}
