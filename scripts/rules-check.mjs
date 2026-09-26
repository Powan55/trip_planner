/**
 * firestore.rules validation harness (S358 / D-251; membership + auth floor, issue #10).
 *
 * Validates the repo's firestore.rules against the REAL Cloud Firestore rules engine using
 * the local emulator. No credentials, no deploy, no network beyond localhost.
 *
 *   RUN IT — copy/paste this, from the repo root:
 *
 *     firebase emulators:exec --only firestore,auth --project demo-rules "node scripts/rules-check.mjs"
 *
 * Nothing else to install or configure. That command reuses the EXISTING root firebase.json
 * (which already points at firestore.rules and declares both emulator ports) and
 * `emulators:exec` exports FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST, which this
 * script reads, so a custom port in firebase.json is followed automatically. Exit code 0 =
 * all green, 1 = something is wrong with the rules.
 *
 * THE AUTH EMULATOR IS NOT OPTIONAL ANYMORE. The rules now have an auth floor
 * (`request.auth != null`), so a harness with no signed-in user can only ever prove that
 * everything is denied. Four clients are used: three separate named app instances, each
 * with its own anonymous sign-in and therefore its own uid (owner / member / stranger), plus
 * one app that NEVER signs in, which is the floor's negative case. `--only firestore` alone
 * will fail loudly in phase 0 rather than passing vacuously.
 *
 * Requires: Java (for the emulator jar) + the firebase CLI — both already used by this project.
 *
 * IF IT SAYS "Port 8080 is not open ... could not start Firestore Emulator": on Windows the
 * emulator JVM can outlive `emulators:exec` (and any pipe that truncates its output — don't run
 * this through `| head`). Kill the orphan and re-run:
 *     netstat -ano | grep ":8080 .*LISTENING"     # last column is the PID
 *     taskkill //PID <pid> //F
 *
 * WHY THE ODD IMPORT BELOW: this script adds NO dependency and there is deliberately no root
 * package.json, so the `firebase` SDK is resolved by explicit path out of the app's install at
 *     <repo root>/trip/node_modules/firebase
 * via `createRequire(<repo root>/trip/package.json)`. That is the whole trick — the file
 * lives at the root next to firestore.rules and stays INERT: it is not in any vitest include glob
 * and not in the app's tsc project, so it can never turn the app's own build or gate red.
 *
 * IT IS IN CI NOW (issue #39 / D-399). The `rules-check` job in .github/workflows/ci.yml installs
 * firebase-tools and runs the command above in the runner, on every pull request, on pushes to
 * `lax`, `uttam` and `dev` (ci.yml's push trigger lists exactly those — a push to a feature
 * branch runs nothing), and again on the push to `main` that deploys — because the release now
 * has a step that PUBLISHES firestore.rules
 * (deploy.yml's `publish-rules`), so nothing unproven may reach the live project. Still worth
 * running by hand when you change the rules: the gate tells you red or green, the phase output
 * tells you what actually moved.
 *
 * IF YOU EDIT THAT CI JOB, KEEP THE SENTINEL FILE. `emulators:exec` returns exit code 2 even when
 * the inner script exits 0 — measured twice locally, including with a trivial `node -e ''`: it
 * logs "Script exited successfully (code 0)" and then errors tearing the emulator down on SIGINT.
 * So CI runs `node scripts/rules-check.mjs && touch "$RUNNER_TEMP/rules-ok"`, discards the CLI's
 * exit code, and asserts the file. Wiring the bare command in gives a RED gate on GREEN rules.
 *
 * WHAT IT PROVES, in twelve phases:
 *   0. control      — deny-all really denies, allow-all really allows (else every PASS is noise)
 *   1. D-251        — `request.resource.size()` is Cloud STORAGE syntax; in Firestore it is a
 *                     CONSTANT 3 (the {data,id,__name__} wrapper's member count), so the
 *                     `< 1048576` "size cap" is `true` in a costume. Probed by equality.
 *   2. D-251 corollary — a request.resource-based guard applied to `write` breaks deleteDoc,
 *                     because request.resource is null on a delete ("Null value error").
 *   3. the shipped rules — D-219 split intact, all 8 real write shapes allowed, deletes allowed,
 *                     realistic-maximum payloads allowed (R5), hostile writes denied.
 *   4. NEGATIVE CONTROL — the same hostile writes with the shape guard REMOVED must all be
 *                     ALLOWED. Without this phase the suite cannot tell a working guard from
 *                     no guard.
 *   5. restored     — shape guard back on, hostile writes denied again.
 *   6. MEMBERSHIP, positive — owner creates a trip carrying a members map and can do every job;
 *                     a member has full content read+write and may ADD a third member.
 *   7. MEMBERSHIP, negative — a stranger reaches nothing, not one content doc by read, write
 *                     or delete; a member cannot remove or re-role the
 *                     owner, cannot delete the trip, and cannot create a trip owning nobody; an
 *                     UNAUTHENTICATED client reaches nothing at all (the new floor); and D-219
 *                     still holds under auth (no /trips list, no collection group). A roster
 *                     naming no owner is refused at the write, and one already stored reads
 *                     open so it can be repaired (#453).
 *   8. GRANDFATHER  — a trip with NO members map keeps capability semantics for any signed-in
 *                     holder of the tripId. This is the opt-in lock: it is what stops a rules
 *                     deploy (instant, global) bricking every legacy trip and every ?trip= link.
 *   9. THE DOOR     — profile/identity and profile/tripList keep capability semantics behind the
 *                     auth floor, so the login door's probe of an ABSENT trips/{code}/profile/identity resolves to
 *                     "missing" rather than to permission-denied (D-296: a 403 there would make
 *                     token validation silently vacuous), and meta/** is readable by a
 *                     not-yet-member joiner. Nothing else planted under profile/ is permanent.
 *  10. NEGATIVE CONTROL — the same member denials with the membership predicates REMOVED must
 *                     all be ALLOWED. Same reason as phase 4, for the other half of the file.
 *  10b. restored    — membership back on, the denials deny again.
 *  11. NEGATIVE CONTROL — the 7g self-join denials (D-593) with selfJoinsAsMember() REMOVED must
 *                     all be ALLOWED.
 *  12. users/{uid}  — the email/password account doc is owner-only get/create, fixed
 *                     {username, accountId} shape, no update, no list, no delete.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = join(ROOT, 'firestore.rules');

// No new dependency: resolve the firebase SDK out of trip/node_modules (the only
// place it is installed — there is no root package.json and this script deliberately does
// not add one).
const require = createRequire(join(ROOT, 'trip', 'package.json'));
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getFirestore, connectFirestoreEmulator, doc, collection, collectionGroup,
  setDoc, updateDoc, deleteField, getDoc, getDocs, deleteDoc, runTransaction, terminate,
} = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInAnonymously } = require('firebase/auth');

// `firebase emulators:exec` exports these; fall back to the emulator defaults.
const [HOSTNAME, PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-rules';
const HOST = `http://${HOSTNAME}:${PORT}`;
const TRIP = '11111111-2222-3333-4444-555555555555';   // phases 0-5: a members-less trip
const L = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';      // phases 6-10: the member-gated trip
const K = 'ffffffff-0000-1111-2222-333333333333';      // phase 8: a legacy, members-less trip
const ACCT = '99999999-8888-7777-6666-555555555555';   // phase 9: a User Token — never a trip
const THIRD = 'third-friend-uid-000000000000';         // a uid that is only ever a map key
const GATED_DAY = '2026-12-14';                        // one content doc under the gated trip
const BRICK = '00000000-1111-2222-3333-444444444444';  // phase 7f: a trip carrying a malformed roster

let pass = 0, fail = 0;
let results = [];

async function loadRules(content) {
  const res = await fetch(`${HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  return { ok: res.status === 200, status: res.status, body: await res.text() };
}

const wipe = () => fetch(`${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

const ALLOW_ALL = `rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if true; } } }`;
const DENY_ALL = `rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if false; } } }`;

function record(name, got, want) {
  const good = got === want;
  good ? pass++ : fail++;
  results.push(`  ${good ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${got}${good ? '' : `  (wanted ${want})`}`);
}

async function expect(name, want, fn) {
  let got;
  try {
    await Promise.race([fn(), new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT')), 15000))]);
    got = 'ALLOWED';
  } catch (e) {
    got = e?.code === 'permission-denied' ? 'DENIED' : `ERROR:${e?.code || e?.message}`;
  }
  record(name, got, want);
}

const flush = (label) => {
  console.log('\n' + results.join('\n'));
  console.log(`\n=== ${label}: ${pass} passed, ${fail} failed ===`);
  const r = { pass, fail };
  results = []; pass = 0; fail = 0;
  return r;
};

// ── clients ──────────────────────────────────────────────────────────────────
// One app instance per identity: the Auth SDK holds exactly one current user per app, so
// three uids need three apps. The fourth never calls getAuth() at all, so its Firestore
// requests carry no credential — that is the auth floor's negative case, and it cannot be
// faked by signing out (a signed-out app and a never-signed-in app differ in the SDK).
function client(name) {
  const app = name ? initializeApp({ projectId: PROJECT, apiKey: 'demo' }, name)
    : initializeApp({ projectId: PROJECT, apiKey: 'demo' });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, HOSTNAME, Number(PORT));
  return { app, db };
}

async function signIn(app) {
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  return (await signInAnonymously(auth)).user.uid;
}

const owner = client();            // the DEFAULT app — phases 0-5 all run as this uid
const memberApp = client('b');
const strangerApp = client('c');
const anonApp = client('u');       // never signs in
const db = owner.db, dbM = memberApp.db, dbS = strangerApp.db, dbU = anonApp.db;

const bigMap = (n, prefix = 'f') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, 1]));
const bigList = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, title: 't', category: 'sightseeing', rev: 1 }));
const wrap = (body) => `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trips/{tripId} {
      ${body}
    }
  }
}`;

// Derive a deliberately-broken variant FROM the file under test, by neutering ONE named
// helper. Not a frozen copy and not `git show HEAD:firestore.rules` (which stops being the
// pre-guard file the moment the guard is committed, silently turning a negative control into
// a second copy of the positive phase). It throws rather than no-oping when the helper is
// renamed: a control that quietly disarms itself is worse than no control.
function neuter(src, fnName, body, why) {
  const re = new RegExp(`function ${fnName}\\(\\)\\s*\\{[^}]*\\}`);
  if (!re.test(src)) {
    throw new Error(
      `Negative control could not neuter ${fnName}() — no such function found in firestore.rules.\n` +
      `It was renamed or restructured. Update this script, do NOT ignore this: ${why}`);
  }
  return src.replace(re, `function ${fnName}() { ${body} }`);
}

// Put a fixture document in place with the rules under test having NO say, so one phase's
// setup can never be a hostage to what the phase before it was allowed to do (phase 10
// deliberately mutates and deletes trips/L).
async function seed(path, data, rules = shipped) {
  await loadRules(ALLOW_ALL);
  await setDoc(doc(db, ...path), data);
  await loadRules(rules);
}

// Phase 10 overwrites and deletes both, so every phase running MEMBER_DENIALS rebuilds them.
async function seedGated(rules = shipped) {
  await seed(['trips', L], { schemaVersion: 1, members: { [O]: 'owner', [M]: 'member' } }, rules);
  await seed(['trips', L, 'days', GATED_DAY],
    { date: GATED_DAY, city: 'Kathmandu', country: 'nepal', items: bigList(2) }, rules);
}

console.log(`\nfirestore.rules harness — emulator ${HOST}, auth ${AUTH_HOST}, project ${PROJECT}`);
console.log(`rules under test: ${RULES}`);

const [O, M, S] = [await signIn(owner.app), await signIn(memberApp.app), await signIn(strangerApp.app)];
console.log(`uids — owner ${O}\n       member ${M}\n       stranger ${S}\n       (plus one client that never signs in)`);

// ── 0. CONTROL ───────────────────────────────────────────────────────────────
console.log('\n=== 0. CONTROL: the harness must actually observe rules ===');
await loadRules(DENY_ALL);
await expect('write under deny-all rules', 'DENIED', () => setDoc(doc(db, 'trips', TRIP), { a: 1 }));
await expect('read under deny-all rules', 'DENIED', () => getDoc(doc(db, 'trips', TRIP)));
await loadRules(ALLOW_ALL);
await expect('write under allow-all rules', 'ALLOWED', () => setDoc(doc(db, 'trips', TRIP), { a: 1 }));
await expect('signed-in client really carries a uid', 'ALLOWED', async () => {
  await loadRules(wrap(`allow get, create, update: if request.auth.uid == '${O}';`));
  await setDoc(doc(db, 'trips', TRIP), { a: 1 });
});
await expect('...and the never-signed-in client really does not', 'DENIED',
  () => setDoc(doc(dbU, 'trips', TRIP), { a: 1 }));
await wipe();

// ── 1. D-251: request.resource.size() is a constant ──────────────────────────
console.log("\n=== 1. D-251: `request.resource.size() < 1048576` is `true` in a costume ===");
{
  const r = await loadRules(wrap('allow get: if true;\n      allow create, update, delete: if request.resource.size() < 1048576;'));
  console.log(`  compiles anyway (nothing warns you): HTTP ${r.status} ${r.body.replace(/\s+/g, ' ')}`);
  record('`request.resource.size()` compiles', r.ok ? 'COMPILES' : 'COMPILE-ERROR', 'COMPILES');
  await expect('normal 3-field trip-doc write passes the "size cap"', 'ALLOWED',
    () => setDoc(doc(db, 'trips', TRIP), { schemaVersion: 1, createdAt: new Date(), seededFrom: 'sample' }));
  await expect('HOSTILE 10,000-field write ALSO passes the "size cap"', 'ALLOWED',
    () => setDoc(doc(db, 'trips', TRIP), bigMap(10000)));
}
console.log('\n  -- probing the actual value: identical for a 3-field and a 300-field doc --');
for (const n of [2, 3, 4]) {
  await loadRules(wrap(`allow create, update: if request.resource.size() == ${n};`));
  const tryWrite = async (payload) => {
    try { await setDoc(doc(db, 'trips', TRIP), payload); return 'ALLOWED'; }
    catch (e) { return e?.code === 'permission-denied' ? 'DENIED' : `ERROR:${e?.code}`; }
  };
  const small = await tryWrite({ schemaVersion: 1, createdAt: new Date(), seededFrom: 'sample' });
  const huge = await tryWrite(bigMap(300));
  console.log(`  request.resource.size() == ${n}  ->  3-field doc: ${small.padEnd(8)}  300-field doc: ${huge}`);
  if (n === 3) record('request.resource.size() is a CONSTANT 3, not a size', `${small}/${huge}`, 'ALLOWED/ALLOWED');
}
// The charitable rewrite reads the doc, but counts TOP-LEVEL KEYS — so it can never fire either.
await loadRules(wrap('allow create, update: if request.resource.data.size() < 1048576;'));
await expect('`request.resource.data.size() < 1048576` also waves 10,000 fields through', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP), bigMap(10000)));
await wipe();

// ── 2. D-251 corollary: guarding `write` breaks deleteDoc ────────────────────
console.log('\n=== 2. D-251 corollary: a request.resource guard on `write` breaks deleteDoc ===');
for (const [label, body] of Object.entries({
  'guard on `write` (incl. delete): request.resource.size()': 'allow get: if true;\n      allow write: if request.resource.size() < 1048576;',
  'guard on `write` (incl. delete): request.resource.data.size()': 'allow get: if true;\n      allow write: if request.resource.data.size() < 1048576;',
  'SHIPPED shape: delete split out, left unguarded': 'allow get, delete: if true;\n      allow create, update: if request.resource.data.size() <= 32;',
})) {
  await loadRules(ALLOW_ALL);
  await setDoc(doc(db, 'trips', 'del-target'), { schemaVersion: 1, createdAt: new Date(), seededFrom: 'sample' });
  await loadRules(wrap(body));
  await expect(label, label.startsWith('SHIPPED') ? 'ALLOWED' : 'DENIED', () => deleteDoc(doc(db, 'trips', 'del-target')));
}
await wipe();

// ── 3. THE SHIPPED RULES ─────────────────────────────────────────────────────
// Phases 3-5 run as a signed-in uid against trips/{TRIP}, which carries NO members map — so
// they exercise the grandfathered capability path, and the only thing under test is the
// SHAPE guard, exactly as before membership existed.
console.log('\n=== 3. SHIPPED firestore.rules ===');
const shipped = readFileSync(RULES, 'utf8');
{
  const r = await loadRules(shipped);
  if (!r.ok) console.log('  ' + r.body.replace(/\n/g, '\n  '));
  record('shipped rules compile', r.ok ? 'COMPILES' : 'COMPILE-ERROR', 'COMPILES');
}

console.log('\n  -- 3a. D-219 REGRESSION: the two-block split still holds --');
await expect('LIST /trips (enumerate every capability token)', 'DENIED', () => getDocs(collection(db, 'trips')));
await expect('collectionGroup("days") across all trips', 'DENIED', () => getDocs(collectionGroup(db, 'days')));
// #439: only `days` was asserted here — the expenses and presence collection listeners had no
// cross-trip enumeration check at all, positive or negative.
await expect('collectionGroup("expenses") across all trips', 'DENIED', () => getDocs(collectionGroup(db, 'expenses')));
await expect('collectionGroup("presence") across all trips', 'DENIED', () => getDocs(collectionGroup(db, 'presence')));
await expect('GET /trips/{knownId} by direct id', 'ALLOWED', () => getDoc(doc(db, 'trips', TRIP)));
await expect('LIST /trips/{knownId}/days (subcollection query)', 'ALLOWED', () => getDocs(collection(db, 'trips', TRIP, 'days')));
// The OTHER two collection listeners in the client (#450). `days` was the only one asserted, so
// a rules change that narrowed `list` on the subcollection wildcard would have been caught for
// the itinerary and missed for these two — both of which open an onSnapshot on a COLLECTION:
// expenses-remote.ts:205 and presence.ts:312. They pass today for the same reason days does,
// which is exactly why the assertion belongs here rather than being assumed.
await expect('LIST /trips/{knownId}/expenses (expenses-remote.ts:205)', 'ALLOWED', () => getDocs(collection(db, 'trips', TRIP, 'expenses')));
await expect('LIST /trips/{knownId}/presence (presence.ts:312)', 'ALLOWED', () => getDocs(collection(db, 'trips', TRIP, 'presence')));

console.log('\n  -- 3b. REAL PAYLOADS (every write call site) must be ALLOWED --');
await expect('trips/{id}                       {schemaVersion,createdAt,seededFrom}', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP), { schemaVersion: 1, createdAt: new Date(), seededFrom: 'sample' }));
await expect('trips/{id}/days/{date}           {date,city,country,items[20]}', 'ALLOWED',
  () => runTransaction(db, async (tx) => {
    tx.set(doc(db, 'trips', TRIP, 'days', '2026-12-09'), { date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items: bigList(20) });
  }));
await expect('trips/{id}/expenses/{leg}        {leg,items[400]}', 'ALLOWED',
  () => runTransaction(db, async (tx) => {
    tx.set(doc(db, 'trips', TRIP, 'expenses', 'japan'), { leg: 'japan', items: bigList(400) });
  }));
await expect('trips/{id}/budget/model          {version,fields{25}}', 'ALLOWED',
  () => runTransaction(db, async (tx) => {
    tx.set(doc(db, 'trips', TRIP, 'budget', 'model'), { version: 1, fields: bigMap(25, 'rates.') });
  }));
await expect('trips/{id}/docs/checklist        {version,items[40]}', 'ALLOWED',
  () => runTransaction(db, async (tx) => {
    tx.set(doc(db, 'trips', TRIP, 'docs', 'checklist'), { version: 1, items: bigList(40) });
  }));
await expect('trips/{id}/meta/info             {name,config{}}', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'meta', 'info'), { name: 'Nepal x Japan', config: { legs: [{ id: 'nepal', currency: 'NPR' }] } }));
await expect('trips/{id}/profile/tripList      {version,trips[50],removed[50]}', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'profile', 'tripList'), { version: 1, trips: bigList(50), removed: bigList(50) }));
await expect('trips/{id}/presence/{dev}        {name,lastSeen} setDoc(merge)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'presence', 'dev-1'), { name: 'Powan', lastSeen: new Date() }, { merge: true }));
// places/list was missing from a phase labelled "every write call site" (#450). Same
// {version, items} container as docs/checklist, written at places-remote.ts:89.
await expect('trips/{id}/places/list           {version,items[200]}', 'ALLOWED',
  () => runTransaction(db, async (tx) => {
    tx.set(doc(db, 'trips', TRIP, 'places', 'list'), { version: 1, items: bigList(200) });
  }));

console.log('\n  -- 3c. DELETES (kept out of every request.resource guard — it is null there) --');
await expect('deleteDoc days/{date}            (itinerary-remote.ts:241)', 'ALLOWED',
  () => deleteDoc(doc(db, 'trips', TRIP, 'days', '2026-12-09')));
await expect('deleteDoc presence/{deviceId}    (heartbeat teardown)', 'ALLOWED',
  () => deleteDoc(doc(db, 'trips', TRIP, 'presence', 'dev-1')));

console.log('\n  -- 3c-bis. R5: a REALISTIC MAXIMUM day / leg must still be ALLOWED --');
// A fully-planned day at realistic byte weight: every optional ItineraryItem field populated
// incl. long notes (lib/trip-data.ts:29-90). A denied write here would stall sync SILENTLY on
// the owner's real 32-day trip — worse than no guard at all.
const fatItem = (i) => ({
  id: `11111111-2222-3333-4444-${String(i).padStart(12, '0')}`,
  title: 'Senso-ji Temple + Nakamise-dori shopping street walkthrough',
  category: 'sightseeing', time: '09:30', duration: '2h 30m', startMinutes: 570, durationMinutes: 150,
  notes: 'Arrive before the tour buses. '.repeat(12),
  location: 'Asakusa, Taito City, Tokyo 111-0032, Japan',
  sourceId: 'japan-tokyo-sensoji', sourceType: 'recommendation',
  createdBy: 'Powan', updatedBy: 'Powan', updatedAt: '2026-12-19T09:30:00.000Z',
  rev: 7, hlc: '1766130600000:0003:aabbccddeeff', deleted: false,
  done: true, doneBy: 'Powan', doneAt: '2026-12-19T12:05:00.000Z',
  lat: 35.7147651, lng: 139.7966553, endDate: '2026-12-19',
});
const fatDay = (n) => ({ date: '2026-12-19', city: 'Tokyo', country: 'japan', items: Array.from({ length: n }, (_, i) => fatItem(i)) });
const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
console.log(`     (fully-populated item = ${bytes(fatItem(0))} B; 40-item day = ${bytes(fatDay(40))} B;`
  + ` 500-row leg = ${bytes(fatDay(500))} B; 1 MiB API limit = 1048576 B)`);
await expect('packed day, 40 fully-populated items (realistic max)', 'ALLOWED',
  () => runTransaction(db, async (tx) => { tx.set(doc(db, 'trips', TRIP, 'days', '2026-12-19'), fatDay(40)); }));
await expect('day of 200 items (4x the realistic max, incl. tombstones)', 'ALLOWED',
  () => runTransaction(db, async (tx) => { tx.set(doc(db, 'trips', TRIP, 'days', '2026-12-20'), fatDay(200)); }));
await expect('expense leg, 500 rows (32-day trip x 3 editors)', 'ALLOWED',
  () => runTransaction(db, async (tx) => { tx.set(doc(db, 'trips', TRIP, 'expenses', 'japan'), { leg: 'japan', items: bigList(500) }); }));
await expect('budget fields{} 113 entries (10-leg pack x 10 cats + 13)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'budget', 'model'), { version: 1, fields: bigMap(113, 'p') }));
await expect('members{} 200 entries (at the roster ceiling)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'presence', 'members-shape'), { members: bigMap(200, 'uid') }));

// The hostile set — re-run verbatim in phase 4 with the shape guard removed, and again in 5.
const HOSTILE = [
  ['10,000 top-level fields on the trip doc', () => setDoc(doc(db, 'trips', TRIP), bigMap(10000))],
  ['10,000 top-level fields on a day doc', () => setDoc(doc(db, 'trips', TRIP, 'days', 'x'), bigMap(10000))],
  ['items[] with 20,000 elements', () => setDoc(doc(db, 'trips', TRIP, 'days', 'x'), { date: 'x', items: bigList(20000) })],
  ['trips[] with 20,000 elements', () => setDoc(doc(db, 'trips', TRIP, 'profile', 'tripList'), { version: 1, trips: bigList(20000) })],
  ['removed[] with 20,000 elements', () => setDoc(doc(db, 'trips', TRIP, 'profile', 'tripList'), { version: 1, removed: bigList(20000) })],
  ['budget fields{} with 20,000 entries', () => setDoc(doc(db, 'trips', TRIP, 'budget', 'model'), { version: 1, fields: bigMap(20000) })],
  ['members{} with 20,000 entries', () => setDoc(doc(db, 'trips', TRIP, 'days', 'b5'), { date: 'b5', members: bigMap(20000, 'uid') })],
  ['entries{} with 1001 entries (one over the ceiling)', () => setDoc(doc(db, 'trips', TRIP, 'profile', 'journal_' + TRIP), { entries: bigMap(1001) })],
  ['items as a 200,000-char string (scalar in a list slot)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'x'), { date: 'x', items: 'z'.repeat(200000) })],
  ['items[5001] (one over the ceiling)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'b2'), { date: 'b2', items: bigList(5001) })],
  ['members{201} (one over the roster ceiling)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'b6'), { date: 'b6', members: bigMap(201, 'uid') })],
  ['33 top-level fields (one over the ceiling)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'b4'), bigMap(33))],
];

console.log('\n  -- 3d. HOSTILE WRITES must be DENIED (shape guard PRESENT) --');
for (const [name, fn] of HOSTILE) await expect(name, 'DENIED', fn);

console.log('\n  -- 3e. AT the ceiling must still be ALLOWED --');
await expect('items[5000]  (at the ceiling)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'days', 'b1'), { date: 'b1', items: bigList(5000) }));
await expect('32 top-level fields (at the ceiling)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'days', 'b3'), bigMap(32)));

console.log('\n  -- 3f. KNOWN HOLE (documented, NOT fixed by rules — needs App Check) --');
await expect('one field holding a 900,000-char string', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'days', 'hole'), { blob: 'z'.repeat(900000) }));
const phase3 = flush('PHASE 3 (shape guard PRESENT)');

// ── 4. NEGATIVE CONTROL ──────────────────────────────────────────────────────
console.log('\n\n=== 4. NEGATIVE CONTROL: same hostile writes, shape guard REMOVED ===');
const unguarded = neuter(shipped, 'boundedWrite', 'return true;',
  'without a working phase 4 the suite cannot distinguish a real shape guard from no guard at all.');
{
  const r = await loadRules(unguarded);
  console.log(`  guard-removed rules compile: HTTP ${r.status}`);
  console.log(`  (the same ${HOSTILE.length} assertions as 3d, still asserting DENIED — every FAIL below is the point)`);
  for (const [name, fn] of HOSTILE) await expect(name, 'DENIED', fn);
}
const phase4 = flush('PHASE 4 (shape guard REMOVED)  <-- MUST be red');

// ── 5. RESTORED ──────────────────────────────────────────────────────────────
console.log('\n\n=== 5. SHAPE GUARD RESTORED ===');
await loadRules(shipped);
for (const [name, fn] of HOSTILE) await expect(name, 'DENIED', fn);
const phase5 = flush('PHASE 5 (shape guard RESTORED)');

// ── 6. MEMBERSHIP, the positive path ─────────────────────────────────────────
console.log('\n\n=== 6. MEMBERSHIP (positive): owner and member can each do their job ===');
await wipe();
await expect('O creates trips/L carrying members{O:owner}', 'ALLOWED',
  () => setDoc(doc(db, 'trips', L), { schemaVersion: 1, createdAt: new Date(), members: { [O]: 'owner' } }));
await expect('O gets trips/L', 'ALLOWED', () => getDoc(doc(db, 'trips', L)));
await expect('O updates trips/L (a non-members field)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', L), { seededFrom: 'sample' }, { merge: true }));
await expect('O writes trips/L/days/{date}', 'ALLOWED',
  () => setDoc(doc(db, 'trips', L, 'days', '2026-12-09'), { date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items: bigList(20) }));
await expect('O lists trips/L/days (subcollection query)', 'ALLOWED', () => getDocs(collection(db, 'trips', L, 'days')));
await expect('O deletes trips/L/days/{date}', 'ALLOWED', () => deleteDoc(doc(db, 'trips', L, 'days', '2026-12-09')));
await expect('O adds M as "member"', 'ALLOWED', () => updateDoc(doc(db, 'trips', L), { [`members.${M}`]: 'member' }));
await expect('M reads trips/L', 'ALLOWED', () => getDoc(doc(dbM, 'trips', L)));
await expect('M writes trips/L/days/{date}  (full content write)', 'ALLOWED',
  () => setDoc(doc(dbM, 'trips', L, 'days', '2026-12-10'), { date: '2026-12-10', city: 'Tokyo', country: 'japan', items: bigList(3) }));
await expect('M lists trips/L/days', 'ALLOWED', () => getDocs(collection(dbM, 'trips', L, 'days')));
await expect('M deletes trips/L/days/{date}', 'ALLOWED', () => deleteDoc(doc(dbM, 'trips', L, 'days', '2026-12-10')));
await expect('M adds a third uid as "member"  (add-only is allowed)', 'ALLOWED',
  () => updateDoc(doc(dbM, 'trips', L), { [`members.${THIRD}`]: 'member' }));
await expect('O removes that third uid', 'ALLOWED',
  () => updateDoc(doc(db, 'trips', L), { [`members.${THIRD}`]: deleteField() }));
await expect('O deletes trips/L', 'ALLOWED', () => deleteDoc(doc(db, 'trips', L)));
const phase6 = flush('PHASE 6 (membership, positive)');

// ── 7. MEMBERSHIP, the negative path ─────────────────────────────────────────
// This is the control set: phase 10 re-runs them with membership neutered and every
// one of them MUST flip to ALLOWED.
let createN = 0;
const MEMBER_DENIALS = [
  ['stranger S gets trips/L', () => getDoc(doc(dbS, 'trips', L))],
  ['stranger S lists trips/L/days', () => getDocs(collection(dbS, 'trips', L, 'days'))],
  // create/update and delete are separate allow lines on the subtree wildcard; without these,
  // relaxing either one leaves every other denial here passing (#395).
  ['stranger S gets trips/L/days/{date}', () => getDoc(doc(dbS, 'trips', L, 'days', GATED_DAY))],
  ['stranger S writes trips/L/days/{date}',
    () => setDoc(doc(dbS, 'trips', L, 'days', GATED_DAY), { date: GATED_DAY, city: 'Tokyo', country: 'japan', items: bigList(2) })],
  ['stranger S deletes trips/L/days/{date}', () => deleteDoc(doc(dbS, 'trips', L, 'days', GATED_DAY))],
  // Self-adding as 'member' is allowed since D-593 (phase 7g); as 'owner' it never is.
  ['stranger S adds ITSELF to members as "owner"', () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'owner' })],
  ['member M removes the owner', () => updateDoc(doc(dbM, 'trips', L), { [`members.${O}`]: deleteField() })],
  ["member M changes the owner's role", () => updateDoc(doc(dbM, 'trips', L), { [`members.${O}`]: 'member' })],
  ['member M deletes trips/L', () => deleteDoc(doc(dbM, 'trips', L))],
  // A fresh id every call, so this is always a CREATE — never an update of what a previous
  // (deliberately permissive) phase was allowed to leave behind.
  ['create a trip with SELF as "member", not "owner"',
    () => setDoc(doc(dbS, 'trips', `not-owner-${++createN}`), { schemaVersion: 1, members: { [S]: 'member' } })],
];

// Each is denied by selfJoinsAsMember() alone: phase 11 neuters it and every one must flip.
const SELF_JOIN_DENIALS = [
  ['stranger S self-adds as "owner"', () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'owner' })],
  ['stranger S adds another uid as "member"', () => updateDoc(doc(dbS, 'trips', L), { [`members.${THIRD}`]: 'member' })],
  ['stranger S adds itself AND another uid',
    () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'member', [`members.${THIRD}`]: 'member' })],
  ['stranger S self-adds and removes member M',
    () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'member', [`members.${M}`]: deleteField() })],
  ["stranger S self-adds and changes M's role",
    () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'member', [`members.${M}`]: 'owner' })],
  ['stranger S self-adds and touches another trip-doc field',
    () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'member', seededFrom: 'x' })],
  ['member M re-adds itself as "owner"', () => updateDoc(doc(dbM, 'trips', L), { [`members.${M}`]: 'owner' })],
];

console.log('\n\n=== 7. MEMBERSHIP (negative): everyone else is out ===');
await seedGated();
console.log(`  -- 7a. the ${MEMBER_DENIALS.length} member denials (phase 10 re-runs exactly these) --`);
for (const [name, fn] of MEMBER_DENIALS) await expect(name, 'DENIED', fn);

console.log('\n  -- 7b. the auth floor: a client that never signed in reaches nothing --');
await expect('UNAUTH gets trips/L', 'DENIED', () => getDoc(doc(dbU, 'trips', L)));
await expect('UNAUTH reads trips/L/days/{date}', 'DENIED', () => getDoc(doc(dbU, 'trips', L, 'days', '2026-12-10')));
await expect('UNAUTH writes trips/L/days/{date}', 'DENIED', () => setDoc(doc(dbU, 'trips', L, 'days', 'u1'), { date: 'u1' }));
await expect('UNAUTH creates a trip of its own invention', 'DENIED', () => setDoc(doc(dbU, 'trips', 'unauth-invented'), { schemaVersion: 1 }));
await expect('UNAUTH deletes trips/L', 'DENIED', () => deleteDoc(doc(dbU, 'trips', L)));

console.log('\n  -- 7c. D-219 still holds UNDER AUTH (a uid is not a licence to enumerate) --');
await expect('authed LIST /trips (enumerate every capability token)', 'DENIED', () => getDocs(collection(db, 'trips')));
await expect('authed collectionGroup("days") across all trips', 'DENIED', () => getDocs(collectionGroup(db, 'days')));

console.log('\n  -- 7d. the roster cap binds on the trip doc, where the roster lives --');
await expect('create a trip with members{201}, self as owner (over the cap)', 'DENIED',
  () => setDoc(doc(db, 'trips', 'roster-201'), { schemaVersion: 1, members: { [O]: 'owner', ...bigMap(200, 'uid') } }));

console.log('\n  -- 7e. KNOWN CEILING (documented in firestore.rules, NOT fixable in rules) --');
// Rules can prove a members edit is add-ONLY, but cannot inspect the VALUE of an added key,
// so a member can mint an owner. Pinned here so that if it is ever closed (members as a
// subcollection), this assertion fails and the header comment gets corrected with it.
await expect('member M adds a third uid as "owner" (cannot police the value)', 'ALLOWED',
  () => updateDoc(doc(dbM, 'trips', L), { [`members.${THIRD}`]: 'owner' }));

console.log('\n  -- 7f. a roster that names no owner is refused at the write... (#453) --');
// O is the owner and each payload passes boundedWrite() (`.size()` on a string is a character
// count), so rosterIsWellFormed() is the only thing left that can refuse these.
await expect('O writes members as a STRING', 'DENIED',
  () => setDoc(doc(db, 'trips', L), { members: 'x' }, { merge: true }));
await expect('O empties the members map', 'DENIED',
  () => setDoc(doc(db, 'trips', L), { members: {} }, { merge: true }));
await expect('O rewrites the roster with nobody as owner', 'DENIED',
  () => setDoc(doc(db, 'trips', L), { schemaVersion: 1, members: { [O]: 'member', [M]: 'member' } }));

console.log('\n  -- ...and a trip that ALREADY carries one reads open, so it is repairable --');
// Planted with the rules under test having no say, because no write path produces these.
const BRICK_DAY = { date: '2026-12-15', city: 'Pokhara', country: 'nepal', items: bigList(2) };
await seed(['trips', BRICK], { schemaVersion: 1, members: 'x' });
await expect('authed reads a trip whose stored members is a STRING', 'ALLOWED', () => getDoc(doc(dbS, 'trips', BRICK)));
await expect('...writes its content', 'ALLOWED', () => setDoc(doc(dbS, 'trips', BRICK, 'days', '2026-12-15'), BRICK_DAY));
await expect('...and overwrites the roster with a valid one (the repair)', 'ALLOWED',
  () => setDoc(doc(dbS, 'trips', BRICK), { schemaVersion: 1, members: { [S]: 'owner' } }));
await seed(['trips', BRICK], { schemaVersion: 1, members: 'x' });
await expect('...or writes an owner by field path (rules still allow it; no client does it since #477)', 'ALLOWED',
  () => updateDoc(doc(dbS, 'trips', BRICK), { [`members.${S}`]: 'owner' }));
await seed(['trips', BRICK], { schemaVersion: 1, members: {} });
await expect('authed reads a trip whose stored members map is EMPTY', 'ALLOWED', () => getDoc(doc(dbS, 'trips', BRICK)));
await expect('...and can delete it (the last repair the rules can reach)', 'ALLOWED', () => deleteDoc(doc(dbS, 'trips', BRICK)));
// The residual shape: keys present, values fine at a glance, and no owner among them.
const NO_OWNER = { schemaVersion: 1, members: { [O]: 'member', [M]: 'viewer' } };
await seed(['trips', BRICK], NO_OWNER);
await expect('authed reads a trip whose roster names NO owner', 'ALLOWED', () => getDoc(doc(dbS, 'trips', BRICK)));
await expect('...writes its content', 'ALLOWED', () => setDoc(doc(dbS, 'trips', BRICK, 'days', '2026-12-15'), BRICK_DAY));
await expect('...but self-enrolling as "member" still names no owner', 'DENIED',
  () => updateDoc(doc(dbS, 'trips', BRICK), { [`members.${S}`]: 'member' }));
await expect('...writes an owner by field path (rules still allow it; no client does it since #477)', 'ALLOWED',
  () => updateDoc(doc(dbS, 'trips', BRICK), { [`members.${S}`]: 'owner' }));
await seed(['trips', BRICK], NO_OWNER);
await expect('...or overwrites the roster with a valid one (the repair)', 'ALLOWED',
  () => setDoc(doc(dbS, 'trips', BRICK), { schemaVersion: 1, members: { [S]: 'owner' } }));

console.log('\n  -- 7g. SELF-JOIN (D-593): a trip-id holder may add only itself, only as "member" --');
for (const [name, fn] of SELF_JOIN_DENIALS) {
  await seedGated();
  await expect(name, 'DENIED', fn);
}
await seed(['trips', L], { schemaVersion: 1, members: { [O]: 'owner', ...bigMap(199, 'uid') } });
await expect('stranger S self-adds as "member" to a full roster (cap 200)', 'DENIED',
  () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'member' }));
await expect('UNAUTH self-adds as "member"', 'DENIED',
  () => updateDoc(doc(dbU, 'trips', L), { 'members.unauth-uid': 'member' }));
await seedGated();
await expect('stranger S self-adds as "member"', 'ALLOWED',
  () => updateDoc(doc(dbS, 'trips', L), { [`members.${S}`]: 'member' }));
await expect('...and can now read trips/L and its content', 'ALLOWED', async () => {
  const snap = await getDoc(doc(dbS, 'trips', L));
  if (snap.data().members[S] !== 'member') throw new Error('fixture: S must be stored as member');
  await getDoc(doc(dbS, 'trips', L, 'days', GATED_DAY));
});
await seedGated();   // phase 9 relies on S being a non-member of L
const phase7 = flush('PHASE 7 (membership, negative)');

// ── 8. THE GRANDFATHER CLAUSE ────────────────────────────────────────────────
// This phase IS the opt-in lock. A rules deploy is instant and global: without this, every
// trip minted before membership existed, and every ?trip= link already pasted into a chat,
// would start returning permission-denied the moment the deploy landed.
console.log('\n\n=== 8. GRANDFATHER: a members-less trip keeps capability semantics ===');
await expect('O creates trips/K with NO members map (the legacy shape)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', K), { schemaVersion: 1, createdAt: new Date(), seededFrom: 'sample' }));
await expect('authed STRANGER gets trips/K            (holds the token)', 'ALLOWED', () => getDoc(doc(dbS, 'trips', K)));
await expect('authed STRANGER updates trips/K', 'ALLOWED', () => setDoc(doc(dbS, 'trips', K), { seededFrom: 'x' }, { merge: true }));
await expect('authed STRANGER writes trips/K/days/{date}', 'ALLOWED',
  () => setDoc(doc(dbS, 'trips', K, 'days', '2026-12-11'), { date: '2026-12-11', city: 'Osaka', country: 'japan', items: bigList(2) }));
await expect('authed STRANGER reads trips/K/days/{date}', 'ALLOWED', () => getDoc(doc(dbS, 'trips', K, 'days', '2026-12-11')));
await expect('authed STRANGER lists trips/K/days', 'ALLOWED', () => getDocs(collection(dbS, 'trips', K, 'days')));
await expect('authed STRANGER deletes trips/K/days/{date}', 'ALLOWED', () => deleteDoc(doc(dbS, 'trips', K, 'days', '2026-12-11')));
await expect('UNAUTH gets trips/K                     (the new floor bites)', 'DENIED', () => getDoc(doc(dbU, 'trips', K)));
await expect('UNAUTH writes trips/K/days/{date}', 'DENIED', () => setDoc(doc(dbU, 'trips', K, 'days', 'u2'), { date: 'u2' }));
const phase8 = flush('PHASE 8 (grandfathered capability trip)');

// ── 9. THE LOGIN DOOR + the account path ─────────────────────────────────────
// D-296: the door validates a pasted User Token with ONE server read of
// trips/{code}/profile/identity, BEFORE any membership can exist, and its tri-state ADMITS on
// 'unavailable'. So a permission-denied there would not fail loudly — it would make token
// validation silently vacuous. profile/** therefore keeps capability semantics behind the
// auth floor, and this phase is the tripwire on that.
console.log('\n\n=== 9. THE DOOR: profile/** and meta/** keep capability semantics ===');
await expect('authed get on an ABSENT trips/{acct}/profile/identity -> MISSING', 'ALLOWED', async () => {
  const snap = await getDoc(doc(db, 'trips', ACCT, 'profile', 'identity'));
  if (snap.exists()) throw new Error('fixture: the probe target must NOT exist');
});
await expect('authed creates trips/{acct}/profile/identity', 'ALLOWED',
  () => setDoc(doc(db, 'trips', ACCT, 'profile', 'identity'), { name: 'Powan', createdAt: new Date() }));
await expect('authed updates trips/{acct}/profile/tripList  (trip-list sync)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', ACCT, 'profile', 'tripList'), { version: 1, trips: bigList(3), removed: [] }));
await expect('authed get on the PRESENT identity doc -> EXISTS', 'ALLOWED', async () => {
  const snap = await getDoc(doc(db, 'trips', ACCT, 'profile', 'identity'));
  if (!snap.exists()) throw new Error('fixture: the probe target must exist by now');
});
await expect('authed deletes trips/{acct}/profile/identity -> DENIED (D-341: no client path deletes a profile doc; the door\'s identity doc must not be destroyable by a token-holder)', 'DENIED',
  () => deleteDoc(doc(db, 'trips', ACCT, 'profile', 'identity')));
await expect('UNAUTH gets trips/{acct}/profile/identity', 'DENIED',
  () => getDoc(doc(dbU, 'trips', ACCT, 'profile', 'identity')));

console.log('\n  -- 9b. the carve-outs are not shadowed by membership on a GATED trip --');
await expect('owner writes trips/L/meta/info', 'ALLOWED',
  () => setDoc(doc(db, 'trips', L, 'meta', 'info'), { name: 'Nepal x Japan', config: { legs: [{ id: 'nepal' }] } }));
await expect('authed NON-MEMBER gets trips/L/meta/info (the join preview)', 'ALLOWED',
  () => getDoc(doc(dbS, 'trips', L, 'meta', 'info')));
await expect('authed NON-MEMBER reads trips/L/profile/identity (the door)', 'ALLOWED',
  () => getDoc(doc(dbS, 'trips', L, 'profile', 'identity')));
await expect('...but the same NON-MEMBER still cannot list trips/L/days', 'DENIED',
  () => getDocs(collection(dbS, 'trips', L, 'days')));
await expect('...and still cannot list trips/L/meta', 'DENIED',
  () => getDocs(collection(dbS, 'trips', L, 'meta')));

console.log('\n  -- 9c. the carve-out is two document ids, and nothing planted under profile/ is permanent (#398) --');
await expect('authed deletes trips/{acct}/profile/tripList -> DENIED (same reason as identity)', 'DENIED',
  () => deleteDoc(doc(db, 'trips', ACCT, 'profile', 'tripList')));
await expect('stranger S creates trips/L/profile/planted   (gated trip, uncarved id)', 'DENIED',
  () => setDoc(doc(dbS, 'trips', L, 'profile', 'planted'), { junk: 1 }));
await expect('stranger S creates trips/L/profile/identity/deep/doc  (any depth)', 'DENIED',
  () => setDoc(doc(dbS, 'trips', L, 'profile', 'identity', 'deep', 'doc'), { junk: 1 }));
await expect('stranger S gets trips/L/profile/planted', 'DENIED',
  () => getDoc(doc(dbS, 'trips', L, 'profile', 'planted')));
await seed(['trips', ACCT, 'profile', 'planted'], { junk: 1 });
await expect('authed deletes a planted trips/{acct}/profile/planted', 'ALLOWED',
  () => deleteDoc(doc(db, 'trips', ACCT, 'profile', 'planted')));
await seed(['trips', ACCT, 'profile', 'identity', 'deep', 'doc'], { junk: 1 });
await expect('authed deletes a planted trips/{acct}/profile/identity/deep/doc', 'ALLOWED',
  () => deleteDoc(doc(db, 'trips', ACCT, 'profile', 'identity', 'deep', 'doc')));

// D-565: every loaded device creates a missing identity doc, create-only in a transaction. If the
// rules stop allowing this, legacy keys get locked out at the door again with nothing failing.
console.log('\n  -- 9d. the identity self-heal (D-565): any anonymous device can create a missing doc --');
const healKeys = ['a1', 'a2', 'a3', 'a4', 'a5'].map((p) => `${p}a1a1a1-0000-4000-8000-000000000529`);
const healRef = (i) => doc(dbS, 'trips', healKeys[i], 'profile', 'identity');
const heal = (i, data) => runTransaction(dbS, async (tx) => {
  if ((await tx.get(healRef(i))).exists()) throw new Error('fixture: heal target must be absent');
  tx.set(healRef(i), data);
});
await expect('anon S gets an ABSENT identity doc', 'ALLOWED', async () => {
  if ((await getDoc(healRef(0))).exists()) throw new Error('fixture: must be absent');
});
await expect('anon S creates identity {version:1}', 'ALLOWED', () => setDoc(healRef(0), { version: 1 }));
await expect("anon S creates identity {version:1,name:'X'}", 'ALLOWED', () => setDoc(healRef(1), { version: 1, name: 'X' }));
await expect('anon S heals {version:1} inside a transaction', 'ALLOWED', () => heal(2, { version: 1 }));
await expect("anon S heals {version:1,name:'X'} inside a transaction", 'ALLOWED', () => heal(3, { version: 1, name: 'X' }));
// D-565's client-side heal gate (any evidence of a real account) is app code, not a rule — the
// auth floor is the only backstop Firestore itself can enforce, so pin it here: a signed-out
// device must not be able to mint an identity doc for a key it merely typed, gated app or not.
await expect('UNAUTH creates a missing identity doc -> DENIED (no client heal gate can substitute for the auth floor)', 'DENIED',
  () => setDoc(doc(dbU, 'trips', healKeys[4], 'profile', 'identity'), { version: 1 }));

// Not carved out by id: these reach the subtree block, where isMember() is true only because no
// trip doc exists at an account path.
console.log('\n  -- 9e. account docs profile/prefs and profile/journal_<id> (D-593) --');
for (const id of ['prefs', 'journal_x']) {
  await expect(`authed sets trips/{acct}/profile/${id}`, 'ALLOWED',
    () => setDoc(doc(dbS, 'trips', ACCT, 'profile', id), { version: 1 }));
  await expect(`authed gets trips/{acct}/profile/${id}`, 'ALLOWED', async () => {
    if (!(await getDoc(doc(dbS, 'trips', ACCT, 'profile', id))).exists()) throw new Error('fixture: must exist');
  });
}
const phase9 = flush('PHASE 9 (the door + the account path)');

// ── 10. NEGATIVE CONTROL for membership ──────────────────────────────────────
console.log('\n\n=== 10. NEGATIVE CONTROL: same member denials, MEMBERSHIP REMOVED ===');
let membersOff = shipped;
// rosterIsWellFormed() too: two of the denials (M removes the owner, M re-roles the owner) leave
// no owner, so the roster guard also refuses them and they would stay DENIED here (#453).
for (const fn of ['isMember', 'isOwner', 'claimsSelfAsOwner', 'rosterIsWellFormed']) {
  membersOff = neuter(membersOff, fn, 'return request.auth != null;',
    'without a working phase 10 the suite cannot distinguish member gating from a bare auth floor.');
}
await seedGated();
{
  const r = await loadRules(membersOff);
  console.log(`  membership-removed rules compile: HTTP ${r.status}`);
  console.log(`  (the same ${MEMBER_DENIALS.length} assertions as 7a, still asserting DENIED — every FAIL below is the point)`);
  for (const [name, fn] of MEMBER_DENIALS) await expect(name, 'DENIED', fn);
}
const phase10 = flush('PHASE 10 (membership REMOVED)  <-- MUST be red');

// ── 10b. RESTORED ────────────────────────────────────────────────────────────
// seed() reloads the shipped rules, and phase 10 mutated and then deleted trips/L, so the
// fixture is rebuilt rather than assumed.
console.log('\n\n=== 10b. MEMBERSHIP RESTORED ===');
await seedGated();
for (const [name, fn] of MEMBER_DENIALS) await expect(name, 'DENIED', fn);
const phase10b = flush('PHASE 10b (membership RESTORED)');

// ── 11. NEGATIVE CONTROL for self-join ───────────────────────────────────────
console.log('\n\n=== 11. NEGATIVE CONTROL: self-join denials, selfJoinsAsMember() REMOVED ===');
const selfJoinOff = neuter(shipped, 'selfJoinsAsMember', 'return request.auth != null;',
  'without a working phase 11 the 7g denials could be passing for some other reason.');
for (const [name, fn] of SELF_JOIN_DENIALS) {
  await seedGated(selfJoinOff);
  await expect(name, 'DENIED', fn);
}
const phase11 = flush('PHASE 11 (self-join REMOVED)  <-- MUST be red');
await loadRules(shipped);

// ── 12. users/{uid}: the email/password account doc ─────────────────────────
console.log('\n\n=== 12. users/{uid}: owner-only, fixed shape, username immutable ===');
const USER = { username: 'powan_55', accountId: ACCT };
const me = (d = db) => doc(d, 'users', O);
await expect('O creates users/{O} {username, accountId}', 'ALLOWED', () => setDoc(me(), USER));
await expect('O gets users/{O}', 'ALLOWED', () => getDoc(me()));
await expect('O repoints accountId on update', 'DENIED', () => setDoc(me(), { ...USER, accountId: TRIP }));
await expect('O changes username on update', 'DENIED', () => setDoc(me(), { ...USER, username: 'someone_else' }));
await expect('O deletes users/{O}', 'DENIED', () => deleteDoc(me()));
await expect('stranger S gets users/{O}', 'DENIED', () => getDoc(me(dbS)));
await expect('stranger S writes users/{O}', 'DENIED', () => setDoc(me(dbS), USER));
await expect('stranger S creates users/{M} (not yet existing)', 'DENIED', () => setDoc(doc(dbS, 'users', M), USER));
await expect('UNAUTH gets users/{O}', 'DENIED', () => getDoc(me(dbU)));
await expect('authed LIST /users', 'DENIED', () => getDocs(collection(db, 'users')));
const bad = (label, data) => expect(`S creates users/{S} with ${label}`, 'DENIED', () => setDoc(doc(dbS, 'users', S), data));
await bad('an extra field', { ...USER, role: 'owner' });
await bad('username too short', { ...USER, username: 'ab' });
await bad('username with uppercase', { ...USER, username: 'Powan' });
await bad('username 21 chars', { ...USER, username: 'a'.repeat(21) });
await bad('username not a string', { ...USER, username: 12345 });
await bad('accountId 35 chars', { ...USER, accountId: ACCT.slice(1) });
await bad('accountId not a string', { ...USER, accountId: 1 });
await bad('no accountId', { username: 'powan_55' });
await expect('S creates users/{S} with a valid shape (control for the above)', 'ALLOWED',
  () => setDoc(doc(dbS, 'users', S), { username: 'stranger', accountId: K }));
const phase12 = flush('PHASE 12 (users/{uid})');

console.log('\n──────────────────────────────────────────────────────────────');
console.log(`  phase 3   shape guard PRESENT   ${phase3.pass} passed, ${phase3.fail} failed`);
console.log(`  phase 4   shape guard REMOVED   ${phase4.pass} passed, ${phase4.fail} failed   <- negative control`);
console.log(`  phase 5   shape guard RESTORED  ${phase5.pass} passed, ${phase5.fail} failed`);
console.log(`  phase 6   membership positive   ${phase6.pass} passed, ${phase6.fail} failed`);
console.log(`  phase 7   membership negative   ${phase7.pass} passed, ${phase7.fail} failed`);
console.log(`  phase 8   grandfathered trip    ${phase8.pass} passed, ${phase8.fail} failed`);
console.log(`  phase 9   the door + account    ${phase9.pass} passed, ${phase9.fail} failed`);
console.log(`  phase 10  membership REMOVED    ${phase10.pass} passed, ${phase10.fail} failed   <- negative control`);
console.log(`  phase 10b membership RESTORED   ${phase10b.pass} passed, ${phase10b.fail} failed`);
console.log(`  phase 11  self-join REMOVED     ${phase11.pass} passed, ${phase11.fail} failed   <- negative control`);
console.log(`  phase 12  users/{uid}           ${phase12.pass} passed, ${phase12.fail} failed`);
const shapeProven = phase3.fail === 0 && phase4.fail === HOSTILE.length && phase5.fail === 0;
const memberProven = phase6.fail === 0 && phase7.fail === 0 && phase8.fail === 0 && phase9.fail === 0
  && phase10.fail === MEMBER_DENIALS.length && phase10b.fail === 0
  && phase11.fail === SELF_JOIN_DENIALS.length;
const usersProven = phase12.fail === 0 && phase12.pass === 19;
const proven = shapeProven && memberProven && usersProven;
console.log(`  VERDICT: ${proven
  ? `BOTH GUARDS BITE — all ${HOSTILE.length} hostile writes flip DENIED->ALLOWED without boundedWrite(), `
    + `and all ${MEMBER_DENIALS.length} member denials flip DENIED->ALLOWED without the membership predicates`
  : `INCONCLUSIVE — see failures above (shape ${shapeProven ? 'ok' : 'BAD'}, membership ${memberProven ? 'ok' : 'BAD'}, users ${usersProven ? 'ok' : 'BAD'})`}`);
console.log('──────────────────────────────────────────────────────────────\n');

for (const c of [owner, memberApp, strangerApp, anonApp]) {
  await terminate(c.db);
  await deleteApp(c.app);
}
process.exit(proven ? 0 : 1);
