'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Plane, User, AtSign, Lock, KeyRound, Eye, EyeOff, ArrowRight } from 'lucide-react';
import {
  signIn,
  DEFAULT_TRAVELER_NAME,
  USERNAME_RE,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  usernameToEmail,
} from '@/lib/token-auth';
import { ACCOUNT_ID_RE, ACCOUNT_CLAIMED, OWNER_HANDOFF_FAILED } from '@/lib/account-codes';
import { getUserName } from '@/lib/identity';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getSyncCode, setSyncCode, nameHintFlag } from '@/core/storage/gateway';
import { joinTrip, parseTripToken } from '@/core/trips/registry';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { withBasePath } from '@/lib/utils';
import { TRIP_START } from '@/lib/trip-data';
import { getNow } from '@/lib/trip-now';
import { computeCountdown, type Countdown } from '@/lib/countdown';
import LandingPage from '@/components/landing-page';
import OptimizedImage from '@/components/optimized-image';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';
import type { AccountUpgrade } from '@/lib/firebase-remote';

/**
 * The front door — the app's WALL, shown iff `!traveler`. There is no guest mode: a logged-out
 * visitor sees this wall on every route, with no bypass.
 *
 * TWO VIEWS: the wall opens on the marketing LANDING (`components/landing-page.tsx`, zero live
 * trip data) and swaps to the boarding-pass AUTH card when a landing CTA is pressed. Both views
 * render inside the SAME `role="dialog"` panel, so the landing inherits the focus trap, aria wiring
 * and Esc capture. The dialog's `aria-labelledby`/`aria-describedby` targets move with the view.
 *
 * ACCOUNTS ARE USERNAME + PASSWORD (D-660), on Firebase Auth. The username maps to a synthetic
 * email on the reserved `.invalid` TLD (`usernameToEmail`), so Auth enforces uniqueness and
 * nothing is ever mailed. `users/{uid}` records which account id the user owns; that id is what
 * key 28 (`tripPlannerSyncCode`) holds and what the trip list and identity docs are keyed by.
 * - Create: link the device's anonymous session to the new credential (its uid is already in
 *   trip rosters), mint an account id, write `users/{uid}`, seed the account docs.
 * - Log in: `signInWithHandoff` (lib/account-handoff-remote) first grants the account's uid this device's
 *   roles on every trip it can see, then swaps the session and reads `users/{uid}`. Present → adopt
 *   its account id.
 * - Log in, `users/{uid}` MISSING: an account made in the console with a temporary password. The
 *   missing doc IS the must-change-password flag, so the CLAIM step asks for a new password,
 *   then carries over this device's account id, or a pasted old key (validated by
 *   `probeAccountIdentity`), or starts fresh. `users/{uid}` + `accountClaims/{id}` are written only
 *   after the password change succeeds. An id someone else already claimed offers "Start fresh".
 * - UPGRADE: a device admitted before passwords (anonymous session, account id in key 28) gets the
 *   card over the app. "I was given a username" is log-in + claim with this device's id; "Create"
 *   links the anonymous uid and writes `users/{uid}` naming the SAME id, with no reseed. When that
 *   id is already claimed, only log-in is offered. "Later" defers to the next load; an
 *   unconfirmable check shows nothing.
 * - DORMANT build (no Firebase config — CI and e2e): no account server exists, so the form admits
 *   locally, as the door always has there, and says so.
 *
 * Every remote touch is a DYNAMIC import, so the door's static graph stays firebase-free (D-054).
 * Every path ends in a FULL reload: the provider re-hydrates with the account id and traveler both
 * present. A Trip Token is never a login: it is entered on `/trips`, after logging in.
 *
 * `?trip=` INVITATION: the pending Trip Token is read off the URL here and joined on completion,
 * landing on `/` (the join IS the selection). An `&invite=` token leaves the URL on mount, is held in
 * memory only, and is redeemed before the join; a refused invite joins nothing.
 *
 * A11y: role="dialog" aria-modal, document-level Esc capture (the wall does NOT dismiss), a
 * Tab-trap inside the panel, autofocus on the first field. Every input has a <label> and an
 * autocomplete token; errors land in one polite live region and focus moves to the field at fault.
 * Motion uses `m.*` only; reduced motion is honored by the global <MotionConfig reducedMotion="user">.
 */

