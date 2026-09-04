import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { scrollToSectionWhenReady } from '../scroll-to-hash';

// A hand-driven rAF queue. The module's whole job is a bounded poll plus a double rAF, so
// the test has to be able to step frames rather than wait for them.
let pending = new Map<number, FrameRequestCallback>();
let handle = 0;

function frames(n: number): void {
  for (let i = 0; i < n; i++) {
    const due = [...pending.values()];
    pending = new Map();
    for (const cb of due) cb(0);
  }
}

function setReducedMotion(matches: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
}

function mountTarget(id: string): ReturnType<typeof vi.fn> {
  const el = document.createElement('section');
  el.id = id;
  const scrollIntoView = vi.fn();
  el.scrollIntoView = scrollIntoView;
  document.body.appendChild(el);
  return scrollIntoView;
}

beforeEach(() => {
  pending = new Map();
  handle = 0;
  document.body.innerHTML = '';
  // jsdom ships no matchMedia, so "motion not reduced" is the default and needs no stub.
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending.set(++handle, cb);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    pending.delete(h);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scrollToSectionWhenReady', () => {
  it('waits two frames after the target mounts, then scrolls smoothly', () => {
    const scrollIntoView = mountTarget('photography');

    scrollToSectionWhenReady('photography');
    expect(scrollIntoView).not.toHaveBeenCalled();

    frames(1);
    expect(scrollIntoView).not.toHaveBeenCalled();

    frames(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('jumps instantly under prefers-reduced-motion', () => {
    setReducedMotion(true);
    const scrollIntoView = mountTarget('photography');

    scrollToSectionWhenReady('photography');
    frames(2);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('keeps polling until a late-mounting island appears', () => {
    scrollToSectionWhenReady('photography');
    frames(5);

    const scrollIntoView = mountTarget('photography');
    frames(1); // finds it
    frames(2); // double rAF

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than looping forever on an id that never appears', () => {
    scrollToSectionWhenReady('never-mounted');
    frames(400);

    expect(pending.size).toBe(0);
  });

  it('does not scroll when cancelled before the deferred frames land', () => {
    const scrollIntoView = mountTarget('photography');

    const cancel = scrollToSectionWhenReady('photography');
    frames(1);
    cancel();
    frames(2);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
