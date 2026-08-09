// @vitest-environment jsdom
//
// S208 — component-level unit suite for `JournalPhotoStrip` (`components/journal-browse.tsx`),
// the same read-only photo-ride-along treatment `trip-story-recap.tsx`'s `StoryPhotos` got in
// S161 (`lib/__tests__/story-photos.test.ts`), ported to the `/journal` browse view's per-row
// renderer. `defaultBlobStore` is module-mocked (jsdom has no IndexedDB) exactly as the S161
// suite does, so `get(id)` is fully under test control.
//
// Proves the three required cases (S208):
//   - a day WITH photos renders `journal-browse-photos-<date>` + one `journal-browse-photo-<id>`
//     per photo, correct `alt`, no interactive delete/add control (read-only);
//   - a day WITHOUT photos renders no strip at all (no empty box, no broken layout);
//   - an EVICTED blob (`get`->null) renders the placeholder (no `<img>`, `data-missing="true"`),
//     never a broken img or a crash.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const h = vi.hoisted(() => ({ map: new Map<string, Blob>() }));

vi.mock('@/core/photos/blob-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/photos/blob-store')>();
  return {
    ...orig,
    defaultBlobStore: {
      ...orig.defaultBlobStore,
      async get(id: string) {
        return h.map.get(id) ?? null;
      },
    },
  };
});

import { JournalPhotoStrip } from '@/components/journal-browse';
import type { PhotoMeta } from '@/core/photos/model';

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    async settle() {
      // Flush the two microtask hops (`get()`'s own promise + its `.then` callback) via a macrotask.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function meta(id: string, overrides: Partial<PhotoMeta> = {}): PhotoMeta {
  return {
    id,
    owner: { kind: 'journal', date: '2026-12-10' },
    altText: `alt-${id}`,
    w: 100,
    h: 100,
    bytes: 10,
    createdAt: '2026-12-10T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  h.map.clear();
});

describe('JournalPhotoStrip — a day with NO photos renders no strip at all', () => {
  it('renders nothing (no empty box, no broken layout)', () => {
    const r = render(createElement(JournalPhotoStrip, { date: '2026-12-10', photos: [] }));
    expect(r.container.querySelector('[data-testid="journal-browse-photos-2026-12-10"]')).toBeNull();
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });
});

describe('JournalPhotoStrip — a day WITH photos renders the strip + correct alt, read-only', () => {
  it('renders journal-browse-photos-<date> and one journal-browse-photo-<id> per photo, with the stored altText and no interactive control', async () => {
    h.map.set('ph-1', new Blob(['x'], { type: 'image/jpeg' }));
    h.map.set('ph-2', new Blob(['y'], { type: 'image/jpeg' }));
    const photos = [
      meta('ph-1', { altText: 'Boudhanath at dawn' }),
      meta('ph-2', { altText: 'Thamel market walk', caption: 'so busy' }),
    ];
    const r = render(createElement(JournalPhotoStrip, { date: '2026-12-10', photos }));
    await r.settle();

    expect(r.container.querySelector('[data-testid="journal-browse-photos-2026-12-10"]')).not.toBeNull();

    const item1 = r.container.querySelector('[data-testid="journal-browse-photo-ph-1"]');
    expect(item1).not.toBeNull();
    const img1 = item1!.querySelector('img');
    expect(img1).not.toBeNull();
    expect(img1!.getAttribute('alt')).toBe('Boudhanath at dawn');
    expect(item1!.getAttribute('data-missing')).toBe('false');

    const item2 = r.container.querySelector('[data-testid="journal-browse-photo-ph-2"]');
    expect(item2!.querySelector('img')!.getAttribute('alt')).toBe('Thamel market walk');
    expect(item2!.textContent).toContain('so busy');

    // Read-only surface: no delete/add control inside the strip (that lives only on the in-trip
    // Today panel's PhotoAttach capture UI, untouched by this slice).
    expect(r.container.querySelectorAll('[data-testid^="journal-browse-photos-"] button')).toHaveLength(0);

    r.unmount();
  });
});

describe('JournalPhotoStrip — an evicted blob (get -> null) renders the placeholder, never a broken img', () => {
  it('shows the placeholder with data-missing="true" and no <img>, preserving alt/caption text', async () => {
    // 'ph-missing' is NOT in h.map -> defaultBlobStore.get resolves null (evicted/absent).
    const photos = [meta('ph-missing', { altText: 'Gone photo', caption: 'lost to eviction' })];
    const r = render(createElement(JournalPhotoStrip, { date: '2026-12-10', photos }));
    await r.settle();

    const item = r.container.querySelector('[data-testid="journal-browse-photo-ph-missing"]');
    expect(item).not.toBeNull();
    expect(item!.getAttribute('data-missing')).toBe('true');
    expect(item!.querySelector('img')).toBeNull();
    // The placeholder's title carries the caption (or altText) — words survive even without pixels.
    expect(item!.querySelector('[title]')!.getAttribute('title')).toBe('lost to eviction');

    r.unmount();
  });
});
