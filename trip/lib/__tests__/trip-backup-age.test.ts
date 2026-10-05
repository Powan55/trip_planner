import { describe, it, expect } from 'vitest';
import { backupAgeDays, BACKUP_FORMAT, BACKUP_VERSION } from '@/lib/trip-backup';

/** #851 — the age the restore confirm warns about is read from `exportedAt`, defensively. */
describe('backupAgeDays', () => {
  const now = Date.parse('2026-10-05T12:00:00.000Z');
  const file = (v: unknown) => new Blob([typeof v === 'string' ? v : JSON.stringify(v)]);
  const backup = (extra: Record<string, unknown>) => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tripId: 't',
    domains: {},
    ...extra,
  });

  it('counts whole days since exportedAt', async () => {
    expect(await backupAgeDays(file(backup({ exportedAt: '2026-09-25T12:00:00.000Z' })), now)).toBe(10);
    expect(await backupAgeDays(file(backup({ exportedAt: '2026-10-05T01:00:00.000Z' })), now)).toBe(0);
  });

  it('treats a stamp in the future as 0 days', async () => {
    expect(await backupAgeDays(file(backup({ exportedAt: '2027-01-01T00:00:00.000Z' })), now)).toBe(0);
  });

  it('is null for a missing or unparseable stamp', async () => {
    expect(await backupAgeDays(file(backup({})), now)).toBeNull();
    expect(await backupAgeDays(file(backup({ exportedAt: 'yesterday' })), now)).toBeNull();
  });

  it('is null for a non-backup, garbage, or a legacy itinerary-only file', async () => {
    expect(await backupAgeDays(file('not json'), now)).toBeNull();
    expect(await backupAgeDays(file({ schemaVersion: 4, updatedAt: '2026-01-01T00:00:00.000Z', payload: [] }), now)).toBeNull();
  });
});