export default function TokenGate() {
  const { traveler } = useActiveTraveler();

  // SSR-safe first paint: `useActiveTraveler` yields the inert `{traveler:null}` snapshot on the
  // server and the first client render, which would spuriously show the wall for EVERYONE for one
  // frame. Gate on a post-mount flag.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * the wall must OUTLIVE `signIn`. `signIn` dispatches identity:changed, so without this hold the
   * derived `show` would drop before the reload and flash the app behind. The wall sets this before
   * it touches identity, and only a navigation ever clears it.
   */
  const [held, setHeld] = useState(false);

  /**
   * UPGRADE (D-660): a device admitted before passwords, still on an anonymous session, is asked to
   * attach a username + password to the account id it holds. Checked once per load; anything that
   * cannot be confirmed (dormant, offline, auth unreachable) shows nothing and tries next load.
   */
  const signedIn = traveler !== null;
  const [upgrade, setUpgrade] = useState<AccountUpgrade | null>(null);
  useEffect(() => {
    if (!mounted || !signedIn || !isRemoteConfigured()) return;
    let live = true;
    import('@/lib/firebase-remote')
      .then(({ needsAccountUpgrade }) => needsAccountUpgrade())
      .then(
        (needed) => live && needed && setUpgrade(needed),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [mounted, signedIn]);

  const show = mounted && (held || !traveler || upgrade);

  return (
    <AnimatePresence>
      {show && (
        <TokenGateWall
          onHold={() => setHeld(true)}
          upgrade={traveler ? upgrade : null}
          onLater={() => setUpgrade(null)}
        />
      )}
    </AnimatePresence>
  );
}

type Mode = 'login' | 'create';
/** The wall opens on the marketing landing; a CTA swaps it to the auth card. */
type View = 'landing' | 'auth';
/** 'claim' is the first sign-in of an account that has no `users/{uid}` yet. */
type Stage = 'form' | 'claim';
type FieldKey = 'name' | 'username' | 'password' | 'newPassword' | 'confirmPassword' | 'oldKey';

/** How long the wall waits for account seeding / roster enrolment before navigating anyway. */
const REMOTE_BUDGET_MS = 5000;

function within(work: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    work.catch(() => undefined),
    new Promise((r) => setTimeout(r, REMOTE_BUDGET_MS)),
  ]);
}

/** The wall's failure state: an annunciator label, the condition in words, and the field at fault. */
type WallError = { label: string; text: string; field?: FieldKey };

/**
 * Site storage refused (Safari "Block All Cookies", a sandboxed iframe). The gateway degrades every
 * write to a silent no-op by contract, so this is detected by reading back.
 */
const STORAGE_BLOCKED: WallError = {
  label: 'Storage · Blocked',
  text: 'This browser is blocking site storage, so this device cannot keep you signed in. Allow site data for this site, or leave private browsing, then try again.',
};

const SIGN_IN_FAILED: WallError = {
  label: 'Sign-in · Failed',
  text: 'We could not start a session on this device. Reload the page and try again.',
};

const BAD_USERNAME: WallError = {
  label: 'Username',
  text: 'Usernames are 3 to 20 characters: lowercase letters, numbers and underscores.',
  field: 'username',
};

