/**
 * Live member-roster inspection, BEFORE firestore.rules is ever published (issue #263).
 *
 * READ-ONLY. This script issues nothing but GETs against the Firestore REST API. It never
 * writes, never deletes, and never repairs anything it finds. Its whole job is to answer one
 * question the owner has to answer before arming `FIREBASE_SERVICE_ACCOUNT`:
 *
 *     if the repo's firestore.rules were published to the live project right now,
 *     would anyone lose access to a trip they are actually using?
 *
 *   RUN IT — from the repo root, with a service-account key for the live project:
 *
 *     node scripts/roster-inspect.mjs /path/to/service-account.json
 *     node scripts/roster-inspect.mjs --self-test        # no network, no credential
 *
 * The key path may also come from GOOGLE_APPLICATION_CREDENTIALS. Exit 0 = nothing found that
 * publishing would break; exit 1 = at least one trip where publishing can lock someone out (or
 * the run was inconclusive). The exit code is the signal — the per-trip lines are the evidence.
 *
 * WHY THIS EXISTS AT ALL. `firestore.rules` in this repo has never been published: the
 * `FIREBASE_SERVICE_ACCOUNT` secret does not exist, so `publish-rules` in
 * .github/workflows/deploy.yml takes its no-credential branch every release and the live ruleset
 * is still whatever was last deployed by hand. Publishing is blocked on the precondition recorded
 * at .github/workflows/deploy.yml:212-216: the client has been writing member rosters into
 * Firestore under the OLD permissive rules since 2026-08-10, and publishing the members-gated
 * ruleset before those rosters are inspected can permanently lock out a traveller whose device
 * has not opened the app since — after the publish, only an existing member can add anyone back,
 * and there is no self-service route. There is no undo. This script is that inspection.
 *
 * WHY ADMIN CREDENTIALS, AND WHY REST BY HAND. The rules grant `list` on the `trips` collection
 * to nobody, here or anywhere below (D-219), so a client SDK physically cannot enumerate trips —
 * only a credential that bypasses rules can. And there is deliberately no root package.json, so
 * nothing can be installed for a root script: no firebase-admin, no google-auth-library, no
 * anything. Hence the ~40 lines below that sign an RS256 JWT with node:crypto, exchange it for an
 * access token, and call the REST API with fetch. That is the entire cost of the no-dependency
 * rule here, and it is cheaper than it looks.
 *
 * ── THE FIVE BUCKETS, AND WHY THEY ARE THESE FIVE ──────────────────────────────────────────────
 *
 * Everything below is derived from ONE function in firestore.rules, and it is worth quoting
 * because the classification is meaningless without it (firestore.rules:176-178):
 *
 *     function isOpen() {
 *       return !exists(tripPath()) || !('members' in get(tripPath()).data);
 *     }
 *
 * Read that carefully. It tests KEY PRESENCE and nothing else. It does not test that `members` is
 * a map, and it does not test that the map is non-empty. Everything else in the rules hangs off
 * it: `isMember()` is `isOpen() || role() in ['owner','member']`, and `role()` is
 * `...data.members.get(request.auth.uid, '')`. So:
 *
 * EFFECTIVE, NOT LISTED. Everything below counts the entries whose VALUE is exactly 'owner' or
 * 'member', because that is the only thing `isMember()` honours (firestore.rules:187):
 *
 *     return request.auth != null && (isOpen() || role() in ['owner', 'member']);
 *
 * A uid mapped to 'viewer' — a role named in the header at firestore.rules:42 and never built —
 * or to 'Owner', or to '', is LISTED but names nobody: `role()` returns a string that is in
 * neither arm, so that uid is refused exactly like a stranger. Counting listed keys instead would
 * make an all-'viewer' roster look like a populated one. It is not; it is a lockout, and no rule
 * anywhere polices the value (firestore.rules:46-55 records that ceiling as accepted), so this
 * is a shape the live data can genuinely hold.
 *
 *   OPEN         no trip doc at all, or a trip doc with NO `members` key. `isOpen()` is true, so
 *                `isMember()` is true for anyone signed in who holds the trip id — the
 *                grandfathered capability model, unchanged. Publishing changes NOTHING here.
 *                This is expected to be the common case and it is entirely benign.
 *
 *   GATED_OK     an effective roster, with an owner, at least as large as the set of distinct
 *                human names observed in the trip. Publishing narrows this trip to its roster,
 *                and the roster looks big enough to hold everyone.
 *
 *   NO_OWNER     an effective roster with NO value equal to 'owner'. Every effective uid still
 *                reads and writes (`role()` returns 'member' for them, which `isMember()`
 *                honours), but `isOwner()` is false for everyone forever, so nobody can remove a
 *                member, change a role, or delete the trip, and the doc is stuck at member
 *                add-only edits. Something wrote a roster shape the create path cannot produce
 *                (`claimsSelfAsOwner()` refuses it), so it is worth an eyeball.
 *
 *   AT_RISK      an effective roster, but MORE distinct human names were observed in the trip's
 *                own data than the roster has EFFECTIVE entries. This is the bucket the whole
 *                script exists for: publishing can lock one of those people out. Heuristic — see
 *                the ceiling.
 *
 *   LOCKOUT_ALL  a `members` key that is present but names NOBODY the rules would honour: empty
 *                (`{}`), not a map at all, or every entry holding a value outside
 *                {'owner','member'}. `isOpen()` is FALSE (the key is present), and `role()` then
 *                returns a non-matching string for every uid, or errors on a non-map — either way
 *                `isMember()` is false for EVERYONE. Publishing bricks the trip for every human
 *                including its creator, with no route back. This is the most severe bucket and
 *                the one easiest to misread as harmless, because "empty roster" sounds like "no
 *                roster" and "two viewers" sounds like two people. An absent key is open; a
 *                present key that matches nobody is closed to all.
 *
 * A trip lands in exactly one bucket, by severity: LOCKOUT_ALL > AT_RISK > NO_OWNER > GATED_OK >
 * OPEN. The no-owner condition is also reported as a separate flag on the line, so a trip that is
 * both owner-less and at risk does not lose half its diagnosis to the bucket it sorted into.
 *
 * ── WHERE THE "OBSERVED NAMES" COME FROM ───────────────────────────────────────────────────────
 *
 * NOT from presence alone, and NOT from a uid join. Four sources, unioned and de-duplicated
 * case-insensitively (first-seen casing wins, matching the collapse in lib/token-auth.ts:148):
 *
 *   trips/{id}/presence/*    `name` — a live heartbeat's display name. WEAK evidence on its own:
 *                            presence docs are deleted on clean teardown (lib/presence.ts:273),
 *                            so their absence proves nothing whatsoever.
 *   trips/{id}/days/*        `createdBy` / `updatedBy` / `doneBy` on each item in `items[]`. This
 *                            is the DURABLE signal: attribution is preserved across sync, never
 *                            re-stamped on ingest, and never cleaned up with a session.
 *   trips/{id}/expenses/*    `paidBy`, `createdBy`, and every entry in `split[]` — the same
 *                            display-name namespace, equally durable.
 *   trips/{id}/docs/checklist  `updatedBy` on each checklist row (core/docs/model.ts:37). Someone
 *                            whose only durable trace is a ticked row is invisible without this,
 *                            and the trip then looks safer than it is — the same omission
 *                            lib/author-filter.ts:79 was already bitten by.
 *
 * KNOWN CEILING: AT_RISK IS A HEURISTIC, NOT A PROOF, AND IT CANNOT BE MADE INTO ONE.
 * The count comparison is the whole test, because the two sides cannot be joined. A roster names
 * uids; the observed names are display strings; nothing links them. The obvious-looking join is a
 * trap that was already checked and does not exist: presence doc ids are NOT uids. lib/presence.ts
 * writes `presence/{deviceStore.getId()}`, and that id is a locally-minted crypto.randomUUID()
 * kept in localStorage (core/storage/gateway.ts:1347) — a different id space entirely. (The
 * comments at lib/presence.ts:5 and :54 that say `presence/{uid}` and "the traveler's anon uid
 * (doc id)" are stale and wrong; do not build on them.) Attribution names are display nicknames
 * from a separate, firebase-free pipeline and are never uids either.
 *
 * So the count drifts in BOTH directions, and the owner needs both:
 *   - it UNDER-reports when one human holds two uids (the uid is DEVICE identity, not account
 *     identity — lib/firebase-remote.ts:18; two devices, or one cleared browser store, means two
 *     roster entries for one person), or when two people share a display name. A big enough
 *     roster hides a missing traveller. GATED_OK is therefore not a clean bill of health.
 *   - it OVER-reports when one human's old name lingers in attribution after a rename (renaming
 *     rewrites no createdBy/updatedBy — lib/token-auth.ts:199), or when a traveller who has
 *     genuinely left still owns rows.
 * It is TUNED to over-report: every name-bearing field from all three collections is unioned in
 * and nothing is ever subtracted. That is the correct bias when the failure being screened for is
 * unrecoverable — a false AT_RISK costs a conversation, a false all-clear costs someone their
 * trip. Upgrade path: none available client-side. A real proof needs the roster to carry the
 * display name alongside the role at write time, which is a data-model change, not a script.
 *
 * One more reason the count is soft in the safe direction: `ensureMembership`
 * (lib/trips-remote.ts:327) self-enrols the current device on every trip load
 * (components/itinerary-provider.tsx:308), and under the CURRENT permissive live rules that write
 * succeeds for anyone. Rosters have therefore been self-healing since 2026-08-10. The real
 * exposure is exactly the set of devices that have NOT opened the app since then, which is why
 * the durable attribution sources matter far more here than the live presence ones.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────────────────────────
 * The service-account key, its private_key, and the bearer token are never printed — not on the
 * happy path, not in an error, not in a stack. The JSON parse of the key file is caught and its
 * message DISCARDED rather than reported. Measured on Node v22 a truncated key file gives `Bad
 * control character in string literal in JSON at position 68`, which echoes nothing; the 10-char
 * echo (`Unexpected token '<', "<html><hea"...`) fires for a different malformation. So this is
 * not a live leak being plugged — it is refusing to forward a message DERIVED from key bytes whose
 * format is not a stable API (V8 changed it in Node 20), for a message nobody needs.
 *
 * Trip ids of parents that have no trip
 * doc are also withheld: the `trips` collection doubles as the account path (D-239/D-296 —
 * lib/trips-remote.ts:148 writes `trips/{userToken}/profile/identity`), the userToken IS the
 * capability, and there is no reason to spray those into a terminal's scrollback. They are
 * counted, and counting is all they need: with no trip doc, `!exists(tripPath())` makes them
 * OPEN, so publishing cannot touch them.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FIRESTORE_API = 'https://firestore.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const PAGE_SIZE = 300;

// The subcollections worth reading, and nothing else. `profile` is deliberately absent: it is the
// account path keyed by userToken, not trip participation, and its `name` is an account nickname
// that would pollute the observed set with people who never touched the trip.
const NAME_SOURCES = ['presence', 'days', 'expenses', 'docs'];

// Field names that hold a HUMAN display name anywhere in this data model. `name` is safe to
// harvest blind: none of DayPlan, ItineraryItem, Expense or DocItem has a `name` field (a place is
// a `title`, a `location`, a `city`; a checklist row is a `label`), so the only `name` these four
// collections can yield is a presence heartbeat's.
const NAME_FIELDS = new Set(['name', 'createdBy', 'updatedBy', 'doneBy', 'paidBy']);

const BUCKETS = {
  OPEN: 'no members map — publishing changes nothing for these',
  GATED_OK: 'effective roster is at least as large as the names observed in the trip',
  NO_OWNER: 'roster has no owner — reachable, but nobody can administer it',
  AT_RISK: 'MORE names observed than EFFECTIVE roster entries — someone can be locked out',
  LOCKOUT_ALL: 'members key present but matches nobody — publishing locks out EVERYONE',
};
const SEVERE = ['AT_RISK', 'LOCKOUT_ALL'];

// ── Firestore REST typed values ────────────────────────────────────────────────────────────────

/** One typed value (`{stringValue:...}`, `{mapValue:{fields:{...}}}`, …) → a plain JS value. */
function decode(v) {
  if (v === null || typeof v !== 'object') return undefined;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue); // REST sends int64 as a string
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue; // RFC3339 string, never parsed here
  if ('bytesValue' in v) return v.bytesValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  return undefined; // an unknown/future value type decodes to undefined rather than throwing
}

