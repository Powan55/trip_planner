// The one trip the built-in pack syncs to, for every account and device. Firestore rules name the
// same id in isShared() and the same accounts in isAllowlisted(); shared-trip.guard.test.ts fails
// when the three drift apart. Lives in core/ so the storage gateway can read it; lib/shared-trip.ts
// re-exports it for everything above.

export const SHARED_TRIP_ID = 'b2826dc5-d103-4a8c-a053-30531b4fd4b0';

export const SHARED_TRIP_USERNAMES = ['Powan', 'Uttam', 'Sushil'] as const;