const SHORT_PASSWORD = (field: FieldKey): WallError => ({
  label: 'Password',
  text: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`,
  field,
});

const NO_NAME: WallError = { label: 'Name', text: 'Enter your name.', field: 'name' };

const PASSWORD_MISMATCH: WallError = {
  label: 'Password',
  text: 'The two passwords do not match.',
  field: 'confirmPassword',
};

// One message for a wrong password AND an unknown username, so the door does not tell a stranger
// which usernames exist.
const WRONG_CREDENTIALS: WallError = {
  label: 'Log in · Refused',
  text: 'Username or password is wrong.',
  field: 'password',
};

const USERNAME_TAKEN: WallError = {
  label: 'Username · Taken',
  text: 'That username is taken. Pick another one.',
  field: 'username',
};

const SIGN_IN_AGAIN: WallError = {
  label: 'Log in · Again',
  text: 'For your security, log in once more with the password you were given, then choose your new one.',
  field: 'username',
};

const KEY_REJECTED: WallError = {
  label: 'Key · Not found',
  text: 'No account uses that key. Check it, or leave the field empty to start a fresh account.',
  field: 'oldKey',
};

const KEY_UNCHECKED: WallError = {
  label: 'Key · Not checked',
  text: 'We could not check that key just now. Check your connection and try again.',
  field: 'oldKey',
};

const KEY_MALFORMED: WallError = {
  label: 'Key · Not valid',
  text: 'That is not a key. Keys look like 8-4-4-4-12 groups of letters a to f and numbers.',
  field: 'oldKey',
};

const INVITE_INVALID: WallError = {
  label: 'Invite · Not valid',
  text: 'You are logged in, but this invite has expired, was already used, or was cancelled. Ask the trip owner for a new link.',
};

const INVITE_FAILED: WallError = {
  label: 'Invite · Not reached',
  text: 'You are logged in, but we could not reach the trip to use this invite. Check your connection and try again.',
};

const ALREADY_CLAIMED: WallError = {
  label: 'Account · Taken',
  text: 'This account already has a username. Log in with it.',
};

/** Map a Firebase Auth rejection to words. Anything unrecognised reads as a connection problem. */
function authError(err: unknown, field: FieldKey = 'password'): WallError {
  switch ((err as { code?: unknown } | null)?.code) {
    case ACCOUNT_CLAIMED:
      return ALREADY_CLAIMED;
    case OWNER_HANDOFF_FAILED:
      return {
        label: 'Log in · Stopped',
        text: 'Your trips could not be moved to this account yet, so nothing changed on this device. Check your connection and try again.',
      };
    case 'permission-denied':
      return {
        label: 'Account · Refused',
        text: 'The server refused that change. Nothing was saved. Try again, or ask the trip owner for help.',
      };
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return USERNAME_TAKEN;
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return WRONG_CREDENTIALS;
    case 'auth/weak-password':
      return { label: 'Password', text: 'Pick a longer or less common password.', field };
    case 'auth/too-many-requests':
      return {
        label: 'Log in · Paused',
        text: 'Too many attempts. Wait a few minutes, then try again.',
      };
    default:
      return {
        label: 'Account · Not reached',
        text: 'We could not reach your account just now. Check your connection and try again.',
      };
  }
}

function TokenGateWall({
  onHold,
  upgrade: pendingUpgrade = null,
  onLater,
}: {
  onHold: () => void;
  /** An admitted device that still owes a username + password, or a claim left half done. */
  upgrade?: AccountUpgrade | null;
  onLater?: () => void;
}) {
  const remote = isRemoteConfigured();
  const upgrade = pendingUpgrade !== null;
  const resumeClaim = pendingUpgrade?.kind === 'claim' ? pendingUpgrade : null;
  // This device's id already belongs to a username, so creating a second one for it would be refused.
  const loginOnly = pendingUpgrade?.kind === 'anonymous' && pendingUpgrade.claimed;
  const [view, setView] = useState<View>(upgrade ? 'auth' : 'landing');
  // Every landing CTA sets the mode, so this starting value renders for no one (#70). The entry
  // focus assertions in s345-front-door.test.ts and e2e/login.spec.ts pin the INTAKE-03 rule.
  const [mode, setMode] = useState<Mode>('login');
  const [stage, setStage] = useState<Stage>(resumeClaim ? 'claim' : 'form');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldKey, setOldKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [wallError, setWallError] = useState<WallError | null>(null);
  /** This device's account id, when it has one: the claim step carries it over without asking. */
  const [savedCode, setSavedCode] = useState<string | null>(null);
  /** Set by "Start fresh" after the carried-over id turned out to belong to someone else. */
  const [startFresh, setStartFresh] = useState(false);
  /** A pending Trip Token from a `?trip=` invitation, joined after login/create. */
  const [pendingTrip, setPendingTrip] = useState<string | null>(null);
  /** A single-use invite token off `&invite=`. Memory only, never written to storage. */
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  /** Signed in, but the invite was refused or unreachable; the wall offers retry / continue. */
  const [inviteStuck, setInviteStuck] = useState(false);
  const inviteActionRef = useRef<HTMLButtonElement>(null);

  /** The signed-in user the claim step is finishing; a `minted` fresh id is kept so a retry reuses it. */
  const claimRef = useRef<{ uid: string; username: string; minted?: string } | null>(
    resumeClaim ? { uid: resumeClaim.uid, username: resumeClaim.username } : null,
  );
  /**
   * A create whose Auth account exists but whose `users/{uid}` write failed. A retry finishes THAT
   * account whatever is typed now (the username field locks), or a second Auth user would be made
   * and the first username burned.
   */
  const [pendingCreate, setPendingCreate] = useState<{
    uid: string;
    username: string;
    accountId: string;
    reused: boolean;
  } | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const errorId = `${baseId}-error`;
  const fieldId = (key: FieldKey) => `${baseId}-${key}`;

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // body[data-dialog-open] seam flag while open (the FAB hides on it). Mounting IS open.
  useDialogOpenFlag();

  // Storage + URL are client-only facts; read once after mount.
  useEffect(() => {
    const code = getSyncCode();
    setSavedCode(code && ACCOUNT_ID_RE.test(code) ? code : null);
    // An admitted device's link belongs to the join dialog, which already read it.
    if (upgrade) return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('trip')?.trim();
    const inv = params.get('invite')?.trim();
    if (t) setPendingTrip(t);
    if (t && inv) setInviteToken(inv);
    // The wall owns the link from here. Left in the URL, the join dialog would re-read `trip` once
    // sign-in identifies the device and open over the wall.
    if (params.has('trip') || params.has('invite')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('trip');
      url.searchParams.delete('invite');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the first field on open and whenever the form swaps; re-assert shortly after in case the
  // open animation steals focus, but only if focus isn't already in the panel. The landing view has
  // no field but MUST still take focus, or the first Tab walks out of the wall.
  // 🔴 `querySelector('button:not([disabled])')` is DOM-ORDER-SENSITIVE: it is what puts entry
  // focus on `landing-cta-login`, the first button in `landing-page.tsx`'s hero.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        const target =
          view === 'landing'
            ? panel.querySelector<HTMLElement>('button:not([disabled])')
            : firstFieldRef.current;
        target?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [mode, stage, view]);

  // Move focus to the field an error names, so a keyboard or screen-reader user lands on the fix.
  useEffect(() => {
    if (wallError?.field) document.getElementById(fieldId(wallError.field))?.focus();
    else if (inviteStuck) inviteActionRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallError]);

  // WALL DIVERGENCE: Esc is captured so it never falls through to anything behind the wall, but it
  // does NOT dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Lightweight Tab-trap inside the panel, queried at keydown time so it follows the current view.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /** Adopt a pending invitation (lands Home), otherwise land on `/trips/`. FULL reload either way. */
  const finish = async () => {
    if (upgrade) {
      window.location.reload();
      return;
    }
    const parsed = pendingTrip ? parseTripToken(pendingTrip) : null;
    if (parsed && inviteToken && remote) {
      const result = await within(
        import('@/lib/invites-remote').then(({ redeemInvite }) => redeemInvite(parsed.id, inviteToken)),
      );
      if (result !== 'joined' && result !== 'already') {
        if (result === 'invalid') setInviteToken(null);
        setBusy(false);
        setInviteStuck(true);
        setWallError(result === 'invalid' ? INVITE_INVALID : INVITE_FAILED);
        return;
      }
    }
    // D-546 — a token that could not be used falls through to the normal `/trips/` landing.
    if (pendingTrip && joinTrip(pendingTrip)) {
      window.location.replace(withBasePath('/'));
      return;
    }
    window.location.replace(withBasePath('/trips/'));
  };

  const fail = (err: WallError) => {
    setBusy(false);
    setWallError(err);
  };

  /**
   * The single exit for every admitted path: store the account id (read back, because a blocked
   * store is a silent no-op), sign in under a display name, reload. The name is the one typed at
   * create, else this device's, else the account's own (D-277, off the probe's single read), else
   * the placeholder plus a one-shot rename nudge.
   */
  const admit = async (accountId: string, typedName?: string) => {
    setSyncCode(accountId);
    if (getSyncCode() !== accountId) return fail(STORAGE_BLOCKED);
    const stored = getUserName()?.trim();
    let account: string | undefined;
    if (!typedName && !stored) {
      const probe = await import('@/lib/trips-remote')
        .then(({ probeAccountIdentity }) => probeAccountIdentity(accountId))
        .catch(() => ({ verdict: 'unavailable' as const, name: undefined }));
      account = probe.name;
    }
    onHold();
    if (!signIn(typedName || stored || account || DEFAULT_TRAVELER_NAME)) return fail(SIGN_IN_FAILED);
    if (!typedName && !stored && !account) nameHintFlag.mark();
    return finish();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const u = normalizeUsername(username);
    const who = name.trim();
    if (mode === 'create' && !upgrade && !who) return setWallError(NO_NAME);
    if (!USERNAME_RE.test(u)) return setWallError(BAD_USERNAME);
    if (password.length < MIN_PASSWORD_LENGTH) return setWallError(SHORT_PASSWORD('password'));
    setWallError(null);
    setBusy(true);

    // Dormant: no account server to check against. Admit locally, as the door always has here.
    if (!remote) return admit(getSyncCode() ?? crypto.randomUUID(), mode === 'create' ? who : undefined);

    let fr: typeof import('@/lib/firebase-remote');
    try {
      fr = await import('@/lib/firebase-remote');
    } catch (err) {
      return fail(authError(err));
    }

    if (mode === 'create') {
      let created = pendingCreate;
      let accountId: string;
      try {
        if (!created) {
          const uid = await fr.createPasswordAccount(usernameToEmail(u), password);
          // An upgrade keeps the account id this device already holds: its docs exist already.
          const deviceCode = upgrade ? savedCode : null;
          created = {
            uid,
            username: u,
            accountId: deviceCode ?? crypto.randomUUID(),
            reused: !!deviceCode,
          };
          setPendingCreate(created);
        }
        accountId = await fr.writeAccountLink(created.uid, {
          username: created.username,
          accountId: created.accountId,
        });
      } catch (err) {
        return fail(authError(err, 'username'));
      }
      const typedName = upgrade ? undefined : who;
      if (!created.reused) {
        await within(
          import('@/lib/trips-remote').then(({ seedAccountDocs }) =>
            seedAccountDocs(accountId, typedName ?? getUserName()),
          ),
        );
      }
      return admit(accountId, typedName);
    }

    try {
      const { signInWithHandoff } = await import('@/lib/account-handoff-remote');
      const { uid, link } = await signInWithHandoff(usernameToEmail(u), password);
      if (link) return admit(link.accountId);
      claimRef.current = { uid, username: u };
    } catch (err) {
      return fail(authError(err));
    }
    setBusy(false);
    setStage('claim');
  };

  /**
   * First sign-in: new password first, then the account id, then `users/{uid}`. The trip grants
   * already happened in `signInWithHandoff`, before the session swapped.
   */
  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const claim = claimRef.current;
    if (busy || !claim) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setWallError(SHORT_PASSWORD('newPassword'));
    if (newPassword !== confirmPassword) return setWallError(PASSWORD_MISMATCH);
    const pasted = startFresh ? '' : oldKey.trim().toLowerCase();
    if (pasted && !ACCOUNT_ID_RE.test(pasted)) return setWallError(KEY_MALFORMED);
    setWallError(null);
    setBusy(true);

    try {
      const tr = await import('@/lib/trips-remote');
      const fr = await import('@/lib/firebase-remote');
      let accountId = startFresh ? null : savedCode;
      if (!accountId && pasted) {
        const probe = await tr.probeAccountIdentity(pasted);
        if (probe.verdict === 'missing') return fail(KEY_REJECTED);
        if (probe.verdict !== 'exists') return fail(KEY_UNCHECKED);
        accountId = pasted;
      }
      // A minted id is kept across retries so a write whose answer was lost is not repeated under a new one.
      const fresh = !accountId;
      if (!accountId) accountId = claim.minted ??= crypto.randomUUID();

      try {
        await fr.changePassword(newPassword);
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code === 'auth/requires-recent-login') {
          setMode('login');
          setStage('form');
          return fail(SIGN_IN_AGAIN);
        }
        return fail(authError(err, 'newPassword'));
      }
      const id = await fr.writeAccountLink(claim.uid, { username: claim.username, accountId });
      if (fresh && id === accountId) await within(tr.seedAccountDocs(id));
      return admit(id);
    } catch (err) {
      return fail(authError(err, 'newPassword'));
    }
  };

  /**
   * The `?trip=` invitation acknowledgement, built once and PLACED by the view: the landing renders
   * it inside its cover (#25), the auth card above its header.
   */
  const invite = pendingTrip && !upgrade ? (
    <p
      data-testid="token-gate-invite"
      className="w-full max-w-[46ch] rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-overlay px-3 py-2.5 text-t-sm leading-relaxed text-ink-mid"
    >
      {inviteToken
        ? 'Someone invited you to a trip. Log in or create an account to join it.'
        : 'Someone shared a trip with you. Log in or create an account to open it.'}
    </p>
  ) : null;

  const fieldProps = (key: FieldKey) => ({
    id: fieldId(key),
    readOnly: busy || inviteStuck,
    invalid: wallError?.field === key,
    errorId: wallError ? errorId : undefined,
  });

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      // Full-screen WALL. NO onClick-to-close (divergence): clicks on the backdrop do nothing.
      // z-[70] sits above name-prompt's z-[60].
      // merge seam: `bg-aurora animate-aurora` removed — deleted both
      // declarations from globals.css along with the rest of the ambient decoration, and
      // this file was fenced to the lane at the time, so its engineer could not follow.
      // Left in place they were class names resolving to no CSS. `hero-gradient` stays and
      // still paints the wall — it is what the LANDING view sits on, and it is what shows
      // through if the cover raster below ever fails to decode.
      //
      // #25 — `wall-auth-open` is the class D-293 R4 is implemented with. It is on the WALL
      // ROOT and not on the panel because the thing it has to reach (the cover's Ken Burns)
      // is a sibling of the panel, not a descendant. See globals.css.
      className={`fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto overscroll-contain hero-gradient ${
        view === 'auth' ? 'wall-auth-open' : ''
      }`}
    >
      {/* ── #25 · THE COVER, STILL MOUNTED ───────────────────────────────────────────────
          The design rule puts the auth panel's scrim `rgba(10,7,20,.72)` OVER the cover, not
          instead of it: the front door is photographic in BOTH views, and the auth card is a
          Tier-3 form floating on the picture. This layer is what the wall used to lose when a
          CTA swapped the view — the landing (which owns the cover inside the panel) unmounts,
          and before this the auth card was left on a flat gradient with no photography at all.

          It is a SIBLING of the panel rather than something inside it, which is what keeps the
          three pinned front-door behaviours untouched: it is not in `panelRef`, so the Tab-trap
          and the `panel.querySelector('button:not([disabled])')` focus query cannot see it, and
          it contains nothing focusable in any case.

          The stack is the ruled photo engine, reused element for element (`photo-header__media`
          gives it the isolation, the img grade and the children's inset; `.door-wall` is the
          two-declaration delta). The ONE thing that differs from the cover is the scrim: this
          is the flat panel scrim the design rule names, not `.photo-header`'s bottom-weighted
          ramp, because the card floats mid-screen instead of sitting in the dark end of a band.

          DECORATIVE, which is the ruled treatment for a duotone-graded, scrimmed backdrop:
          `alt=""` plus `aria-hidden` on the wrapper. The panel's own
          heading carries the meaning, and the axe scan is scoped to `[role="dialog"]` anyway.

          `sizes` deliberately matches the cover's rather than saying `100vw`: the landing has
          already fetched that derivative by the time any CTA can be pressed, so the second view
          re-uses the bytes in cache instead of asking the network for a wider variant of a
          picture that is about to sit under a .72 scrim. No `priority`: the LCP image of this
          door is the cover on the first view, and this mounts on a click. */}
      {view === 'auth' && (
        <div
          className="door-wall photo-header__media"
          data-country="np"
          data-testid="door-wall-photo"
          aria-hidden="true"
        >
          <span className="door-kb">
            <OptimizedImage
              src="/images/featured/boudhanath.jpg"
              alt=""
              fill
              sizes="(min-width: 1120px) 1088px, 100vw"
            />
          </span>
          <span className="photo-header__duo-lo" />
          <span className="photo-header__duo-hi" />
          <span className="door-wall-scrim" />
        </div>
      )}
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: -8 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        // #25 — the two views take two radii, and the radius follows the TIER, not the panel.
        // The landing is Tier 1 and keeps the loudest container radius; the auth card is a FORM,
        // therefore Tier 3 always (D-292 puts every dialog, sheet and form there regardless of
        // which surface opens it), so it takes the instrument's calm radius.
        //
        // OFF THE RETIRED DARK-CARD RECIPE, AND THE FILL DID NOT MOVE. That recipe was
        // surface-2 + --border + an elevated shadow, and surface-2 is the fill
        // scripts/contrast-tokens.mjs pins as "the auth panel" — every pairing measured against
        // it is unchanged. What goes is the SHADOW: there are no card shadows in this
        // direction, the hairline IS the edge. (The class name is left unwritten on purpose: a
        // deletion note that spells it reads as a live consumer to the next grep.)
        //
        // The colour of that hairline is NOT decided here on the auth view. globals.css's
        // unlayered `.wall-auth-open [role='dialog']` is (0,2,0) and steps border-color to
        // --border-ui, because over the cover --border measures 1.04:1 and disappears in the
        // photograph's highlights (D-332). So this utility supplies the width and the LANDING's
        // colour, and the wall rule wins on the one view that floats on a picture.
        //
        // KNOWN CEILING: the landing keeps `rounded-3xl` rather than an instrument radius,
        // because `.door-cover` hard-codes the matching `var(--radius-2xl)` top corners and the
        // cover bleeds to this panel's edge. The two have to move in one edit, in globals.css.
        className={`relative w-full border-hair border-[color:hsl(var(--border))] bg-surface-raised p-6 sm:p-8 my-auto ${
          view === 'landing' ? 'max-w-5xl rounded-3xl' : 'max-w-md rounded-r2'
        }`}
      >
        {view === 'landing' ? (
          <LandingPage
            titleId={titleId}
            descId={descId}
            // See `invite` above for why the wall hands this to the view instead of rendering it
            // as a sibling. Nothing focusable goes in here: it renders above the log-in CTA, which
            // must stay the first enabled button in the panel.
            notice={invite}
            onCreate={() => {
              setMode('create');
              setView('auth');
            }}
            onLogin={() => {
              setMode('login');
              setView('auth');
            }}
            // (#70) "Someone shared a trip with me" is the CREATE path. It names an audience
            // holding a TRIP TOKEN, and the login field takes a USER TOKEN (D-239, never mixed) —
            // so it used to ask that visitor for a credential they cannot have: D-296's probe
            // rejects an invented key, and a dormant/offline build admits them into a
            // working-but-empty account instead. Path (b) ends on `/trips/`, the one surface that
            // accepts a Trip Token, and the landing's note under the CTA says so before the click.
            // Log in stays one tap away (the mode toggle below, and the CTA above it).
            //
            // 🔴 WHAT THIS REPLACED, recorded because it was a measured landmine and the fix
            // deliberately walked into it: this used to be the ONE CTA that set no mode, so that
            // the `mode` initializer above stayed observable and A1 in
            // `lib/__tests__/s345-front-door.test.ts` could pin it. Now every CTA names its mode,
            // the initializer is unobservable (see its own comment), and A1 was RE-POINTED in this
            // same change to the property it can still falsify: each CTA opens the mode its label
            // promises — including this one. Do NOT restore the inheritance to "make the default
            // observable again"; that routing IS the #70 defect, and A1 no longer covers for it.
            onJoin={() => {
              setMode('create');
              setView('auth');
            }}
          />
        ) : (
          /* ── The boarding-pass AUTH card: the wall's second view. Kept inline (NOT extracted
                into an inner component) on purpose: an inner function component is a new type on
                every parent render, which would remount the inputs on every keystroke. ── */
          <>
        {invite && <div className="mb-4">{invite}</div>}
        {/* Boarding-pass header: ticket-stub iconography + trip title. */}
        <div className="flex items-center gap-3 mb-1">
          <span
            className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-overlay text-ink-hi"
            aria-hidden="true"
          >
            <Plane className="w-6 h-6 -rotate-12" />
          </span>
          <div className="min-w-0">
            <p className="pr pr--lo">Boarding Pass</p>
            <h2
              id={titleId}
              className="font-sans text-n-sm font-semibold tracking-tight text-ink-hi leading-tight truncate"
            >
              Nepal × Japan Journey
            </h2>
          </div>
        </div>

        {/* Compact live countdown to departure. */}
        <div className="mt-4 mb-5">
          <CompactCountdown />
        </div>

        {/* Perforation line — the boarding-pass tear. Decorative, no layout box of its own. */}
        <div className="relative my-5" aria-hidden="true">
          <div className="border-t-hair border-dashed border-border" />
        </div>

        <p id={descId} className="text-t-body text-ink-mid mb-4 leading-relaxed">
          {stage === 'claim'
            ? 'First sign-in on this account. Choose your own password to replace the temporary one.'
            : loginOnly
              ? 'Accounts now use a username and password, and this device’s account already has a username. Log in with it, and your trips on this device stay with you.'
              : upgrade
                ? 'Accounts now use a username and password. Set yours up once, and your trips on this device stay with you.'
                : 'Log in with your username and password, or create an account.'}
        </p>
        {!remote && (
          <p data-testid="token-gate-local-note" className="mb-4 text-t-sm leading-relaxed text-ink-mid">
            This copy of the app has no account server, so signing in here only admits you on this
            device.
          </p>
        )}

        {/* Path switch: two plain aria-pressed buttons. The selected one is STRUCK, this system's
            mark for "committed". Hidden during the claim step, and when only log-in can work. */}
        {stage === 'form' && !loginOnly && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(['login', 'create'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setMode(opt);
                  setWallError(null);
                }}
                aria-pressed={mode === opt}
                disabled={busy}
                data-testid={`token-gate-mode-${opt}`}
                className={`chip min-h-tap justify-center whitespace-normal px-3 text-center leading-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-lo ${
                  mode === opt ? 'chip--struck bg-white/5' : 'hover:bg-white/5 hover:text-ink-hi'
                }`}
              >
                {opt === 'login'
                  ? upgrade
                    ? 'I was given a username'
                    : 'Log in'
                  : upgrade
                    ? 'Create a username and password'
                    : 'Create an account'}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={stage === 'claim' ? handleClaim : handleSubmit} noValidate>
          <div className="flex flex-col gap-3">
            {stage === 'form' && mode === 'create' && !upgrade && (
              <TextField
                {...fieldProps('name')}
                inputRef={firstFieldRef}
                label="Your name"
                icon={User}
                value={name}
                onChange={setName}
                maxLength={24}
                autoComplete="name"
                autoCapitalize="words"
                testId="token-gate-name"
              />
            )}
            {stage === 'form' && (
              <>
                <TextField
                  {...fieldProps('username')}
                  inputRef={mode === 'login' || upgrade ? firstFieldRef : undefined}
                  label="Username"
                  icon={AtSign}
                  value={username}
                  onChange={setUsername}
                  maxLength={20}
                  autoComplete="username"
                  autoCapitalize="none"
                  testId="token-gate-username"
                  readOnly={busy || (mode === 'create' && pendingCreate !== null)}
                />
                <PasswordField
                  {...fieldProps('password')}
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  testId="token-gate-password"
                />
              </>
            )}
            {stage === 'claim' && (
              <>
                <PasswordField
                  {...fieldProps('newPassword')}
                  inputRef={firstFieldRef}
                  label="New password"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  testId="token-gate-new-password"
                />
                <PasswordField
                  {...fieldProps('confirmPassword')}
                  label="New password, again"
                  noun="password confirmation"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  testId="token-gate-confirm-password"
                />
                {startFresh ? (
                  <p data-testid="token-gate-claim-fresh" className="text-t-sm leading-relaxed text-ink-mid">
                    Starting a fresh account for this username.
                  </p>
                ) : savedCode ? (
                  <p data-testid="token-gate-claim-device" className="text-t-sm leading-relaxed text-ink-mid">
                    The trips on this device come with you.
                  </p>
                ) : (
                  <TextField
                    {...fieldProps('oldKey')}
                    label="Your old key (optional)"
                    hint="Paste the key you logged in with before, so your trips come with you. Leave it empty to start a fresh account."
                    icon={KeyRound}
                    value={oldKey}
                    onChange={setOldKey}
                    autoComplete="off"
                    autoCapitalize="none"
                    machine
                    testId="token-gate-old-key"
                  />
                )}
              </>
            )}
          </div>

          {/* The wall's ONE failure slot, a polite live region that is always mounted so an
              inserted message is announced. --coral is the palette's warning accent and the pair
              contrast-tokens.mjs measures on this panel; colour is never the only cue. */}
          <div aria-live="polite">
            {wallError && (
              <div className="mt-3 border-hair border-[color:var(--coral)] rounded-r1 px-gut py-2">
                <p className="pr text-[color:var(--coral)]">{wallError.label}</p>
                <p
                  id={errorId}
                  data-testid="token-gate-error"
                  className="mt-1 text-t-sm leading-relaxed text-[color:var(--coral)]"
                >
                  {wallError.text}
                </p>
              </div>
            )}
          </div>
          {/* The carried-over id belongs to another username, so resubmitting can never succeed. */}
          {stage === 'claim' && wallError === ALREADY_CLAIMED && (
            <button
              type="button"
              onClick={() => {
                setStartFresh(true);
                setWallError(null);
                document.getElementById(fieldId('newPassword'))?.focus();
              }}
              disabled={busy}
              data-testid="token-gate-start-fresh"
              className="btn btn--2 mt-3 w-full px-4"
            >
              Start fresh
            </button>
          )}

          {inviteStuck && (
            <>
              {inviteToken && (
                <button
                  ref={inviteActionRef}
                  type="button"
                  onClick={() => {
                    setBusy(true);
                    setWallError(null);
                    void finish();
                  }}
                  disabled={busy}
                  data-testid="token-gate-invite-retry"
                  className="btn mt-3 w-full px-4"
                >
                  Try again
                </button>
              )}
              <button
                ref={inviteToken ? undefined : inviteActionRef}
                type="button"
                onClick={() => window.location.replace(withBasePath('/trips/'))}
                disabled={busy}
                data-testid="token-gate-invite-continue"
                className="btn btn--2 mt-3 w-full px-4"
              >
                Continue without joining
              </button>
            </>
          )}

          <button
            type="submit"
            disabled={busy || inviteStuck}
            aria-busy={busy}
            data-testid="token-gate-submit"
            className="btn mt-3 w-full px-4"
          >
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
            {stage === 'claim' ? 'Save password and continue' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>

          {stage === 'form' && (
            <p className="mt-3 text-t-sm leading-relaxed text-ink-lo">
              {mode === 'login'
                ? loginOnly
                  ? 'Use the username and password already set up for this account.'
                  : upgrade
                  ? 'Use the username and temporary password you were given.'
                  : 'A Trip Token is not a login: add one from your Trips page after you log in.'
                : `Usernames are 3 to 20 lowercase letters, numbers or underscores. Passwords need at least ${MIN_PASSWORD_LENGTH} characters.${upgrade ? '' : ' Trips come next, on your Trips page.'}`}
            </p>
          )}
        </form>

        {/* Not "skip forever": this asks again on the next app load. */}
        {upgrade && onLater && stage === 'form' && (
          <button
            type="button"
            onClick={onLater}
            disabled={busy}
            data-testid="token-gate-later"
            className="btn btn--2 mt-3 w-full px-4"
          >
            Later
          </button>
        )}
          </>
        )}
      </m.div>
    </m.div>
  );
}

type FieldBase = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  testId: string;
  readOnly: boolean;
  invalid: boolean;
  errorId?: string;
  inputRef?: React.Ref<HTMLInputElement>;
};

// The ruled field recipe: --border-ui is the edge of an INTERACTIVE control (WCAG 1.4.11's 3:1),
// on the recessed surface-3 fill that contrast-tokens.mjs measures against this panel.
const INPUT_CLASS =
  'w-full min-h-tap pl-9 py-2.5 rounded-r1 bg-surface-overlay border-hair border-[color:var(--border-ui)] text-ink-hi text-t-body placeholder:text-ink-lo focus:outline-none focus:ring-2 focus:ring-ring focus-visible:ring-2 aria-[invalid=true]:border-[color:var(--coral)]';

// Module-level on purpose: a component declared inside the wall is a new type every render and
// would remount the input on every keystroke.
function TextField({
  id,
  label,
  hint,
  icon: Icon,
  value,
  onChange,
  autoComplete,
  autoCapitalize,
  maxLength,
  machine,
  testId,
  readOnly,
  invalid,
  errorId,
  inputRef,
}: FieldBase & {
  hint?: string;
  icon: typeof User;
  autoCapitalize: string;
  maxLength?: number;
  machine?: boolean;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="pr pr--lo mb-1.5 block">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-1.5 text-t-sm leading-relaxed text-ink-mid">
          {hint}
        </p>
      )}
      <div className="relative">
        <Icon
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-lo"
          aria-hidden="true"
        />
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          spellCheck={false}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          data-testid={testId}
          className={`${INPUT_CLASS} pr-3 ${machine ? 'font-machine' : ''}`}
        />
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  testId,
  readOnly,
  invalid,
  errorId,
  inputRef,
  noun,
}: FieldBase & { /** What the show toggle names, when the label is too long for it. */ noun?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="pr pr--lo mb-1.5 block">
        {label}
      </label>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-lo"
          aria-hidden="true"
        />
        <input
          id={id}
          ref={inputRef}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={errorId}
          data-testid={testId}
          className={`${INPUT_CLASS} pr-12`}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={`Show ${noun ?? label.toLowerCase()}`}
          aria-controls={id}
          data-testid={`${testId}-toggle`}
          className="absolute right-0 top-0 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 text-ink-mid hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown ? (
            <EyeOff className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Eye className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Compact live countdown for the boarding pass. Ticks once a second so HH:MM:SS stays truthful; the
 * math is the shared pure helper vs TRIP_START, read off the app's one clock (`getNow()`, D-075), so
 * `?today=` drives it like every other countdown. Mount-gated so SSR and first client paint
 * agree (no hydration mismatch — value starts null).
 */
function CompactCountdown() {
  const [cd, setCd] = useState<Countdown | null>(null);

  useEffect(() => {
    const tick = () => setCd(computeCountdown(TRIP_START, getNow()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Reserve height before hydration so the card doesn't jump (no layout shift / overflow).
  if (!cd) return <div className="h-[58px]" aria-hidden="true" />;

  if (cd.isPast) {
    return (
      <p className="text-t-body text-ink-hi text-center" role="status">
        The journey has begun.
      </p>
    );
  }

  // A calendar unit that is zero is not shown (issue #11). The producer carries maximally
  // and reports every unit, and skipping the zeros is this surface's job. Hr/Min/Sec always
  // show: they tick, so a 00 corrects itself, and dropping one would reflow the row every
  // minute. So the row holds 3 to 6 cells and the grid is sized to whatever is left.
  const units: { label: string; value: number }[] = [
    { label: 'Mo', value: cd.months },
    { label: 'Wk', value: cd.weeks },
    { label: 'Day', value: cd.days },
  ]
    .filter((u) => u.value > 0)
    .concat([
      { label: 'Hr', value: cd.hours },
      { label: 'Min', value: cd.minutes },
      { label: 'Sec', value: cd.seconds },
    ]);

  // The aria-label must read the same numbers the grid shows. `cd.totalDays` is a flat day
  // count that no longer reconciles with the calendar-accurate months/weeks/days breakdown
  // (D-313) and has no on-screen text anywhere in this component (unlike hero-section.tsx's
  // ring, which prints its own digit next to this one) -- so a screen reader must be built
  // from the same `units` array the grid renders, not totalDays.
  const unitsLabel = units.map((u) => `${u.value} ${u.label}`).join(', ');

  return (
    <div role="status" aria-label={`Departure in ${unitsLabel}`}>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${units.length}, minmax(0, 1fr))` }}
      >
        {units.map((u) => (
          // Material and type only — the cell count and the units array above are untouched.
          // `.num` is the machine face at 600 with tabular figures; `font-bold` is dropped
          // rather than restated, because no 700 of that face is loaded to render it.
          <div
            key={u.label}
            className="flex flex-col items-center rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low py-1.5"
          >
            <span className="num text-t-lead sm:text-n-sm text-ink-hi leading-none">
              {String(u.value).padStart(2, '0')}
            </span>
            {/* `leading-tight` is the height reserve above, not taste: `.pr` sets no
                line-height, and inheriting 1.5 pushes the cell past `h-[58px]` under the
                outdoor root bump — a pre-hydration jump in exactly one mode. */}
            <span className="pr pr--lo mt-0.5 leading-tight">{u.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
