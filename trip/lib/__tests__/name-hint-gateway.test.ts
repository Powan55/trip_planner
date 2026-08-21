// @vitest-environment jsdom
//
// `core/storage/gateway.ts` claims to be the ONE module fronting every ad-hoc persisted
// web-storage key, and a grep for `sessionStorage.` / `localStorage.` outside it (plus the Vault
// and tests) returning zero app hits is what makes that structural rather than a convention.
// `name-hint` was the exception: `token-gate.tsx` set it and `itinerary-provider.tsx` read/cleared
// it through raw `sessionStorage` (#165).
//
// Two things are pinned here. The on-disk key string — `name-hint` is LIVE on every browser that
// has logged in through the token-only door, so the slot must carry the same bytes in the same
// store the raw calls used, not a tidier spelling. And the bypass itself: the source scan fails if
// either component reaches for web storage directly again.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORAGE_KEYS, nameHintFlag } from '@/core/storage/gateway';

const COMPONENTS = resolve(__dirname, '../../components');
const read = (p: string) => readFileSync(resolve(COMPONENTS, p), 'utf8');

describe('name-hint slot (key 39, #165)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('the on-disk key string is exactly name-hint (live bytes, no migration)', () => {
    expect(STORAGE_KEYS.nameHint).toBe('name-hint');
  });

  it('mark() writes the "1" presence flag to sessionStorage under that exact key', () => {
    nameHintFlag.mark();
    expect(window.sessionStorage.getItem('name-hint')).toBe('1');
    expect(window.localStorage.getItem('name-hint')).toBeNull(); // SESSION store, not local
  });

  it('consume() round-trips through sessionStorage and is one-shot', () => {
    expect(nameHintFlag.consume()).toBe(false); // fresh browser: nothing to consume
    nameHintFlag.mark();
    expect(nameHintFlag.consume()).toBe(true);
    expect(window.sessionStorage.getItem('name-hint')).toBeNull(); // cleared BEFORE the caller toasts
    expect(nameHintFlag.consume()).toBe(false); // a reload cannot re-fire it
  });

  it('consume() reads strictly === "1" — any other stored value is not a hint', () => {
    window.sessionStorage.setItem('name-hint', 'yes');
    expect(nameHintFlag.consume()).toBe(false);
    expect(window.sessionStorage.getItem('name-hint')).toBe('yes'); // and is left alone
  });

  it('SSR-safe: with no window, consume() is false and mark() is inert, never throws', () => {
    window.sessionStorage.setItem('name-hint', '1'); // seeded: `false` can then only come from the SSR path
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => {
        expect(nameHintFlag.consume()).toBe(false);
        nameHintFlag.mark(); // no-op
      }).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
    expect(window.sessionStorage.getItem('name-hint')).toBe('1'); // left untouched
  });

  it('neither consumer touches raw web storage — the gateway is the only door', () => {
    for (const file of ['token-gate.tsx', 'itinerary-provider.tsx']) {
      const src = read(file).replace(/^\s*(\/\/.*|\*.*)$/gm, ''); // comments may name the key
      expect(src, `${file} bypasses the gateway`).not.toMatch(/(session|local)Storage\s*\./);
      expect(src, `${file} inlines the key literal`).not.toContain("'name-hint'");
    }
  });
});
