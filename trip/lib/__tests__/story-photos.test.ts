// @vitest-environment jsdom
//
// S161 — component-level unit suite for `StoryPhotos`/`StoryPhotoThumb` (`components/trip-story-recap.tsx`),
// exercised by RENDERING the real exported component (same createRoot+act harness `use-photos.test.ts`
// uses — no new dep, no JSX in this file since the standalone vitest.config.ts only globs `*.test.ts`).
// `defaultBlobStore` is module-mocked (jsdom has no IndexedDB) so `get(id)` is fully under test control.
//
// Proves the three required cases (S161):
//   - a day WITH photos renders `story-photos-<date>` + one `story-photo-<id>` per photo, correct `alt`;
//   - a day WITHOUT photos renders no strip at all (no empty box);
//   - an EVICTED blob (`get`->null) renders the placeholder (no `<img>`, `data-missing="true"`), never a
//     broken img or a crash.

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

// `StoryPhotos` now mounts a `PhotoLightbox` (#225), which is a `Sheet` (portal + framer-motion).
// Mirrors `import-place-sheet.test.ts` / `journal-browse-photos.test.ts`'s passthrough mock.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: any) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, onExitComplete, ...rest } = p;
    return rest;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m: { div: (props: any) => React.createElement('div', strip(props)) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children, onExitComplete }: any) => {
      const wasOpen = React.useRef(false);
      const isOpen = !(children == null || children === false);
      React.useEffect(() => {
        if (isOpen) {
          wasOpen.current = true;
        } else if (wasOpen.current) {
          wasOpen.current = false;
          onExitComplete?.();
        }
      });
      return children;
    },
  };
});

import { StoryPhotos } from '@/components/trip-story-recap';
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
    owner: { kind: 'journal', date: '2026-12-09' },
    altText: `alt-${id}`,
    w: 100,
    h: 100,
    bytes: 10,
    createdAt: '2026-12-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  h.map.clear();
});

describe('StoryPhotos — a day with NO photos renders no strip at all', () => {
  it('renders nothing (no empty box)', () => {
    const r = render(
      createElement(StoryPhotos, { date: '2026-12-09', dayNumber: 1, city: 'Kathmandu', photos: [] }),
    );
    expect(r.container.querySelector('[data-testid="story-photos-2026-12-09"]')).toBeNull();
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });
});

describe('StoryPhotos — a day WITH photos renders the strip + correct alt', () => {
  it('renders story-photos-<date> and one story-photo-<id> per photo, with the stored altText', async () => {
    h.map.set('ph-1', new Blob(['x'], { type: 'image/jpeg' }));
    h.map.set('ph-2', new Blob(['y'], { type: 'image/jpeg' }));
    const photos = [
      meta('ph-1', { altText: 'Boudhanath at dawn' }),
      meta('ph-2', { altText: 'Thamel market walk', caption: 'so busy' }),
    ];
    const r = render(
      createElement(StoryPhotos, { date: '2026-12-09', dayNumber: 1, city: 'Kathmandu', photos }),
    );
    await r.settle();

    expect(r.container.querySelector('[data-testid="story-photos-2026-12-09"]')).not.toBeNull();

    const item1 = r.container.querySelector('[data-testid="story-photo-ph-1"]');
    expect(item1).not.toBeNull();
    const img1 = item1!.querySelector('img');
    expect(img1).not.toBeNull();
    expect(img1!.getAttribute('alt')).toBe('Boudhanath at dawn');
    expect(item1!.getAttribute('data-missing')).toBe('false');

    const item2 = r.container.querySelector('[data-testid="story-photo-ph-2"]');
    expect(item2!.querySelector('img')!.getAttribute('alt')).toBe('Thamel market walk');
    expect(item2!.textContent).toContain('so busy');

    r.unmount();
  });
});

describe('StoryPhotos — an evicted blob (get -> null) renders the placeholder, never a broken img', () => {
  it('shows the placeholder with data-missing="true" and no <img>, preserving alt/caption text', async () => {
    // 'ph-missing' is NOT in h.map -> defaultBlobStore.get resolves null (evicted/absent).
    const photos = [meta('ph-missing', { altText: 'Gone photo', caption: 'lost to eviction' })];
    const r = render(
      createElement(StoryPhotos, { date: '2026-12-10', dayNumber: 2, city: 'Pokhara', photos }),
    );
    await r.settle();

    const item = r.container.querySelector('[data-testid="story-photo-ph-missing"]');
    expect(item).not.toBeNull();
    expect(item!.getAttribute('data-missing')).toBe('true');
    expect(item!.querySelector('img')).toBeNull();
    // The placeholder's title carries the caption (or altText) — words survive even without pixels.
    expect(item!.querySelector('[title]')!.getAttribute('title')).toBe('lost to eviction');

    r.unmount();
  });
});