/** A `fields` object (or a mapValue's) → a plain JS object. Absent/empty → `{}`. */
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decode(v);
  return out;
}

// ── name harvesting ────────────────────────────────────────────────────────────────────────────

/** Add one raw name to the deduped map. Trimmed, keyed lowercase, first-seen casing wins. */
function addName(into, raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return;
  const key = name.toLowerCase();
  if (!into.has(key)) into.set(key, name);
}

/**
 * Walk a decoded document and collect every human name it carries into `into`.
 *
 * Recursive rather than shape-aware on purpose: items live in an array under `items`, expenses put
 * their names at the top level, and presence puts one at the top level too. A keyed walk covers
 * all three and does not need editing when a field moves.
 */
function harvestNames(node, into) {
  if (Array.isArray(node)) {
    for (const el of node) harvestNames(el, into);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      if (NAME_FIELDS.has(k)) addName(into, v);
    } else if (k === 'split' && Array.isArray(v)) {
      for (const m of v) addName(into, m); // an expense's split members are bare name strings
    } else {
      harvestNames(v, into);
    }
  }
}

// ── classification ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort one trip into exactly one bucket.
 *
 * @param doc   a Firestore REST document as returned by listDocuments (`{name, fields?,
 *              createTime?}`). With `showMissing=true` a parent that has no document of its own
 *              comes back with a `name` and nothing else — no `createTime` is how that is told
 *              apart from a real but field-less document.
 * @param names the deduped observed-name Map from harvestNames.
 */
