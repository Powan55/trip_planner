/**
 * Href safety predicates. These gate markdown-rendered and synced links to prevent
 * open redirects via protocol-relative URLs. Two predicates, one file.
 *
 * `isSafeHref` allows http(s)://, mailto:, site-relative /, and anchors (#).
 * `isHttpHref` is a subset: http(s):// only, for share-target rows.
 *
 * The subset relation is critical: `isSafeHref`'s `/` alternative was matching
 * `//evil.com` until issue #188 fixed it with a negative lookahead, then
 * matching `/\t/evil.com` until a second #188 pass added the control-char
 * strip below. The tests pin that both predicates are correct and in
 * correct relation.
 *
 * Both predicates strip ASCII tab/newline/CR before matching, because
 * WHATWG URL parsing strips those characters wherever they appear in the
 * input as its first step — so `/\t/evil.com` reaches the browser as
 * `//evil.com` even though the raw string doesn't look like one.
 */

/**
 * Accepts http(s)://, mailto:, site-relative /, and anchors.
 * Rejects protocol-relative URLs (//host/path), including the backslash
 * variant (/\host/path) — URL parsers treat \ as / in the authority
 * position, so both slashes must be excluded from the site-relative branch.
 * Normalizes (strips) ASCII tab/newline/CR before matching, since those
 * are stripped by URL parsing before the browser ever sees them.
 * Used by concierge-chat.tsx to gate markdown links from the Worker.
 */
export const isSafeHref = (url: string): boolean => {
  const stripped = url.replace(/[\t\n\r]/g, '');
  return /^(https?:\/\/|mailto:|\/(?![/\\])|#)/i.test(stripped);
};

/**
 * Accepts http(s):// URLs only.
 * Stricter than isSafeHref. Normalizes (strips) ASCII tab/newline/CR before
 * matching, for consistency with isSafeHref.
 * Used by share-inbox.tsx to gate the share-target row.
 */
export const isHttpHref = (url: string): boolean => {
  const stripped = url.replace(/[\t\n\r]/g, '');
  return /^https?:\/\//i.test(stripped);
};
