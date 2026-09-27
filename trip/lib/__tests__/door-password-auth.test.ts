// @vitest-environment jsdom
//
// D-660 — the front door's username + password flows, driven through the real wall with the
// Firebase helpers faked at the module seam. The claim step (first sign-in of an account that has
// no `users/{uid}` doc) is the part that can damage data, so each of its branches is here, and the
// ordering rule is asserted directly: `users/{uid}` is never written before the password change.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => gate.on,
  isTripRemoteConfigured: () => gate.on,
  getTripId: () => 'test-trip',
  FIREBASE_CONFIG: {},
}));

const log = vi.hoisted(() => [] as string[]);
const fr = vi.hoisted(() => ({
  createPasswordAccount: vi.fn(async (_email: string, _pw: string) => 'uid-new'),
  signInWithPassword: vi.fn(async (_email: string, _pw: string) => 'uid-acct'),
  changePassword: vi.fn(async (_pw: string) => {}),
  readAccountLink: vi.fn(
    async (_uid: string): Promise<{ username: string; accountId: string } | null> => null,
  ),
  writeAccountLink: vi.fn(async (_uid: string, link: { accountId: string }) => link.accountId),
  needsAccountUpgrade: vi.fn(
    async (): Promise<
      | { kind: 'anonymous'; claimed: boolean }
      | { kind: 'claim'; uid: string; username: string }
      | null
    > => null,
  ),
}));
vi.mock('@/lib/firebase-remote', () => fr);
// The handoff's own grants are covered by account-handoff-remote.test.ts; here it is the sign-in plus the
// users/{uid} read the door sees.
vi.mock('@/lib/account-handoff-remote', () => ({
  signInWithHandoff: async (email: string, pw: string) => {
    const uid = await fr.signInWithPassword(email, pw);
    return { uid, link: await fr.readAccountLink(uid) };
  },
}));

type Probe = { verdict: 'exists' | 'missing' | 'unavailable'; name?: string };
const tr = vi.hoisted(() => ({
  probeAccountIdentity: vi.fn(async (_code: string): Promise<Probe> => ({ verdict: 'exists' })),
  seedAccountDocs: vi.fn(async (_code: string, _name?: string | null) => {}),
}));
vi.mock('@/lib/trips-remote', () => tr);

const DEVICE = '0e5d1f6a-1111-4222-8333-944455556666';
const OLD_KEY = '7c1a2b3c-aaaa-4bbb-8ccc-dddddddddddd';

import TokenGate from '@/components/token-gate';
import { getSyncCode, setSyncCode } from '@/core/storage/gateway';
import { getActiveTraveler, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { setUserName } from '@/lib/identity';

const EMAIL = 'powan@accounts.trip-planner.invalid';
let container: HTMLDivElement;
let root: Root;
let replace: ReturnType<typeof vi.fn>;
let realLocation: Location;

const at = <T extends HTMLElement>(id: string) =>
  container.querySelector<T>(`[data-testid="${id}"]`);

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

async function open(cta: 'landing-cta-login' | 'landing-cta-create') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(TokenGate)));
  await flush();
  await act(async () => {
    at(cta)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function type(testId: string, value: string) {
  const input = at<HTMLInputElement>(testId)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    at('token-gate-submit')!
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function logIn(username = 'Powan', password = 'temporary1') {
  await open('landing-cta-login');
  await type('token-gate-username', username);
  await type('token-gate-password', password);
  await submit();
}

async function claim(newPassword = 'mine-now-123', confirm = newPassword, oldKey?: string) {
  await type('token-gate-new-password', newPassword);
  await type('token-gate-confirm-password', confirm);
  if (oldKey !== undefined) await type('token-gate-old-key', oldKey);
  await submit();
}

const errorText = () => at('token-gate-error')?.textContent;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  gate.on = true;
  log.length = 0;
  for (const f of [...Object.values(fr), ...Object.values(tr)]) f.mockClear();
  fr.createPasswordAccount.mockImplementation(async () => (log.push('create'), 'uid-new'));
  fr.signInWithPassword.mockImplementation(async () => (log.push('signin'), 'uid-acct'));
  fr.changePassword.mockImplementation(async () => void log.push('changePassword'));
  fr.readAccountLink.mockImplementation(async () => null);
  fr.needsAccountUpgrade.mockImplementation(async () => null);
  fr.writeAccountLink.mockImplementation(async (_uid, link) => (log.push('writeLink'), link.accountId));
  tr.probeAccountIdentity.mockImplementation(async () => ({ verdict: 'exists' }));
  realLocation = window.location;
  replace = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { replace, reload: vi.fn(), assign: vi.fn(), href: '', search: '' },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true, writable: true });
});

