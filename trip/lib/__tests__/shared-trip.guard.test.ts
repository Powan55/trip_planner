// The shared trip id and its three accounts are written in two places: lib/shared-trip.ts (what
// the app syncs to) and firestore.rules (what the server lets in). They must not drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_TRIP_ID, SHARED_TRIP_USERNAMES } from '@/lib/shared-trip';
import { ACCOUNT_ID_RE } from '@/lib/account-codes';
import { normalizeUsername, usernameToEmail } from '@/lib/token-auth';

const rules = readFileSync(join(process.cwd(), '..', 'firestore.rules'), 'utf8');

describe('shared trip id and accounts match firestore.rules', () => {
  it('the id is a lowercase uuid', () => {
    expect(SHARED_TRIP_ID).toMatch(ACCOUNT_ID_RE);
  });

  it('isShared() names the same id', () => {
    const literal = /function isShared\(\)\s*\{\s*return tripId == '([^']+)';/.exec(rules)?.[1];
    expect(literal).toBeDefined();
    expect(SHARED_TRIP_ID).toBe(literal);
  });

  it('isAllowlisted() lists exactly the emails of the shared usernames', () => {
    const body = /function isAllowlisted\(\)\s*\{[\s\S]*?\bin \[([^\]]*)\]/.exec(rules)?.[1] ?? '';
    const emails = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const expected = SHARED_TRIP_USERNAMES.map((u) => usernameToEmail(normalizeUsername(u)));
    expect(emails.sort()).toEqual(expected.sort());
  });
});
