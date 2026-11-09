// Static-export metadata can't follow the active trip, so every tab title carries the default
// trip's name (or "Trip Journey" on /map/). On a custom trip swap that suffix for the trip's own name.
const DEFAULT_SUFFIX = /(Nepal × Japan Journey|Trip Journey)( \| Dec 2026 - Jan 2027)?$/;

// The endsWith guard keeps this idempotent: a trip named "Peru Trip Journey" would otherwise
// match the suffix again on every pass.
export function retitle(title: string, tripName: string): string {
  if (title.endsWith(tripName)) return title;
  return title.replace(DEFAULT_SUFFIX, () => tripName);
}

/** Keeps document.title on `tripName` across route changes (Next rewrites <title> per page). */
export function followTripName(tripName: string): () => void {
  const apply = () => {
    const next = retitle(document.title, tripName);
    if (next !== document.title) document.title = next;
  };
  apply();
  // Watch <head>, not the <title> node: a navigation may replace the element itself.
  const mo = new MutationObserver(apply);
  mo.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => mo.disconnect();
}
