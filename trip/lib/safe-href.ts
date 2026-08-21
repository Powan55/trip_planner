// The href scheme allow-list, in ONE place, for every surface that renders an externally-supplied
// URL as a real anchor.
//
// It used to be a local constant inside `components/concierge-chat.tsx`'s markdown renderer, so the
// OTHER untrusted-URL source never got it: a place link reaches `<a href>` either from the Worker's
// `/resolve` (`lib/place-resolve.ts`) or from a peer's device, because places are a SYNCED domain.
// The export is static GitHub Pages with no CSP, so a `javascript:` href runs on the app origin with
// the Firebase session and every trip key in localStorage in reach.
//
// The list is UNCHANGED from the one concierge-chat.tsx shipped. Widening it is a security change:
// an allow-list is what keeps `javascript:`/`data:` out along with every scheme nobody has thought
// of yet, and a deny-list would not.
export const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

/** True iff `url` is a string that is safe to put in an `href`. TOTAL — anything else is `false`. */
export function isSafeHref(url: unknown): url is string {
  return typeof url === 'string' && SAFE_HREF.test(url);
}

const HTTP_HREF = /^https?:\/\//i;

// The narrower rule, for a link that arrived as a share target (`components/share-inbox.tsx`).
// Deliberately a strict subset of SAFE_HREF: a `mailto:`, site-relative or fragment-only href is
// not a link anyone shared, so accepting one only buys a way to dress an in-app address or a mail
// client up as the external page the row claims to be. Swapping this call site to `isSafeHref`
// would be that widening.
/** True iff `url` is a string carrying an `http(s):` scheme. TOTAL — anything else is `false`. */
export function isHttpHref(url: unknown): url is string {
  return typeof url === 'string' && HTTP_HREF.test(url);
}
