// @vitest-environment jsdom
//
// V6-2 — unit coverage for `hooks/use-draft-on-blur.ts` (the shared commit-on-blur draft
// state money inputs now use). Rendered for real (react-dom/client + act shim, same pattern
// as `use-budget.test.ts`/`use-presence.test.ts`). Proves: several simulated keystrokes
// (`onChange`) followed by one `onBlur` fires `onCommit` exactly once with the final value; a
// blur with no prior change (or one that lands back on `committed`) fires zero times; an
// external `committed` change while NOT focused updates the draft (mirrors
// `docs-checklist.tsx`'s note-field sync behavior).
//
// NOTE: this test lives under lib/__tests__ (not hooks/__tests__) on purpose — vitest.config.ts's
// `include` only scans `{lib,components}/__tests__/**`, and every existing hook test already
// follows that convention despite the hook itself living in hooks/.

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useDraftOnBlur } from '@/hooks/use-draft-on-blur';

interface Handle {
  value: () => string;
  type: (v: string) => void;
  focus: () => void;
  blur: () => void;
  setCommitted: (v: string) => void;
  unmount: () => void;
}

function render(initial: string, onCommit: (v: string) => void): Handle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let committed = initial;
  const ref: { current: ReturnType<typeof useDraftOnBlur> | null } = { current: null };

  function Probe() {
    ref.current = useDraftOnBlur(committed, onCommit);
    return null;
  }

  const rerender = () => act(() => root.render(createElement(Probe)));
  rerender();

  return {
    value: () => ref.current!.value,
    type: (v: string) => {
      act(() => {
        ref.current!.onChange({ target: { value: v } } as unknown as ChangeEvent<HTMLInputElement>);
      });
    },
    focus: () => act(() => ref.current!.onFocus()),
    blur: () => act(() => ref.current!.onBlur()),
    setCommitted: (v: string) => {
      committed = v;
      rerender();
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useDraftOnBlur (V6-2)', () => {
  it('several keystrokes + one blur commits exactly once, with the final value', () => {
    const onCommit = vi.fn();
    const h = render('', onCommit);
    h.focus();
    h.type('1');
    h.type('12');
    h.type('123');
    expect(h.value()).toBe('123'); // draft tracks every keystroke
    h.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('123');
    h.unmount();
  });

  it('blur with no prior change never commits', () => {
    const onCommit = vi.fn();
    const h = render('100', onCommit);
    h.focus();
    h.blur();
    expect(onCommit).not.toHaveBeenCalled();
    h.unmount();
  });

  it('blur after a change that round-trips back to committed never commits', () => {
    const onCommit = vi.fn();
    const h = render('100', onCommit);
    h.focus();
    h.type('150');
    h.type('100'); // back to the original value
    h.blur();
    expect(onCommit).not.toHaveBeenCalled();
    h.unmount();
  });

  it('an external committed change while NOT focused updates the draft', () => {
    const onCommit = vi.fn();
    const h = render('100', onCommit);
    expect(h.value()).toBe('100');
    h.setCommitted('200'); // e.g. a synced write from another device
    expect(h.value()).toBe('200');
    h.unmount();
  });

  it('an external committed change while focused does NOT clobber the in-progress draft', () => {
    const onCommit = vi.fn();
    const h = render('100', onCommit);
    h.focus();
    h.type('150');
    h.setCommitted('200'); // a sync write lands mid-edit
    expect(h.value()).toBe('150'); // local edit wins until blur
    h.unmount();
  });
});
