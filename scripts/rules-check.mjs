/**
 * firestore.rules validation harness (S358 / D-251).
 *
 * Validates the repo's firestore.rules against the REAL Cloud Firestore rules engine using
 * the local emulator. No credentials, no deploy, no network beyond localhost.
 *
 *   RUN IT — copy/paste this, from the repo root:
 *
 *     firebase emulators:exec --only firestore --project demo-rules "node scripts/rules-check.mjs"
 *
 * Nothing else to install or configure. That command reuses the EXISTING root firebase.json
 * (which already points at firestore.rules) and the emulator's default port; `emulators:exec`
 * exports FIRESTORE_EMULATOR_HOST, which this script reads, so a custom port in firebase.json is
 * followed automatically. Exit code 0 = all green, 1 = something is wrong with the rules.
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
 * NOT wired into CI on purpose — that needs an emulator in the runner. Run it by hand whenever
 * firestore.rules changes.
 *
 * WHAT IT PROVES, in five phases:
 *   0. control      — deny-all really denies, allow-all really allows (else every PASS is noise)
 *   1. D-251        — `request.resource.size()` is Cloud STORAGE syntax; in Firestore it is a
 *                     CONSTANT 3 (the {data,id,__name__} wrapper's member count), so the
 *                     `< 1048576` "size cap" is `true` in a costume. Probed by equality.
 *   2. D-251 corollary — a request.resource-based guard applied to `write` breaks deleteDoc,
 *                     because request.resource is null on a delete ("Null value error").
 *   3. the shipped rules — D-219 split intact, all 8 real write shapes allowed, deletes allowed,
 *                     realistic-maximum payloads allowed (R5), hostile writes denied.
 *   4. NEGATIVE CONTROL — the same hostile writes with the guard REMOVED must all be ALLOWED.
 *                     Without this phase the suite cannot tell a working guard from no guard.
 *   5. restored     — guard back on, hostile writes denied again.
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
  setDoc, getDoc, getDocs, deleteDoc, runTransaction, terminate,
} = require('firebase/firestore');

// `firebase emulators:exec` exports this; fall back to the emulator default.
const [HOSTNAME, PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-rules';
const HOST = `http://${HOSTNAME}:${PORT}`;
const TRIP = '11111111-2222-3333-4444-555555555555';

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

const app = initializeApp({ projectId: PROJECT, apiKey: 'demo' });
const db = getFirestore(app);
connectFirestoreEmulator(db, HOSTNAME, Number(PORT));

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

console.log(`\nfirestore.rules harness — emulator ${HOST}, project ${PROJECT}`);
console.log(`rules under test: ${RULES}`);

// ── 0. CONTROL ───────────────────────────────────────────────────────────────
console.log('\n=== 0. CONTROL: the harness must actually observe rules ===');
await loadRules(`rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if false; } } }`);
await expect('write under deny-all rules', 'DENIED', () => setDoc(doc(db, 'trips', TRIP), { a: 1 }));
await expect('read under deny-all rules', 'DENIED', () => getDoc(doc(db, 'trips', TRIP)));
await loadRules(`rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if true; } } }`);
await expect('write under allow-all rules', 'ALLOWED', () => setDoc(doc(db, 'trips', TRIP), { a: 1 }));
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
  await loadRules(`rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if true; } } }`);
  await setDoc(doc(db, 'trips', 'del-target'), { schemaVersion: 1, createdAt: new Date(), seededFrom: 'sample' });
  await loadRules(wrap(body));
  await expect(label, label.startsWith('SHIPPED') ? 'ALLOWED' : 'DENIED', () => deleteDoc(doc(db, 'trips', 'del-target')));
}
await wipe();

// ── 3. THE SHIPPED RULES ─────────────────────────────────────────────────────
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
await expect('GET /trips/{knownId} by direct id', 'ALLOWED', () => getDoc(doc(db, 'trips', TRIP)));
await expect('LIST /trips/{knownId}/days (subcollection query)', 'ALLOWED', () => getDocs(collection(db, 'trips', TRIP, 'days')));

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

console.log('\n  -- 3c. DELETES (unguarded on purpose — request.resource is null) --');
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

// The hostile set — re-run verbatim in phase 4 with the guard removed, and again in phase 5.
const HOSTILE = [
  ['10,000 top-level fields on the trip doc', () => setDoc(doc(db, 'trips', TRIP), bigMap(10000))],
  ['10,000 top-level fields on a day doc', () => setDoc(doc(db, 'trips', TRIP, 'days', 'x'), bigMap(10000))],
  ['items[] with 20,000 elements', () => setDoc(doc(db, 'trips', TRIP, 'days', 'x'), { date: 'x', items: bigList(20000) })],
  ['trips[] with 20,000 elements', () => setDoc(doc(db, 'trips', TRIP, 'profile', 'tripList'), { version: 1, trips: bigList(20000) })],
  ['removed[] with 20,000 elements', () => setDoc(doc(db, 'trips', TRIP, 'profile', 'tripList'), { version: 1, removed: bigList(20000) })],
  ['budget fields{} with 20,000 entries', () => setDoc(doc(db, 'trips', TRIP, 'budget', 'model'), { version: 1, fields: bigMap(20000) })],
  ['items as a 200,000-char string (scalar in a list slot)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'x'), { date: 'x', items: 'z'.repeat(200000) })],
  ['items[5001] (one over the ceiling)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'b2'), { date: 'b2', items: bigList(5001) })],
  ['33 top-level fields (one over the ceiling)', () => setDoc(doc(db, 'trips', TRIP, 'days', 'b4'), bigMap(33))],
];

console.log('\n  -- 3d. HOSTILE WRITES must be DENIED (guard PRESENT) --');
for (const [name, fn] of HOSTILE) await expect(name, 'DENIED', fn);

console.log('\n  -- 3e. AT the ceiling must still be ALLOWED --');
await expect('items[5000]  (at the ceiling)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'days', 'b1'), { date: 'b1', items: bigList(5000) }));
await expect('32 top-level fields (at the ceiling)', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'days', 'b3'), bigMap(32)));

console.log('\n  -- 3f. KNOWN HOLE (documented, NOT fixed by rules — needs App Check) --');
await expect('one field holding a 900,000-char string', 'ALLOWED',
  () => setDoc(doc(db, 'trips', TRIP, 'days', 'hole'), { blob: 'z'.repeat(900000) }));
const phase3 = flush('PHASE 3 (guard PRESENT)');

// ── 4. NEGATIVE CONTROL ──────────────────────────────────────────────────────
// The guard-removed variant is DERIVED from the file under test — not a frozen copy and not
// `git show HEAD:firestore.rules` (which stops being the pre-guard file the moment the guard
// is committed, silently turning this phase into a second copy of phase 3).
console.log('\n\n=== 4. NEGATIVE CONTROL: same hostile writes, guard REMOVED ===');
const unguarded = shipped.replace(/if boundedWrite\(\);/g, 'if true;');
if (unguarded === shipped) {
  throw new Error(
    'Negative control could not remove the guard: no `if boundedWrite();` found in firestore.rules.\n' +
    'The guard was renamed or restructured — update this script, do NOT ignore this. Without a\n' +
    'working phase 4 the suite cannot distinguish a real guard from no guard at all.');
}
{
  const r = await loadRules(unguarded);
  console.log(`  guard-removed rules compile: HTTP ${r.status}`);
  console.log('  (same 9 assertions as 3d, still asserting DENIED — every FAIL below is the point)');
  for (const [name, fn] of HOSTILE) await expect(name, 'DENIED', fn);
}
const phase4 = flush('PHASE 4 (guard REMOVED)  <-- MUST be red');

// ── 5. RESTORED ──────────────────────────────────────────────────────────────
console.log('\n\n=== 5. GUARD RESTORED ===');
await loadRules(shipped);
for (const [name, fn] of HOSTILE) await expect(name, 'DENIED', fn);
const phase5 = flush('PHASE 5 (guard RESTORED)');

console.log('\n──────────────────────────────────────────────────────────────');
console.log(`  phase 3  guard PRESENT   ${phase3.pass} passed, ${phase3.fail} failed`);
console.log(`  phase 4  guard REMOVED   ${phase4.pass} passed, ${phase4.fail} failed   <- the negative control`);
console.log(`  phase 5  guard RESTORED  ${phase5.pass} passed, ${phase5.fail} failed`);
const proven = phase3.fail === 0 && phase4.fail === HOSTILE.length && phase5.fail === 0;
console.log(`  VERDICT: ${proven
  ? `GUARD BITES — all ${HOSTILE.length} hostile writes flip DENIED->ALLOWED when it is removed`
  : 'INCONCLUSIVE — see failures above'}`);
console.log('──────────────────────────────────────────────────────────────\n');

await terminate(db);
await deleteApp(app);
process.exit(proven ? 0 : 1);