function classifyTrip(doc, names) {
  const exists = Boolean(doc.createTime);
  const observed = [...names.values()];
  const base = {
    exists, observed, rosterSize: 0, effectiveSize: 0, roles: {}, noOwner: false, note: '',
  };

  // `!exists(tripPath())` — the first half of isOpen(). No doc, no members key, nothing to gate.
  if (!exists) return { ...base, bucket: 'OPEN', note: 'no trip doc' };

  const membersRaw = doc.fields?.members;
  if (membersRaw === undefined) return { ...base, bucket: 'OPEN', note: 'no members key' };

  // The key IS present, so isOpen() is already false. Everything from here is gated, and the only
  // question left is whether role() can return 'owner'/'member' for anybody.
  if (!membersRaw.mapValue) {
    return { ...base, bucket: 'LOCKOUT_ALL', note: 'members is present but is not a map' };
  }
  const roster = decodeFields(membersRaw.mapValue.fields);
  const uids = Object.keys(roster);
  if (uids.length === 0) {
    return { ...base, bucket: 'LOCKOUT_ALL', note: 'members is an empty map' };
  }

  const roles = {};
  for (const uid of uids) {
    const role = String(roster[uid]);
    roles[role] = (roles[role] ?? 0) + 1;
  }
  // The entries that actually name somebody. `rosterSize` stays the LISTED count so the printout
  // shows the gap; every access question below is asked of `effective`.
  const effective = uids.filter((uid) => roster[uid] === 'owner' || roster[uid] === 'member');
  const noOwner = !uids.some((uid) => roster[uid] === 'owner');
  const full = { ...base, rosterSize: uids.length, effectiveSize: effective.length, roles, noOwner };

  if (effective.length === 0) {
    return {
      ...full,
      bucket: 'LOCKOUT_ALL',
      note: `${uids.length} entries listed, but no value is 'owner' or 'member' — role() matches`
        + ' nobody',
    };
  }
  if (observed.length > effective.length) {
    return {
      ...full,
      bucket: 'AT_RISK',
      note: `${observed.length} names vs ${effective.length} effective roster entries`
        + `${effective.length === uids.length ? '' : ` (of ${uids.length} listed)`}`,
    };
  }
  if (noOwner) return { ...full, bucket: 'NO_OWNER', note: 'no entry has the role owner' };
  return { ...full, bucket: 'GATED_OK', note: '' };
}

