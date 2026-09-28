import { describe, expect, it } from 'vitest';
import { sharePlaceUrl } from '@/core/share/place-url';

describe('sharePlaceUrl', () => {
  it('extracts a Maps URL from an Android-style text-only share', () => {
    expect(sharePlaceUrl({ text: 'Coffee Spot\nhttps://maps.app.goo.gl/abc123\nShared from Google Maps' }))
      .toBe('https://maps.app.goo.gl/abc123');
  });

  it('finds the first allowed HTTPS URL, even after an unrelated link', () => {
    expect(sharePlaceUrl({ text: 'https://example.com/a then https://share.google/first and https://goo.gl/maps/second' }))
      .toBe('https://share.google/first');
  });

  it('removes prose punctuation without removing commas within a Maps URL', () => {
    const url = 'https://www.google.com/maps/place/Cafe/@27.7,85.3,17z';
    expect(sharePlaceUrl({ text: `See (${url}), please.` })).toBe(url);
    expect(sharePlaceUrl({ text: `See "${url}."` })).toBe(url);
  });

  it('rejects non-Google, non-HTTPS, and lookalike hosts in text', () => {
    expect(sharePlaceUrl({ text: 'https://example.com/maps' })).toBeUndefined();
    expect(sharePlaceUrl({ text: 'http://maps.app.goo.gl/abc' })).toBeUndefined();
    expect(sharePlaceUrl({ text: 'https://maps.app.goo.gl.evil.test/abc' })).toBeUndefined();
    expect(sharePlaceUrl({ text: 'No link here' })).toBeUndefined();
  });

  it('keeps an explicit URL authoritative even when text contains a Maps link', () => {
    expect(sharePlaceUrl({ url: 'https://example.com/other', text: 'https://maps.app.goo.gl/abc' }))
      .toBe('https://example.com/other');
    expect(sharePlaceUrl({ url: 'https://goo.gl/maps/explicit', text: 'https://share.google/text' }))
      .toBe('https://goo.gl/maps/explicit');
  });
});
