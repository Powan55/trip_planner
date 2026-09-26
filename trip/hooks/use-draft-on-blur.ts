import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { isTabRetiring } from '@/hooks/use-cross-tab-reload';

/** Local-draft input state that mirrors `committed` until the user types, and fires
 * `onCommit` only on blur (so a synced write happens once per edit, not once per keystroke).
 * Focus alone never commits: an untouched field keeps following remote updates, otherwise a
 * blur would write the stale value back over a peer's edit. A dirty draft is also flushed on
 * pagehide, hide and unmount so a backgrounded or closed tab doesn't lose it. */
export function useDraftOnBlur(committed: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(committed);
  const dirtyRef = useRef(false);
  const latest = useRef({ draft, committed, onCommit });
  latest.current = { draft, committed, onCommit };

  const flush = () => {
    if (!dirtyRef.current || isTabRetiring()) return;
    dirtyRef.current = false;
    const { draft: d, committed: c, onCommit: commit } = latest.current;
    if (d !== c) commit(d);
  };

  useEffect(() => {
    if (!dirtyRef.current) setDraft(committed);
  }, [committed]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  return {
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      dirtyRef.current = true;
      setDraft(e.target.value);
      latest.current.draft = e.target.value;
    },
    onBlur: () => {
      if (dirtyRef.current) flush();
      else setDraft(latest.current.committed);
    },
  };
}