describe('sign-up', () => {
  it('links the credential, writes users/{uid}, seeds the account, then admits', async () => {
    await open('landing-cta-create');
    await type('token-gate-name', 'Powan');
    await type('token-gate-username', '  Powan ');
    await type('token-gate-password', 'longenough');
    await submit();

    expect(fr.createPasswordAccount).toHaveBeenCalledWith(EMAIL, 'longenough');
    const accountId = getSyncCode();
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-new', { username: 'powan', accountId });
    expect(tr.seedAccountDocs).toHaveBeenCalledWith(accountId, 'Powan');
    expect(getActiveTraveler()?.name).toBe('Powan');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('a taken username says so, stores nothing, and puts focus on the username', async () => {
    fr.createPasswordAccount.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/email-already-in-use' }),
    );
    await open('landing-cta-create');
    await type('token-gate-name', 'Powan');
    await type('token-gate-username', 'powan');
    await type('token-gate-password', 'longenough');
    await submit();

    expect(errorText()).toBe('That username is taken. Pick another one.');
    expect(fr.writeAccountLink).not.toHaveBeenCalled();
    expect(getSyncCode()).toBeNull();
    expect(getActiveTraveler()).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('token-gate-username');
    expect(at('token-gate-username')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('checks the username and password shape before calling anything', async () => {
    await open('landing-cta-create');
    await type('token-gate-name', 'Powan');
    await type('token-gate-username', 'no spaces!');
    await type('token-gate-password', 'longenough');
    await submit();
    expect(errorText()).toMatch(/3 to 20 characters/);

    await type('token-gate-username', 'powan');
    await type('token-gate-password', 'short');
    await submit();
    expect(errorText()).toMatch(/at least 8 characters/);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('token-gate-password');
    expect(fr.createPasswordAccount).not.toHaveBeenCalled();
  });
});

describe('sign-in', () => {
  it('an account with users/{uid} adopts its account id and the account name', async () => {
    fr.readAccountLink.mockResolvedValueOnce({ username: 'powan', accountId: 'acct-1' });
    tr.probeAccountIdentity.mockResolvedValueOnce({ verdict: 'exists', name: 'Powan P' });
    await logIn();

    expect(fr.signInWithPassword).toHaveBeenCalledWith(EMAIL, 'temporary1');
    expect(fr.readAccountLink).toHaveBeenCalledWith('uid-acct');
    expect(getSyncCode()).toBe('acct-1');
    expect(getActiveTraveler()?.name).toBe('Powan P');
    expect(fr.changePassword).not.toHaveBeenCalled();
    expect(fr.writeAccountLink).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it.each(['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'])(
    '%s reads as the one generic refusal',
    async (code) => {
      fr.signInWithPassword.mockRejectedValueOnce(Object.assign(new Error('x'), { code }));
      await logIn();
      expect(errorText()).toBe('Username or password is wrong.');
      expect(getActiveTraveler()).toBeNull();
    },
  );

  it('a failed users/{uid} read is an error, never the claim step', async () => {
    fr.readAccountLink.mockRejectedValueOnce(new Error('offline'));
    await logIn();
    expect(at('token-gate-new-password')).toBeNull();
    expect(errorText()).toMatch(/could not reach your account/);
  });
});

describe('first sign-in claim (users/{uid} missing)', () => {
  it('carries over this device’s account id: password first, then users/{uid}', async () => {
    setSyncCode(DEVICE);
    setUserName('Powan');
    await logIn();
    expect(at('token-gate-claim-device')).not.toBeNull();
    expect(at('token-gate-old-key')).toBeNull();
    expect(fr.writeAccountLink).not.toHaveBeenCalled();

    await claim();
    expect(log).toEqual(['signin', 'changePassword', 'writeLink']);
    expect(fr.changePassword).toHaveBeenCalledWith('mine-now-123');
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-acct', {
      username: 'powan',
      accountId: DEVICE,
    });
    expect(tr.seedAccountDocs).not.toHaveBeenCalled();
    expect(getSyncCode()).toBe(DEVICE);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('a pasted old key is validated before the password changes, then carried over', async () => {
    await logIn();
    await claim(undefined, undefined, ` ${OLD_KEY.toUpperCase()} `);
    expect(tr.probeAccountIdentity).toHaveBeenCalledWith(OLD_KEY);
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-acct', {
      username: 'powan',
      accountId: OLD_KEY,
    });
    expect(getSyncCode()).toBe(OLD_KEY);
  });

  it('a pasted string that is not a key is refused before any probe', async () => {
    await logIn();
    await claim(undefined, undefined, 'typo-key');
    expect(errorText()).toMatch(/That is not a key/);
    expect(tr.probeAccountIdentity).not.toHaveBeenCalled();
    expect(fr.changePassword).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('token-gate-old-key');
  });

  it('an id another username owns says so and offers Start fresh, which then succeeds', async () => {
    setSyncCode(DEVICE);
    fr.writeAccountLink.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'account/claimed' }),
    );
    await logIn();
    await claim();
    expect(errorText()).toBe('This account already has a username. Log in with it.');
    expect(getActiveTraveler()).toBeNull();

    await act(async () => {
      at('token-gate-start-fresh')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(at('token-gate-claim-fresh')).not.toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('token-gate-new-password');
    await submit();
    const fresh = getSyncCode();
    expect(fresh).not.toBe(DEVICE);
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(fr.writeAccountLink).toHaveBeenLastCalledWith('uid-acct', { username: 'powan', accountId: fresh });
    expect(tr.seedAccountDocs).toHaveBeenCalledWith(fresh);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('a rules refusal is not described as a connection problem', async () => {
    setSyncCode(DEVICE);
    fr.writeAccountLink.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await logIn();
    await claim();
    expect(errorText()).toMatch(/refused/);
    expect(errorText()).not.toMatch(/reach/);
  });

  it('a pasted key that names no account is refused with nothing changed', async () => {
    tr.probeAccountIdentity.mockResolvedValueOnce({ verdict: 'missing' });
    await logIn();
    await claim(undefined, undefined, OLD_KEY);
    expect(errorText()).toMatch(/No account uses that key/);
    expect(fr.changePassword).not.toHaveBeenCalled();
    expect(fr.writeAccountLink).not.toHaveBeenCalled();
    expect(getSyncCode()).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('token-gate-old-key');
  });

  it('neither a device id nor a key starts a fresh, seeded account', async () => {
    await logIn();
    await claim(undefined, undefined, '');
    const accountId = getSyncCode();
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-acct', { username: 'powan', accountId });
    expect(tr.seedAccountDocs).toHaveBeenCalledWith(accountId);
  });

  it('a failed password change writes NO users/{uid} and admits no one', async () => {
    setSyncCode(DEVICE);
    fr.changePassword.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/network-request-failed' }),
    );
    await logIn();
    await claim();
    expect(fr.writeAccountLink).not.toHaveBeenCalled();
    expect(getActiveTraveler()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/could not reach your account/);
  });

  it('mismatched new passwords are caught before anything is called', async () => {
    await logIn();
    await claim('mine-now-123', 'mine-now-124');
    expect(errorText()).toBe('The two passwords do not match.');
    expect(fr.changePassword).not.toHaveBeenCalled();
  });
});

describe('dormant build (no account server)', () => {
  it('admits locally without touching the auth helpers, and says so on the card', async () => {
    gate.on = false;
    await open('landing-cta-login');
    expect(at('token-gate-local-note')).not.toBeNull();
    await type('token-gate-username', 'powan');
    await type('token-gate-password', 'anything8');
    await submit();

    for (const f of Object.values(fr)) expect(f).not.toHaveBeenCalled();
    expect(getSyncCode()).toMatch(/^[0-9a-f-]{36}$/);
    expect(getActiveTraveler()?.name).toBe(DEFAULT_TRAVELER_NAME);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('upgrade: a device admitted before passwords (anonymous session)', () => {
  const ANON = { kind: 'anonymous' as const, claimed: false };

  async function mountAdmitted(withCode = true) {
    window.localStorage.setItem('tripPlannerToken', 'Uttam');
    window.localStorage.setItem('tripPlannerUserName', 'Uttam');
    if (withCode) setSyncCode(DEVICE);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(TokenGate)));
    await flush();
  }

  async function fillAndSubmit() {
    await type('token-gate-username', 'uttam');
    await type('token-gate-password', 'password1');
    await submit();
  }

  const reload = () => (window.location as unknown as { reload: ReturnType<typeof vi.fn> }).reload;

  it('shows over the app when the session is anonymous, with a Later that defers it', async () => {
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    await mountAdmitted();
    expect(at('token-gate-later')).not.toBeNull();
    expect(at('token-gate-mode-login')!.textContent).toBe('I was given a username');
    expect(at('token-gate-name')).toBeNull();
    await act(async () => {
      at('token-gate-later')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('(a) an account that already has users/{uid} is adopted', async () => {
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    fr.readAccountLink.mockResolvedValueOnce({ username: 'uttam', accountId: 'acct-server' });
    await mountAdmitted();
    await fillAndSubmit();
    expect(fr.signInWithPassword).toHaveBeenCalledWith('uttam@accounts.trip-planner.invalid', 'password1');
    expect(getSyncCode()).toBe('acct-server');
    expect(fr.writeAccountLink).not.toHaveBeenCalled();
    expect(reload()).toHaveBeenCalledTimes(1);
  });

  it('(a) a first sign-in claims THIS device id: password change before the users/{uid} write', async () => {
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    await mountAdmitted();
    await fillAndSubmit();
    expect(at('token-gate-claim-device')).not.toBeNull();
    // The anonymous session is already gone: deferring now would strand a temp-password session.
    expect(at('token-gate-later')).toBeNull();
    await claim();
    expect(log).toEqual(['signin', 'changePassword', 'writeLink']);
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-acct', { username: 'uttam', accountId: DEVICE });
    expect(tr.seedAccountDocs).not.toHaveBeenCalled();
    expect(getSyncCode()).toBe(DEVICE);
    expect(getActiveTraveler()?.name).toBe('Uttam');
    expect(reload()).toHaveBeenCalledTimes(1);
  });

  it('(b) create links the anonymous uid, keeps the device id and does not reseed', async () => {
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    await mountAdmitted();
    await act(async () => {
      at('token-gate-mode-create')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await fillAndSubmit();
    expect(fr.createPasswordAccount).toHaveBeenCalledWith('uttam@accounts.trip-planner.invalid', 'password1');
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-new', { username: 'uttam', accountId: DEVICE });
    expect(tr.seedAccountDocs).not.toHaveBeenCalled();
    expect(getSyncCode()).toBe(DEVICE);
    expect(getActiveTraveler()?.name).toBe('Uttam');
    expect(reload()).toHaveBeenCalledTimes(1);
  });

  it('fails open: an unreachable auth check shows nothing', async () => {
    fr.needsAccountUpgrade.mockRejectedValue(new Error('chunk load failed'));
    await mountAdmitted();
    expect(fr.needsAccountUpgrade).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('no account id: (b) create mints one and seeds it, linked on the anonymous uid', async () => {
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    await mountAdmitted(false);
    await act(async () => {
      at('token-gate-mode-create')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await fillAndSubmit();
    const minted = getSyncCode();
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-new', { username: 'uttam', accountId: minted });
    expect(tr.seedAccountDocs).toHaveBeenCalledWith(minted, 'Uttam');
  });

  it('no account id: (a) the claim offers the old-key field / fresh start', async () => {
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    await mountAdmitted(false);
    await fillAndSubmit();
    expect(at('token-gate-old-key')).not.toBeNull();
    expect(at('token-gate-claim-device')).toBeNull();
  });

  it('a half-done claim (password session, no users/{uid}) resumes at the claim, with no Later', async () => {
    fr.needsAccountUpgrade.mockResolvedValue({ kind: 'claim', uid: 'uid-acct', username: 'uttam' });
    await mountAdmitted();
    expect(at('token-gate-new-password')).not.toBeNull();
    expect(at('token-gate-later')).toBeNull();
    await claim();
    expect(fr.signInWithPassword).not.toHaveBeenCalled();
    expect(log).toEqual(['changePassword', 'writeLink']);
    expect(fr.writeAccountLink).toHaveBeenCalledWith('uid-acct', { username: 'uttam', accountId: DEVICE });
    expect(reload()).toHaveBeenCalledTimes(1);
  });

  it('an id that already has a username offers log-in only', async () => {
    fr.needsAccountUpgrade.mockResolvedValue({ kind: 'anonymous', claimed: true });
    await mountAdmitted();
    expect(at('token-gate-mode-create')).toBeNull();
    expect(at('token-gate-username')).not.toBeNull();
    expect(at('token-gate-submit')!.textContent).toMatch(/Log in/);
  });

  it('a stale session on resume sends the user back to log in, with nothing written', async () => {
    fr.needsAccountUpgrade.mockResolvedValue({ kind: 'claim', uid: 'uid-acct', username: 'uttam' });
    fr.changePassword.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/requires-recent-login' }),
    );
    await mountAdmitted();
    await claim();
    expect(fr.writeAccountLink).not.toHaveBeenCalled();
    expect(at('token-gate-username')).not.toBeNull();
    expect(errorText()).toMatch(/log in once more/);
  });

  it('a dormant build never checks and never shows it', async () => {
    gate.on = false;
    fr.needsAccountUpgrade.mockResolvedValue(ANON);
    await mountAdmitted();
    expect(fr.needsAccountUpgrade).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('create retry after a failed users/{uid} write', () => {
  it('finishes the SAME Auth user even if the username was edited in between', async () => {
    fr.writeAccountLink.mockRejectedValueOnce(new Error('offline'));
    await open('landing-cta-create');
    await type('token-gate-name', 'Powan');
    await type('token-gate-username', 'powan');
    await type('token-gate-password', 'longenough');
    await submit();
    expect(errorText()).toMatch(/could not reach your account/);
    expect(at('token-gate-username')!.hasAttribute('readonly')).toBe(true);

    await type('token-gate-username', 'someoneelse');
    await submit();
    expect(fr.createPasswordAccount).toHaveBeenCalledTimes(1);
    expect(fr.writeAccountLink).toHaveBeenLastCalledWith('uid-new', {
      username: 'powan',
      accountId: expect.any(String),
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
