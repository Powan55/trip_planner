// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S220 — share-inbox persistence round-trip through the typed storage gateway (key 23, D-097) +
 * the `core/share/storage.ts` load/save adapter. Proves: empty inbox on first load, set→get,
 * corrupt slot → [] (never throws), sanitize-on-write drops malformed/caps, the on-disk key string
 * is pinned + additive (key tail 23 = next free after 22 `dayAnchors`), and SSR/quota safety
 * inherited from the gateway. Mirrors packing-storage.test.ts.
 */

import { STORAGE_KEYS, shareInboxStore } from '@/core/storage/gateway';
import { loadShareInbox, saveShareInbox } from '@/core/share/storage';
import { SHARE_CAP, type ShareItem } from '@/core/share/model';

const KEY = 'nepal_japan_share_inbox';

describe('share-inbox storage (gateway key 23, D-097)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the on-disk key string is exactly nepal_japan_share_inbox (additive, no dup literals)', () => {
    expect(STORAGE_KEYS.shareInbox).toBe(KEY);
    const values = Object.values(STORAGE_KEYS) as string[];
    expect(new Set(values).size).toBe(values.length); // no duplicate literals across the registry
    // key 23 is the next free tail after key 22 (`dayAnchors`) — both present, distinct.
    expect(STORAGE_KEYS.dayAnchors).toBe('nepal_japan_day_anchors');
    expect(STORAGE_KEYS.shareInbox).not.toBe(STORAGE_KEYS.dayAnchors);
  });

  it('loadShareInbox returns the empty inbox when the key is absent (fresh visitor)', () => {
    expect(loadShareInbox()).toEqual([]);
  });

  it('saveShareInbox → loadShareInbox round-trips, stored as JSON under the key', () => {
    const items: ShareItem[] = [
      { id: 'a', title: 'Hi', url: 'https://a.co', receivedAt: '2026-07-18T00:00:00Z' },
    ];
    saveShareInbox(items);
    expect(loadShareInbox()).toEqual(items);
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(items);
  });

  it('saveShareInbox SANITIZES on write — a malformed item never reaches disk', () => {
    saveShareInbox([
      { id: 'a', text: 'ok', receivedAt: 't' },
      { id: '', text: 'bad', receivedAt: 't' } as unknown as ShareItem,
      { id: 'c', receivedAt: 't' } as unknown as ShareItem, // no content
    ]);
    expect(loadShareInbox().map((i) => i.id)).toEqual(['a']);
  });

  it('saveShareInbox caps an oversized list to SHARE_CAP (drop-oldest)', () => {
    const many: ShareItem[] = Array.from({ length: SHARE_CAP + 10 }, (_, i) => ({
      id: `id-${i}`,
      text: `t${i}`,
      receivedAt: 't',
    }));
    saveShareInbox(many);
    expect(loadShareInbox()).toHaveLength(SHARE_CAP);
  });

  it('a corrupt (non-JSON) slot → [] , never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadShareInbox()).not.toThrow();
    expect(loadShareInbox()).toEqual([]);
  });

  it('a slot holding non-array JSON → [] (sanitized)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadShareInbox()).toEqual([]);
  });

  it('shareInboxStore is byte-transport only: get(fallback) returns fallback on absent/corrupt', () => {
    expect(shareInboxStore.get<string>('FB')).toBe('FB');
    window.localStorage.setItem(KEY, '{broken');
    expect(shareInboxStore.get<string>('FB')).toBe('FB');
    shareInboxStore.set([{ a: 1 }]);
    expect(shareInboxStore.get<Array<{ a: number }>>([])).toEqual([{ a: 1 }]);
  });

  it('SSR-safe: with no window, load returns [] and save is inert (never throws)', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => {
        expect(loadShareInbox()).toEqual([]);
        saveShareInbox([{ id: 'a', text: 'x', receivedAt: 't' }]); // no-op
      }).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  it('never throws when setItem throws (quota / disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveShareInbox([{ id: 'a', text: 'x', receivedAt: 't' }])).not.toThrow();
  });
});
