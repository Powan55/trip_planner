// @vitest-environment jsdom
//
// #851 — under sync the restore confirm names the backup's age once it is a week old or more, since
// restoring tombstones everyone's newer rows. Unsynced restores and fresh or unreadable backups show
// no extra line.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ synced: true, age: null as number | null }));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ restorePlans: vi.fn() }),
}));
vi.mock('@/hooks/use-my-places', () => ({ useMyPlaces: () => ({ restoreMyPlaces: vi.fn() }) }));
vi.mock('@/hooks/use-docs', () => ({ useDocs: () => ({ restoreDocsChecklist: vi.fn() }) }));
vi.mock('@/hooks/use-expenses', () => ({ useExpenses: () => ({ restoreExpenses: vi.fn() }) }));
vi.mock('@/lib/firebase-config', () => ({ isTripRemoteConfigured: () => gate.synced }));
vi.mock('@/lib/token-auth', () => ({ getActiveTraveler: () => ({ name: 'Powan' }) }));
vi.mock('@/lib/itinerary-storage', () => ({ savePlans: vi.fn() }));
vi.mock('@/lib/trip-backup', () => ({
  downloadTripBackup: vi.fn(),
  importTripBackup: vi.fn(async () => ({ ok: false, error: 'not under test' })),
  backupAgeDays: vi.fn(async () => gate.age),
  STALE_BACKUP_DAYS: 7,
}));

import BackupRestore from '@/components/backup-restore';

const warning = () => document.body.querySelector('[data-testid="backup-stale-warning"]');

let root: Root;
let container: HTMLDivElement;

async function pickFile(): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>('[data-testid="backup-import-input"]')!;
  const file = new File(['{}'], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

beforeEach(() => {
  gate.synced = true;
  gate.age = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(BackupRestore)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete document.body.dataset.dialogOpen;
});

describe('BackupRestore — stale backup warning under sync (#851)', () => {
  it('names the age once the backup is a week old', async () => {
    gate.age = 12;
    await pickFile();
    expect(warning()?.textContent).toContain('12 days old');
  });

  it('shows nothing for a fresh backup', async () => {
    gate.age = 6;
    await pickFile();
    expect(document.body.querySelector('[data-testid="backup-confirm-dialog"]')).not.toBeNull();
    expect(warning()).toBeNull();
  });

  it('shows nothing when the age could not be read', async () => {
    gate.age = null;
    await pickFile();
    expect(warning()).toBeNull();
  });

  it('shows nothing on an unsynced device, however old the file', async () => {
    gate.synced = false; // read when the panel mounts, so mount it afresh
    gate.age = 90;
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(BackupRestore)));
    await pickFile();
    expect(warning()).toBeNull();
  });
});
