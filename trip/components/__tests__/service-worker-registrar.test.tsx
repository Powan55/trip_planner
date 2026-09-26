// @vitest-environment jsdom
//
// #265 (corrected scope) — `components/service-worker-registrar.tsx` has three pieces of
// client-side decision logic with zero test coverage: `hadController` (gates the reload path so
// a first-ever install doesn't spuriously reload), the update-prompt wiring (`registration.waiting`
// at register time + the `updatefound`/`installed` path, both gated on a live controller), and the
// `refreshing` dedupe guard (a double `controllerchange` must only reload once). The
// waiting->toast->Refresh->SKIP_WAITING->reload transition itself is legitimately e2e-only
// (documented `test.skip` in `e2e/pwa.spec.ts` — no second byte-different build in the static
// harness); this file covers the branch logic around it instead, with a fully faked
// `navigator.serviceWorker`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('sonner', () => ({ toast: vi.fn() }));

import { toast } from 'sonner';
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = () => void;

function fakeEventTarget() {
  const listeners: Record<string, Listener[]> = {};
  return {
    addEventListener(type: string, cb: Listener) {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener(type: string, cb: Listener) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb);
    },
    fire(type: string) {
      (listeners[type] ?? []).forEach((cb) => cb());
    },
    listenerCount(type: string) {
      return (listeners[type] ?? []).length;
    },
  };
}

function makeWorker() {
  return { ...fakeEventTarget(), state: 'installing', postMessage: vi.fn() };
}

function makeRegistration(waiting: ReturnType<typeof makeWorker> | null = null) {
  return { ...fakeEventTarget(), waiting, installing: null as ReturnType<typeof makeWorker> | null };
}

function makeServiceWorkerContainer(controller: unknown, registration: ReturnType<typeof makeRegistration>) {
  return { ...fakeEventTarget(), controller, register: vi.fn(() => Promise.resolve(registration)) };
}

let container: HTMLDivElement;
let root: Root;
let originalNodeEnv: string | undefined;
let originalLocation: Location;
let reload: ReturnType<typeof vi.fn>;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(ServiceWorkerRegistrar));
  });
  // Flush the register().then(...) microtask.
  await act(async () => {});
}

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
  originalLocation = window.location;
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload },
  });
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  (process.env as { NODE_ENV: string | undefined }).NODE_ENV = originalNodeEnv;
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('ServiceWorkerRegistrar — hadController reload gating', () => {
  it('a first-ever install (no controller at mount) never reloads on controllerchange', async () => {
    const sw = makeServiceWorkerContainer(null, makeRegistration());
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();
    sw.fire('controllerchange');

    expect(reload).not.toHaveBeenCalled();
  });

  it('a real update reloads once on controllerchange in the tab that clicked Refresh', async () => {
    const waiting = makeWorker();
    const sw = makeServiceWorkerContainer({}, makeRegistration(waiting));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();
    // This tab clicked Refresh on the toast.
    const onClick = (vi.mocked(toast).mock.calls[0][1] as unknown as { action: { onClick: () => void } }).action.onClick;
    onClick();
    sw.fire('controllerchange');

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('firing controllerchange twice on a real update still only reloads once (dedupe guard)', async () => {
    const waiting = makeWorker();
    const sw = makeServiceWorkerContainer({}, makeRegistration(waiting));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();
    const onClick = (vi.mocked(toast).mock.calls[0][1] as unknown as { action: { onClick: () => void } }).action.onClick;
    onClick();
    sw.fire('controllerchange');
    sw.fire('controllerchange');

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('#531 — a tab that never clicked Refresh does NOT reload on controllerchange; it gets the toast instead, and Refresh there reloads too', async () => {
    const sw = makeServiceWorkerContainer(makeWorker(), makeRegistration());
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();
    vi.mocked(toast).mockClear();

    // Another tab clicked Refresh; clients.claim() fires controllerchange here too.
    sw.fire('controllerchange');

    expect(reload).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('New version available', expect.any(Object));

    // This (passive) tab's own Refresh click must actually reload — the worker
    // is already active here, so re-posting SKIP_WAITING to it is a no-op; the
    // click has to fall through to a plain reload instead.
    const onClick = (vi.mocked(toast).mock.calls.at(-1)![1] as unknown as { action: { onClick: () => void } })
      .action.onClick;
    onClick();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceWorkerRegistrar — update-prompt wiring', () => {
  it('prompts immediately when a worker is already waiting at register time AND a controller exists', async () => {
    const waiting = makeWorker();
    const sw = makeServiceWorkerContainer({}, makeRegistration(waiting));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('New version available', expect.any(Object));
  });

  it('does not prompt for a waiting worker with no controller (first install, no false prompt)', async () => {
    const waiting = makeWorker();
    const sw = makeServiceWorkerContainer(null, makeRegistration(waiting));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();

    expect(toast).not.toHaveBeenCalled();
  });

  it('prompts when a new worker reaches "installed" while a controller already exists (real update)', async () => {
    const registration = makeRegistration();
    const sw = makeServiceWorkerContainer({}, registration);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();

    const installing = makeWorker();
    registration.installing = installing;
    registration.fire('updatefound');
    installing.state = 'installed';
    installing.fire('statechange');

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('stays silent when a worker reaches "installed" on the very first install (no controller)', async () => {
    const registration = makeRegistration();
    const sw = makeServiceWorkerContainer(null, registration);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();

    const installing = makeWorker();
    registration.installing = installing;
    registration.fire('updatefound');
    installing.state = 'installed';
    installing.fire('statechange');

    expect(toast).not.toHaveBeenCalled();
  });

  it('does not prompt on intermediate states before "installed"', async () => {
    const registration = makeRegistration();
    const sw = makeServiceWorkerContainer({}, registration);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });

    await mount();

    const installing = makeWorker();
    registration.installing = installing;
    registration.fire('updatefound');
    installing.state = 'installing';
    installing.fire('statechange');

    expect(toast).not.toHaveBeenCalled();
  });
});
