import { useEffect, useRef, useState, type ChangeEvent } from 'react';

/** Local-draft input state that mirrors `committed` until focused, and fires `onCommit`
 * only on blur (so a synced write happens once per edit, not once per keystroke). Same
 * pattern as `docs-checklist.tsx`'s `DocRow` note field, generalized for reuse. */
export function useDraftOnBlur(committed: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(committed);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(committed);
  }, [committed]);

  return {
    value: draft,
    onFocus: () => {
      focusedRef.current = true;
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      focusedRef.current = false;
      if (draft !== committed) onCommit(draft);
    },
  };
}