// ── auth: signed JWT → access token, with no dependency ────────────────────────────────────────

function die(message) {
  console.error(`\nroster-inspect: ${message}\n`);
  process.exit(1);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** fetch that reports a dead network as a sentence rather than an undici stack trace. */
async function fetchOrDie(url, init, what) {
  try {
    return await fetch(url, init);
  } catch (err) {
    return die(`could not reach ${what} (${err.cause?.code ?? err.code ?? 'network error'}).`);
  }
}

/** JSON.parse for a response body that came back 200. A proxy or captive portal can return HTML
 *  with a 200, and an unhandled SyntaxError there reads like a bug in this script. */
function parseJson(body, what) {
  try {
    return JSON.parse(body);
  } catch {
    return die(`${what} returned HTTP 200 with a body that is not JSON.`);
  }
}

function loadKey(keyPath) {
  let text;
  try {
    text = readFileSync(keyPath, 'utf-8');
  } catch (err) {
    die(`cannot read the service-account key at ${keyPath} (${err.code ?? 'unreadable'}).\n`
      + '  Pass the path as the first argument, or set GOOGLE_APPLICATION_CREDENTIALS.');
  }
  let key;
  try {
    key = JSON.parse(text);
  } catch {
    // The parse error's own message is DISCARDED rather than forwarded. It is derived from key
    // bytes and its format is not a stable API — today's truncated-key message echoes nothing,
    // but the `Unexpected token '<', "<html><hea"...` family does echo 10 characters of input,
    // and which family fires depends on where the file was cut. The path alone is actionable.
    die(`the service-account key at ${keyPath} is not valid JSON.`);
  }
  if (!key.client_email || !key.private_key || !key.project_id) {
    die(`${keyPath} is missing client_email / private_key / project_id — is it a service-account`
      + ' key, rather than an OAuth client or an API key?');
  }
  return key;
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const aud = key.token_uri || TOKEN_URI;
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud,
    iat: now,
    exp: now + 3600,
  }));

  let assertion;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    assertion = `${header}.${claims}.${signer.sign(key.private_key).toString('base64url')}`;
  } catch {
    // Message discarded for the same reason as the parse above.
    die('could not sign with this key\'s private_key — it is not a usable RSA PEM.');
  }

  const res = await fetchOrDie(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }, 'the Google token endpoint');
  const body = await res.text();
  if (!res.ok) {
    // Google's token endpoint never echoes the assertion back, so its error is safe to surface;
    // the signed JWT itself is not, and is not in scope for this message.
    let detail = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      detail = `${parsed.error ?? res.status}: ${parsed.error_description ?? 'no description'}`;
    } catch { /* non-JSON error body — the status alone is the detail */ }
    die(`token exchange failed (${detail}).\n`
      + '  Check the clock on this machine, and that the key has not been revoked.');
  }
  const token = parseJson(body, 'the token endpoint').access_token;
  if (!token) die('token exchange returned no access_token.');
  return token;
}

