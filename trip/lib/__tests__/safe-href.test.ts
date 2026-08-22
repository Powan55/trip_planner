import { describe, it, expect } from 'vitest';
import { isSafeHref, isHttpHref } from '@/lib/safe-href';

describe('safe-href predicates', () => {
  describe('isSafeHref — allows http(s)://, mailto:, site-relative /, and anchors', () => {
    it('accepts http:// URLs', () => {
      expect(isSafeHref('http://example.com')).toBe(true);
      expect(isSafeHref('http://example.com/path?query=1#anchor')).toBe(true);
    });

    it('accepts https:// URLs', () => {
      expect(isSafeHref('https://example.com')).toBe(true);
      expect(isSafeHref('https://example.com/path?query=1#anchor')).toBe(true);
    });

    it('accepts mailto: links', () => {
      expect(isSafeHref('mailto:user@example.com')).toBe(true);
      expect(isSafeHref('mailto:user@example.com?subject=hello')).toBe(true);
    });

    it('accepts site-relative paths (single leading slash)', () => {
      expect(isSafeHref('/')).toBe(true);
      expect(isSafeHref('/path')).toBe(true);
      expect(isSafeHref('/path/to/page')).toBe(true);
      expect(isSafeHref('/path?query=1')).toBe(true);
      expect(isSafeHref('/path#anchor')).toBe(true);
    });

    it('accepts anchors (hash-only)', () => {
      expect(isSafeHref('#')).toBe(true);
      expect(isSafeHref('#section')).toBe(true);
      expect(isSafeHref('#section-name')).toBe(true);
    });

    it('rejects protocol-relative URLs (issue #188)', () => {
      expect(isSafeHref('//example.com')).toBe(false);
      expect(isSafeHref('//evil.com/path')).toBe(false);
      expect(isSafeHref('//cdn.example.com/resource')).toBe(false);
    });

    it('rejects backslash-variant protocol-relative URLs (issue #188 bypass)', () => {
      // Browsers treat \ as / in the authority position for special schemes,
      // so /\evil.com resolves to https://evil.com/ same as //evil.com.
      expect(isSafeHref('/\\evil.com')).toBe(false);
      expect(isSafeHref('/\\\\evil.com')).toBe(false);
      expect(isSafeHref('/\\/evil.com')).toBe(false);
      expect(isSafeHref('//evil.com')).toBe(false);
    });

    it('rejects control-char protocol-relative bypasses (issue #188, 2nd finding)', () => {
      // WHATWG URL parsing strips all ASCII tab/newline/CR wherever they sit,
      // before anything else — so these resolve identically to //evil.com.
      expect(isSafeHref('/\t/evil.com')).toBe(false);
      expect(isSafeHref('/\t\\evil.com')).toBe(false);
      expect(isSafeHref('/\n/evil.com')).toBe(false);
      expect(isSafeHref('/\r/evil.com')).toBe(false);
    });

    it('rejects javascript: URLs', () => {
      expect(isSafeHref('javascript:alert("XSS")')).toBe(false);
      expect(isSafeHref('JavaScript:alert(1)')).toBe(false);
    });

    it('rejects data: URLs', () => {
      expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isSafeHref('data:image/png;base64,...')).toBe(false);
    });

    it('is case-insensitive for schemes', () => {
      expect(isSafeHref('HTTP://example.com')).toBe(true);
      expect(isSafeHref('HTTPS://example.com')).toBe(true);
      expect(isSafeHref('Mailto:user@example.com')).toBe(true);
    });
  });

  describe('isHttpHref — accepts http(s):// only', () => {
    it('accepts http:// URLs', () => {
      expect(isHttpHref('http://example.com')).toBe(true);
      expect(isHttpHref('http://example.com/path?query=1#anchor')).toBe(true);
    });

    it('accepts https:// URLs', () => {
      expect(isHttpHref('https://example.com')).toBe(true);
      expect(isHttpHref('https://example.com/path?query=1#anchor')).toBe(true);
    });

    it('rejects mailto: links', () => {
      expect(isHttpHref('mailto:user@example.com')).toBe(false);
    });

    it('rejects site-relative paths', () => {
      expect(isHttpHref('/')).toBe(false);
      expect(isHttpHref('/path')).toBe(false);
      expect(isHttpHref('/path/to/page')).toBe(false);
    });

    it('rejects anchors', () => {
      expect(isHttpHref('#')).toBe(false);
      expect(isHttpHref('#section')).toBe(false);
    });

    it('rejects protocol-relative URLs', () => {
      expect(isHttpHref('//example.com')).toBe(false);
      expect(isHttpHref('//evil.com/path')).toBe(false);
    });

    it('is case-insensitive for schemes', () => {
      expect(isHttpHref('HTTP://example.com')).toBe(true);
      expect(isHttpHref('HTTPS://example.com')).toBe(true);
    });
  });

  describe('subset relation — isHttpHref ⊆ isSafeHref', () => {
    it('everything isHttpHref accepts, isSafeHref accepts', () => {
      const httpUrls = [
        'http://example.com',
        'https://example.com',
        'https://example.com/path?query=1#anchor',
      ];
      for (const url of httpUrls) {
        expect(isHttpHref(url)).toBe(true);
        expect(isSafeHref(url)).toBe(true);
      }
    });

    it('isSafeHref accepts things isHttpHref rejects', () => {
      const safeOnly = [
        'mailto:user@example.com',
        '/',
        '/path',
        '#anchor',
      ];
      for (const url of safeOnly) {
        expect(isHttpHref(url)).toBe(false);
        expect(isSafeHref(url)).toBe(true);
      }
    });

    it('both reject dangerous URLs', () => {
      const dangerous = [
        '//evil.com',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
      ];
      for (const url of dangerous) {
        expect(isHttpHref(url)).toBe(false);
        expect(isSafeHref(url)).toBe(false);
      }
    });
  });
});
