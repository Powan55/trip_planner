// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    m: { div: (props: Record<string, unknown>) => {
      const { initial, animate, exit, transition, onExitComplete, ...rest } = props;
      return React.createElement('div', rest);
    } },
    AnimatePresence: ({ children, onExitComplete }: { children: ReactNode; onExitComplete?: () => void }) => {
      const had = useRef(false);
      useEffect(() => {
        if (had.current && !children) onExitComplete?.();
        had.current = !!children;
      }, [children, onExitComplete]);
      return children;
    },
    useReducedMotion: () => false,
  };
});

import TravelSafetyKit from '@/components/travel-safety-kit';
import { SAFETY_PHRASES } from '@/core/content/safety';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(TravelSafetyKit)));
}

const hello = SAFETY_PHRASES.find((p) => p.id === 'hello')!;

function trigger(lang: 'Nepali' | 'Japanese') {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent!.startsWith(`Show "Hello" in ${lang} full screen:`),
  )!;
}

describe('phrase card (#952)', () => {
  it('opens the tapped language large, with romanization and English', () => {
    mount();
    expect(document.querySelector('[data-testid="phrase-card"]')).toBeNull();
    act(() => trigger('Japanese').click());
    const dialog = document.querySelector('[data-testid="phrase-card"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const script = dialog.querySelector('[data-testid="phrase-card-script"]')!;
    expect(script.textContent).toBe(hello.japaneseScript);
    expect(script.getAttribute('lang')).toBe('ja');
    expect(dialog.getAttribute('aria-labelledby')).toBe(script.id);
    expect(dialog.querySelector('[data-testid="phrase-card-roman"]')!.textContent).toBe(hello.japanese);
    expect(dialog.querySelector('[data-testid="phrase-card-english"]')!.textContent).toBe('Hello');
  });

  it('shows Devanagari with lang=ne for the Nepali trigger', () => {
    mount();
    act(() => trigger('Nepali').click());
    const script = document.querySelector('[data-testid="phrase-card-script"]')!;
    expect(script.textContent).toBe(hello.nepaliScript);
    expect(script.getAttribute('lang')).toBe('ne');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    mount();
    const t = trigger('Nepali');
    t.focus();
    act(() => t.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="phrase-card"]')).toBeNull();
    expect(document.activeElement).toBe(t);
  });

  it('closes via the close button, which is a 44px target', () => {
    mount();
    act(() => trigger('Nepali').click());
    const close = document.querySelector<HTMLButtonElement>('[data-testid="phrase-card-close"]')!;
    expect(close.className).toContain('min-h-[44px]');
    expect(close.className).toContain('min-w-[44px]');
    act(() => close.click());
    expect(document.querySelector('[data-testid="phrase-card"]')).toBeNull();
  });

  it('every phrase script cell has a 44px trigger', () => {
    mount();
    const triggers = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent!.includes('full screen:'),
    );
    expect(triggers).toHaveLength(SAFETY_PHRASES.length * 2);
    triggers.forEach((b) => expect(b.className).toContain('min-h-[44px]'));
  });
});
