// The `vi.mock('@/lib/firebase-config', ...)` factory, in one place.
//
// It had been copied into 48 suites as 25 near-identical variants. Across all 25 only two things
// ever actually differed, so those are the two parameters:
//
//   remoteOn  the sync gate, as a THUNK — suites flip it between cases (`() => state.remoteOn`),
//             so a plain boolean captured at hoist time would freeze the gate on.
//   tripId    the remote trip token, string or thunk (a few suites switch trips mid-run).
//
// `isTripRemoteConfigured` is not a third parameter: the real module defines it as
// `isRemoteConfigured() && getTripId() !== ''`, so it is derived from the two above by the same
// law. The copies each restated it by hand and could drift from the module they stand in for.
//
// The copies also enumerated the module's four exports by hand. A fifth export would have left
// all 48 of them returning `undefined` for it, with every suite still green — so the covered
// surface is checked against the real module here and a divergence throws.
//
// Usage (the `importOriginal` passthrough is what makes that check possible):
//
//   vi.mock('@/lib/firebase-config', (io) =>
//     firebaseConfigMock(io, () => state.remoteOn, 'nepal-japan-2026'));

type ImportOriginal = () => Promise<Record<string, unknown>>;

export async function firebaseConfigMock(
  importOriginal: ImportOriginal,
  remoteOn: () => boolean,
  tripId: string | (() => string),
) {
  const getTripId = typeof tripId === 'function' ? tripId : () => tripId;
  const mock = {
    FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
    isRemoteConfigured: () => remoteOn(),
    isTripRemoteConfigured: () => remoteOn() && getTripId() !== '',
    getTripId,
  };

  const covered = Object.keys(mock);
  const uncovered = Object.keys(await importOriginal()).filter((name) => !covered.includes(name));
  if (uncovered.length > 0) {
    throw new Error(
      `firebaseConfigMock does not cover ${uncovered.join(', ')}: lib/firebase-config exports ` +
        `${uncovered.length === 1 ? 'that name' : 'those names'} but this mock does not, so every ` +
        `suite mocking the module would read undefined for it and still pass. Add it here (or ` +
        `rename it here, if it was renamed) — do not re-copy the mock into a suite.`,
    );
  }

  return mock;
}
