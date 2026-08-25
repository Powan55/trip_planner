// @vitest-environment jsdom
//
// Issue #228 — `BookingOverrideEditor` (the `/flights` inline "I booked this" affordance) mounted
// for real (createRoot + act, the `travel-expense-quickadd.test.tsx` harness) and driven through
// its own open -> fill -> save -> edit -> remove flow, asserted on the DOM and on the callbacks
// `flights-section.tsx` wires to `useBookingOverrides`.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BookingOverrideEditor } from '@/components/booking-override-editor';
import type { BookingOverride } from '@/core/bookings/override';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(props: {
  id: string;
  kind: 'flight' | 'stay';
  isToBook: boolean;
  override?: BookingOverride;
  onSave: (id: string, patch: Omit<BookingOverride, 'updatedAt'>) => void;
  onClear: (id: string) => void;
}): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BookingOverrideEditor {...props} />);
  });
  return container;
}

const at = <T extends HTMLElement>(id: string): T | null => container.querySelector<T>(`[data-testid="${id}"]`);

function setValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BookingOverrideEditor — already-booked entries', () => {
  it('renders nothing when isToBook is false, whatever the override', async () => {
    await mount({ id: 'outbound', kind: 'flight', isToBook: false, onSave: vi.fn(), onClear: vi.fn() });
    expect(container.textContent).toBe('');
  });
});

describe('BookingOverrideEditor — an unbooked entry, no override yet', () => {
  it('shows the open affordance, and the form fields on click', async () => {
    const onSave = vi.fn();
    await mount({ id: 'tokyo-to-osaka', kind: 'flight', isToBook: true, onSave, onClear: vi.fn() });

    expect(at('booking-override-flight-tokyo-to-osaka-open')).not.toBeNull();
    expect(at('booking-override-flight-tokyo-to-osaka-form')).toBeNull();

    await act(async () => {
      at<HTMLButtonElement>('booking-override-flight-tokyo-to-osaka-open')!.click();
    });
    expect(at('booking-override-flight-tokyo-to-osaka-form')).not.toBeNull();
  });

  it('filling the form and saving calls onSave with a trimmed patch, then closes the form', async () => {
    const onSave = vi.fn();
    await mount({ id: 'tokyo-to-osaka', kind: 'flight', isToBook: true, onSave, onClear: vi.fn() });

    await act(async () => {
      at<HTMLButtonElement>('booking-override-flight-tokyo-to-osaka-open')!.click();
    });
    await act(async () => setValue(at<HTMLInputElement>('booking-override-flight-tokyo-to-osaka-provider')!, '  Nova Air 812  '));
    await act(async () =>
      setValue(at<HTMLInputElement>('booking-override-flight-tokyo-to-osaka-confirmation')!, 'ABC123'),
    );
    await act(async () => {
      at<HTMLFormElement>('booking-override-flight-tokyo-to-osaka-form')!.requestSubmit();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('tokyo-to-osaka', {
      provider: 'Nova Air 812',
      confirmationNumber: 'ABC123',
    });
    // The form closes back to the (still override-less, from this component's own state POV) open button.
    expect(at('booking-override-flight-tokyo-to-osaka-form')).toBeNull();
  });

  it('an all-blank submit calls onSave with an empty patch (no fabricated fields)', async () => {
    const onSave = vi.fn();
    await mount({ id: 'x', kind: 'stay', isToBook: true, onSave, onClear: vi.fn() });
    await act(async () => {
      at<HTMLButtonElement>('booking-override-stay-x-open')!.click();
    });
    await act(async () => {
      at<HTMLFormElement>('booking-override-stay-x-form')!.requestSubmit();
    });
    expect(onSave).toHaveBeenCalledWith('x', {});
  });
});

describe('BookingOverrideEditor — an existing override', () => {
  const override: BookingOverride = {
    provider: 'Nova Air 812',
    confirmationNumber: 'ABC123',
    primaryLabel: '9:00am',
    secondaryLabel: '10:15am',
    note: 'booked on the road',
    updatedAt: '2026-12-01T00:00:00.000Z',
  };

  it('shows a read-only summary with the override fields, not the open button', async () => {
    await mount({ id: 'tokyo-to-osaka', kind: 'flight', isToBook: true, override, onSave: vi.fn(), onClear: vi.fn() });
    expect(at('booking-override-flight-tokyo-to-osaka-open')).toBeNull();
    const summary = at('booking-override-flight-tokyo-to-osaka-summary')!;
    expect(summary.textContent).toContain('Nova Air 812');
    expect(summary.textContent).toContain('ABC123');
    expect(summary.textContent).toContain('booked on the road');
  });

  it('Edit reopens the form pre-filled with the existing override', async () => {
    await mount({ id: 'tokyo-to-osaka', kind: 'flight', isToBook: true, override, onSave: vi.fn(), onClear: vi.fn() });
    await act(async () => {
      at<HTMLButtonElement>('booking-override-flight-tokyo-to-osaka-edit')!.click();
    });
    expect(at<HTMLInputElement>('booking-override-flight-tokyo-to-osaka-provider')!.value).toBe('Nova Air 812');
    expect(at<HTMLInputElement>('booking-override-flight-tokyo-to-osaka-confirmation')!.value).toBe('ABC123');
  });

  it('Remove calls onClear with the id', async () => {
    const onClear = vi.fn();
    await mount({ id: 'tokyo-to-osaka', kind: 'flight', isToBook: true, override, onSave: vi.fn(), onClear });
    await act(async () => {
      at<HTMLButtonElement>('booking-override-flight-tokyo-to-osaka-clear')!.click();
    });
    expect(onClear).toHaveBeenCalledWith('tokyo-to-osaka');
  });
});
