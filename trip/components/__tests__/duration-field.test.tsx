import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DurationField } from '@/components/time-picker';
import { MAX_DURATION_MINUTES } from '@/lib/time-picker-format';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DurationField', () => {
  it('keeps raw edits until blur, restores invalid text, and commits rounded/clamped minutes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const changed = vi.fn();
    function Harness() {
      const [value, setValue] = useState<number | undefined>(90);
      return <DurationField value={value} onChange={(next) => { changed(next); setValue(next); }} />;
    }
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    try {
      await act(async () => root.render(<Harness />));
      const input = container.querySelector('input')!;
      const edit = async (raw: string) => {
        await act(async () => {
          input.focus();
          setValue.call(input, raw);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe(raw);
      };
      await edit('90m');
      expect(changed).not.toHaveBeenCalled();
      await act(async () => input.blur());
      expect(input.value).toBe('90');
      expect(changed).not.toHaveBeenCalled();
      for (const [raw, expected] of [['1.5', 2], ['0', 1], ['20161', MAX_DURATION_MINUTES], ['120', 120]] as const) {
        changed.mockClear();
        await edit(raw);
        expect(changed).not.toHaveBeenCalled();
        await act(async () => input.blur());
        expect(changed).toHaveBeenLastCalledWith(expected);
        expect(input.value).toBe(String(expected));
      }
      await edit('45');
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(changed).toHaveBeenLastCalledWith(45);
      expect(document.activeElement).not.toBe(input);
      await edit('');
      await act(async () => input.blur());
      expect(changed).toHaveBeenLastCalledWith(undefined);
      expect(input.value).toBe('');
      await act(async () => root.render(<DurationField value={30} onChange={changed} />));
      expect(container.querySelector('input')!.value).toBe('30');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