// ── Firestore REST reads ───────────────────────────────────────────────────────────────────────

/**
 * GET every document in one collection, following pageToken to the end.
 *
 * The only Firestore call this script makes. GET only — there is no write path in this file, and
 * `listCollectionIds` (which would discover subcollections automatically) is deliberately NOT
 * used because it is a POST, and "this script only ever issues GETs" is worth more than automatic
 * discovery of a collection set that has not changed in a year.
 */
async function listDocuments(token, projectId, collectionPath, showMissing = false) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(
      `${FIRESTORE_API}/projects/${projectId}/databases/(default)/documents/${collectionPath}`,
    );
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    if (showMissing) url.searchParams.set('showMissing', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetchOrDie(
      url,
      { headers: { authorization: `Bearer ${token}` } },
      'the Firestore REST API',
    );
    const body = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = JSON.parse(body).error?.message ?? detail;
      } catch { /* non-JSON error body */ }
      die(`reading ${collectionPath} failed (${detail}).\n`
        + `  The service account needs read access to Firestore in project ${projectId}.`);
    }
    const page = parseJson(body, `reading ${collectionPath}`);
    out.push(...(page.documents ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** The document id: the last segment of a REST resource name. */
function docId(name) {
  return name.slice(name.lastIndexOf('/') + 1);
}

/**
 * Refuse to run against a firestore.rules whose `isOpen()` no longer matches the one these buckets
 * were derived from.
 *
 * LOCKOUT_ALL exists only because the shipping `isOpen()` tests key presence alone, so an empty or
 * non-map `members` is CLOSED to everyone. A ruleset that adds `!(roster() is map)` or
 * `roster().size() == 0` to that disjunction inverts exactly those cases to OPEN — and this script
 * would then block a publish for a non-reason, and explain it with a sentence that is no longer
 * true. Stale and loud beats stale and silent: this dies rather than reporting.
 *
 * Read relative to THIS FILE, like .firebaserc, so it cannot pick up a different checkout's rules.
 */
function assertRulesMatchBuckets() {
  let rules;
  try {
    rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf-8');
  } catch {
    return die('could not read firestore.rules next to this script — run from a full checkout.');
  }
  const body = rules.match(/function isOpen\(\)\s*\{([^}]*)\}/)?.[1];
  if (!body) {
    return die('could not find isOpen() in firestore.rules. The buckets in this script are derived'
      + ' from it, so they cannot be trusted until it is found and re-read.');
  }
  const drifted = [
    ['`roster() is map`', /\bis\s+map\b/],
    ['`roster().size() == 0`', /\.size\(\)\s*==\s*0/],
  ].filter(([, re]) => re.test(body)).map(([label]) => label);
  if (drifted.length) {
    return die('firestore.rules has changed since these buckets were written: isOpen() now'
      + ` guards on ${drifted.join(' and ')}.\n`
      + '  That INVERTS the LOCKOUT_ALL bucket — under those guards an empty or non-map\n'
      + '  members map reads as OPEN, and publishing is safe for exactly the trips this run\n'
      + '  would fail over. Re-derive LOCKOUT_ALL against the new isOpen() before trusting\n'
      + '  a run.');
  }
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────

function rolesLabel(roles) {
  const entries = Object.entries(roles);
  return entries.length ? entries.map(([r, n]) => `${r}:${n}`).join(' ') : '—';
}

function line(id, r) {
  const names = r.observed.length ? r.observed.join(', ') : '(none)';
  const roster = r.rosterSize === r.effectiveSize
    ? String(r.rosterSize)
    : `${r.effectiveSize}/${r.rosterSize}`;
  return `  ${id.padEnd(38)} ${r.bucket.padEnd(12)} roster ${roster.padStart(5)}`
    + ` [${rolesLabel(r.roles)}]  observed ${String(r.observed.length).padStart(3)}: ${names}`
    + (r.note ? `  — ${r.note}` : '');
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

async function main(keyPath) {
  const key = loadKey(keyPath);

  // The project comes from .firebaserc, resolved against THIS FILE rather than cwd so the script
  // runs from anywhere. A key for a different project is a hard failure: running the inspection
  // against the wrong project and getting a clean result is the one outcome worse than not
  // running it at all.
  let configured;
  try {
    configured = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf-8'))
      .projects?.default;
  } catch {
    die('could not read .firebaserc next to this script — run it from a full checkout.');
  }
  if (!configured) die('.firebaserc has no projects.default.');
  assertRulesMatchBuckets();
  if (key.project_id !== configured) {
    die(`this key is for project "${key.project_id}", but .firebaserc says the live project is`
      + ` "${configured}". Refusing to inspect the wrong project.`);
  }

  console.log(`\nroster-inspect — project ${configured}`);
  console.log('READ-ONLY: this script issues GETs only, and writes nothing.\n');

  const token = await getAccessToken(key);
  const trips = await listDocuments(token, configured, 'trips', true);

  const results = [];
  let docless = 0;
  for (const doc of trips) {
    // A parent with no trip doc of its own is OPEN whatever sits under it (`!exists(tripPath())`
    // is the first arm of isOpen()), so its bucket is already decided — skip the subcollection
    // reads rather than spending NAME_SOURCES.length round trips to reach a foregone conclusion.
    if (!doc.createTime) {
      docless += 1;
      continue;
    }
    const id = docId(doc.name);
    const names = new Map();
    for (const sub of NAME_SOURCES) {
      const docs = await listDocuments(token, configured, `trips/${encodeURIComponent(id)}/${sub}`);
      for (const d of docs) harvestNames(decodeFields(d.fields), names);
    }
    results.push([id, classifyTrip(doc, names)]);
  }

  for (const [id, r] of results) {
    if (!SEVERE.includes(r.bucket)) console.log(line(id, r));
  }

  const tally = Object.fromEntries(Object.keys(BUCKETS).map((b) => [b, 0]));
  for (const [, r] of results) tally[r.bucket] += 1;
  tally.OPEN += docless;

  console.log('\n────────────────────────────────────────────────────────────────────────────');
  for (const [bucket, blurb] of Object.entries(BUCKETS)) {
    console.log(`  ${bucket.padEnd(13)} ${String(tally[bucket]).padStart(4)}   ${blurb}`);
  }
  console.log(`  ${'(no trip doc)'.padEnd(13)} ${String(docless).padStart(4)}   counted in OPEN;`
    + ' ids withheld (the trips collection doubles as the account path)');
  console.log(`  ${'trips seen'.padEnd(13)} ${String(trips.length).padStart(4)}`);
  console.log('────────────────────────────────────────────────────────────────────────────');

  const noOwnerAlso = results.filter(([, r]) => r.noOwner && r.bucket !== 'NO_OWNER').length;
  if (noOwnerAlso) {
    console.log(`  note: ${noOwnerAlso} further trip(s) also have no owner in the roster, and`
      + ' sorted into a more severe bucket above.');
  }

  if (trips.length === 0) {
    console.log('\nINCONCLUSIVE: the trips collection came back empty. That is not an all-clear —');
    console.log('it means this run proved nothing. Check the project and the key\'s access.\n');
    process.exit(1);
  }

  const severe = results.filter(([, r]) => SEVERE.includes(r.bucket));
  if (severe.length === 0) {
    console.log('\nNo trip would lose a traveller if firestore.rules were published now.');
    console.log('NOT a proof: GATED_OK compares a count of display names against a count of');
    console.log('device uids, and one person with two devices fills two roster slots. Sanity-check');
    console.log('each roster size against the humans you expect on that trip before arming the');
    console.log('secret.\n');
    process.exit(0);
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log(`  ${severe.length} TRIP(S) WHERE PUBLISHING firestore.rules CAN LOCK SOMEONE OUT`);
  console.log(`${'='.repeat(76)}`);
  for (const [id, r] of severe) {
    console.log(`\n  ${id}   ${r.bucket}`);
    console.log(`    roster       ${r.rosterSize} listed, ${r.effectiveSize} effective`
      + `  [${rolesLabel(r.roles)}]${r.noOwner && r.rosterSize ? '  (and no owner)' : ''}`);
    console.log(`    observed     ${r.observed.length} distinct names: `
      + `${r.observed.join(', ') || '(none)'}`);
    console.log(`    why          ${r.note}`);
    console.log(r.bucket === 'LOCKOUT_ALL'
      ? '    effect       isOpen() is false and role() matches nobody: EVERY human loses access.'
      : '    effect       a device not in the roster loses access, and only a member can add it'
        + ' back.');
  }
  console.log('\n  Do not arm FIREBASE_SERVICE_ACCOUNT until each of these is resolved — after the');
  console.log('  publish there is no self-service route back in, and no rollback.\n');
  process.exit(1);
}

// ── self-test: classification + decoding, against inline fixtures. No network, no credential. ──

function selfTest() {
  // The decoder, one case per branch that this script actually depends on.
  assert.equal(decode({ stringValue: 'Ana' }), 'Ana');
  assert.equal(decode({ integerValue: '42' }), 42, 'REST sends int64 as a string');
  assert.equal(decode({ doubleValue: 1.5 }), 1.5);
  assert.equal(decode({ booleanValue: true }), true);
  assert.equal(decode({ nullValue: null }), null);
  assert.equal(decode({ timestampValue: '2026-08-10T00:00:00Z' }), '2026-08-10T00:00:00Z');
  assert.deepEqual(decode({ arrayValue: {} }), [], 'an empty array has no values key');
  assert.deepEqual(decode({ arrayValue: { values: [{ stringValue: 'a' }] } }), ['a']);
  assert.deepEqual(decode({ mapValue: {} }), {}, 'an empty map has no fields key');
  assert.deepEqual(
    decode({ mapValue: { fields: { items: { arrayValue: { values: [
      { mapValue: { fields: { title: { stringValue: 'Fushimi Inari' } } } },
    ] } } } } }),
    { items: [{ title: 'Fushimi Inari' }] },
    'nested array-of-maps, the real days/{date} shape',
  );
  assert.equal(decode({ someFutureValue: 1 }), undefined, 'unknown types decode, not throw');

  // Name harvesting from each of the three real document shapes.
  const names = new Map();
  harvestNames({ name: 'Ana', lastSeen: '2026-08-10T00:00:00Z' }, names); // presence
  harvestNames({ date: '2026-12-01', city: 'Kyoto', items: [ // days
    { title: 'Fushimi Inari', createdBy: 'Ben', updatedBy: 'Ana' },
    { title: 'Nishiki', doneBy: 'Cara' },
  ] }, names);
  harvestNames({ amount: 900, paidBy: 'Ben', split: ['Ana', 'Dai'], createdBy: 'Ben' }, names);
  // docs/checklist: a traveller whose only durable trace is a ticked row must still be seen.
  harvestNames({ items: [{ label: 'Passport', checked: true, updatedBy: 'Eve' }] }, names);
  assert.deepEqual([...names.values()], ['Ana', 'Ben', 'Cara', 'Dai', 'Eve']);

  // De-dupe is case-insensitive and first-seen casing wins; blanks never count as a person.
  const dupes = new Map();
  harvestNames({ items: [
    { createdBy: 'Ana' }, { createdBy: 'ana' }, { updatedBy: ' ANA ' },
    { createdBy: '' }, { createdBy: '   ' },
  ] }, dupes);
  assert.deepEqual([...dupes.values()], ['Ana'], 'one human, four spellings, one blank');

  // Nothing that is not a name field is harvested, however name-shaped it looks.
  const noise = new Map();
  harvestNames({ city: 'Kathmandu', items: [{ title: 'Ana Cafe', location: 'Ben Street' }] }, noise);
  harvestNames({ items: [{ label: 'Cara Insurance', section: 'critical' }] }, noise); // DocItem
  assert.equal(noise.size, 0);

  // ── the buckets ──
  const nameSet = (...v) => {
    const m = new Map();
    for (const n of v) addName(m, n);
    return m;
  };
  const trip = (fields) => ({
    name: 'projects/p/databases/(default)/documents/trips/t1',
    createTime: '2026-08-01T00:00:00Z',
    ...(fields ? { fields } : {}),
  });
  const members = (roster) => ({
    members: {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(roster).map(([uid, role]) => [uid, { stringValue: role }]),
        ),
      },
    },
  });
  const bucketOf = (doc, ns) => classifyTrip(doc, ns).bucket;

  // OPEN — the grandfathered capability model. isOpen() is true, publishing changes nothing.
  assert.equal(
    bucketOf({ name: '.../trips/t1' }, nameSet('Ana', 'Ben')),
    'OPEN',
    'no trip doc at all: !exists(tripPath()) is the first half of isOpen()',
  );
  assert.equal(
    bucketOf(trip({ schemaVersion: { integerValue: '1' } }), nameSet('Ana', 'Ben')),
    'OPEN',
    'a trip doc with no members key is open however many people are on it',
  );

  // LOCKOUT_ALL — the two shapes that read as "no roster" and are in fact closed to everyone.
  assert.equal(
    bucketOf(trip({ members: { mapValue: {} } }), nameSet('Ana')),
    'LOCKOUT_ALL',
    'an EMPTY members map is present, so isOpen() is false and role() returns \'\' for all',
  );
  assert.equal(
    bucketOf(trip({ members: { stringValue: 'ana' } }), nameSet('Ana')),
    'LOCKOUT_ALL',
    'members present but not a map: role() errors on .get(), which denies',
  );
  assert.equal(
    bucketOf(trip({ members: { arrayValue: { values: [{ stringValue: 'uid-a' }] } } }), nameSet()),
    'LOCKOUT_ALL',
    'an array is not a map either',
  );
  assert.equal(
    bucketOf(trip({ members: { nullValue: null } }), nameSet()),
    'LOCKOUT_ALL',
    'an explicit null still satisfies `\'members\' in data`',
  );

  // LOCKOUT_ALL by EFFECTIVE count — the defect this section exists for. `isMember()` honours
  // only 'owner'/'member' (firestore.rules:187), so a roster of two 'viewer's lists two uids and
  // names nobody. Counting listed keys called this NO_OWNER, non-severe, exit 0 — an all-clear
  // printed over a total lockout, on the one operation with no rollback.
  const viewers = classifyTrip(trip(members({ 'uid-a': 'viewer', 'uid-b': 'viewer' })),
    nameSet('Ana'));
  assert.equal(viewers.bucket, 'LOCKOUT_ALL', 'two viewers name nobody the rules would honour');
  assert.equal(viewers.rosterSize, 2, 'the LISTED count stays visible in the printout');
  assert.equal(viewers.effectiveSize, 0);
  assert.match(viewers.note, /2 entries listed/);
  // Same for the near-misses that are not the literal strings the rules test.
  assert.equal(
    bucketOf(trip(members({ 'uid-a': 'Owner', 'uid-b': 'MEMBER' })), nameSet('Ana')),
    'LOCKOUT_ALL',
    "role() is compared to lowercase 'owner'/'member' — casing is not normalised anywhere",
  );
  assert.equal(bucketOf(trip(members({ 'uid-a': '' })), nameSet()), 'LOCKOUT_ALL',
    "'' is exactly what role() returns for a stranger");

  // A mixed roster counts only the effective half: 1 effective vs 2 names is AT_RISK, where the
  // listed count (2) would have said GATED_OK.
  const mixed = classifyTrip(trip(members({ 'uid-a': 'owner', 'uid-b': 'viewer' })),
    nameSet('Ana', 'Ben'));
  assert.equal(mixed.bucket, 'AT_RISK');
  assert.equal(mixed.rosterSize, 2);
  assert.equal(mixed.effectiveSize, 1);
  assert.equal(mixed.note, '2 names vs 1 effective roster entries (of 2 listed)');

  // NO_OWNER — gated and reachable, but nobody can administer it.
  const noOwner = classifyTrip(trip(members({ 'uid-a': 'member', 'uid-b': 'member' })),
    nameSet('Ana'));
  assert.equal(noOwner.bucket, 'NO_OWNER');
  assert.equal(noOwner.noOwner, true);
  assert.equal(noOwner.effectiveSize, 2, "'member' is effective; only 'owner' is what is missing");
  assert.deepEqual(noOwner.roles, { member: 2 });

  // GATED_OK — roster is at least as large as the observed name set.
  const ok = classifyTrip(trip(members({ 'uid-a': 'owner', 'uid-b': 'member' })),
    nameSet('Ana', 'Ben'));
  assert.equal(ok.bucket, 'GATED_OK');
  assert.equal(ok.rosterSize, 2);
  assert.deepEqual(ok.roles, { owner: 1, member: 1 });
  assert.equal(
    bucketOf(trip(members({ 'uid-a': 'owner', 'uid-b': 'member' })), nameSet('Ana')),
    'GATED_OK',
    'a roster LARGER than the name set is the two-devices-one-human case, not a risk',
  );

  // The case-fold matters to the verdict, not just to the printout: without it these are two
  // names against a one-entry roster, and the trip is wrongly reported AT_RISK.
  assert.equal(
    bucketOf(trip(members({ 'uid-a': 'owner' })), nameSet('Ana', 'ana')),
    'GATED_OK',
  );

  // AT_RISK — the whole point. More humans seen than roster slots.
  const risk = classifyTrip(trip(members({ 'uid-a': 'owner' })), nameSet('Ana', 'Ben'));
  assert.equal(risk.bucket, 'AT_RISK');
  assert.deepEqual(risk.observed, ['Ana', 'Ben']);
  assert.equal(risk.note, '2 names vs 1 effective roster entries');

  // Severity ordering: at-risk AND owner-less sorts to AT_RISK, and does not lose the other half
  // of its diagnosis — the report reads `noOwner` back off the result.
  const both = classifyTrip(trip(members({ 'uid-a': 'member' })), nameSet('Ana', 'Ben', 'Cara'));
  assert.equal(both.bucket, 'AT_RISK');
  assert.equal(both.noOwner, true);

  // Only the two severe buckets are allowed to fail the run.
  assert.deepEqual(SEVERE, ['AT_RISK', 'LOCKOUT_ALL']);
  assert.ok(Object.keys(BUCKETS).every((b) => b in BUCKETS));

  console.log('roster-inspect self-test: all assertions passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const keyPath = process.argv.slice(2).find((a) => !a.startsWith('--'))
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    die('no service-account key.\n'
      + '  Usage: node scripts/roster-inspect.mjs <service-account.json>\n'
      + '         (or set GOOGLE_APPLICATION_CREDENTIALS)\n'
      + '  Self-test, needing neither network nor credential:\n'
      + '         node scripts/roster-inspect.mjs --self-test');
  }
  await main(keyPath);
}
