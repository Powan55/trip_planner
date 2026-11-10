/**
 * Values this device lost to another person's edit in a sync merge (#1124, D-801).
 *
 * `mergeItems` stays a pure lattice. This sits in the apply layer: diff the pre-merge local plans
 * against the merged result and keep what the merge threw away, on this device only, so a
 * restore is an ordinary edit (fresh stamp, syncs like any other). Never on a row or a doc.
 */

import { FIELD_GROUPS, fieldKey, type SyncedRow } from './merge-items';
import { parse } from './hlc';
import { keyFor, readJson, writeJson } from '@/core/storage/gateway';

export interface ConflictEntry {
  itemId: string;
  date: string;
  /** Local values the merge dropped, by item key (a group's keys travel together). */
  loserFields: Record<string, unknown>;
  /** Display name of whoever's edit won. */
  winnerActor: string;
  at: string;
}

export const MAX_CONFLICTS = 50;

interface PlanLike {
  date: string;
  items?: readonly SyncedRow[];
}
type Row = SyncedRow & Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function liveById(plans: readonly PlanLike[]) {
  const out = new Map<string, { date: string; item: Row }>();
  for (const p of plans) {
    for (const item of p.items ?? []) if (item.deleted !== true) out.set(item.id, { date: p.date, item: item as Row });
  }
  return out;
}

/**
 * Pure. For each id live on both sides whose merged content-group value differs from `local`'s and
 * whose winning stamp was minted by someone other than `me`, one entry holding local's values.
 * Depends only on (local, merged), so merge argument order cannot change the answer.
 */
export function detectLosses(
  local: readonly PlanLike[],
  merged: readonly PlanLike[],
  me: string,
  at: string,
): ConflictEntry[] {
  const before = liveById(local);
  const out: ConflictEntry[] = [];
  for (const [id, { date, item: win }] of liveById(merged)) {
    const old = before.get(id)?.item;
    if (!old) continue;
    const loserFields: Record<string, unknown> = {};
    let winnerActor = '';
    for (const [group, keys] of Object.entries(FIELD_GROUPS)) {
      if (keys.every((k) => same(old[k], win[k]))) continue;
      const actor = parse(fieldKey(win, group)).actor;
      if (actor === me || parse(fieldKey(old, group)).actor !== me) continue;
      if (keys.every((k) => old[k] === undefined)) continue;
      // Whole group, null marking an absent key, so a restore can clear it (updateItem does not
      // recompute startMinutes from time).
      for (const k of keys) loserFields[k] = old[k] ?? null;
      winnerActor = actor;
    }
    if (Object.keys(loserFields).length > 0) out.push({ itemId: id, date, loserFields, winnerActor, at });
  }
  return out;
}

function sanitize(v: unknown): ConflictEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e): e is ConflictEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof e.itemId === 'string' &&
      typeof e.date === 'string' &&
      typeof e.winnerActor === 'string' &&
      typeof e.at === 'string' &&
      !!e.loserFields &&
      typeof e.loserFields === 'object' &&
      !Array.isArray(e.loserFields),
  );
}

/** Lenient: anything unreadable is an empty list. */
export function listConflicts(): ConflictEntry[] {
  return sanitize(readJson<unknown>('local', keyFor('conflicts'), []));
}

function save(list: ConflictEntry[]): void {
  writeJson('local', keyFor('conflicts'), list.slice(-MAX_CONFLICTS));
}

/**
 * Fold new losses into the stored list (newest last; an item keeps one entry, its fields merged,
 * newest value wins) and prune entries whose item is no longer live in `merged`. Oldest dropped
 * past the cap.
 */
export function recordConflicts(local: readonly PlanLike[], merged: readonly PlanLike[], me: string): void {
  const found = detectLosses(local, merged, me, new Date().toISOString());
  const live = liveById(merged);
  const prev = listConflicts();
  const kept = prev.filter((e) => live.has(e.itemId));
  if (found.length === 0 && kept.length === prev.length) return;
  const next = kept.filter((e) => !found.some((f) => f.itemId === e.itemId));
  for (const f of found) {
    const old = kept.find((e) => e.itemId === f.itemId);
    next.push(old ? { ...f, loserFields: { ...old.loserFields, ...f.loserFields } } : f);
  }
  save(next);
}

export function dismissConflict(itemId: string): void {
  save(listConflicts().filter((e) => e.itemId !== itemId));
}
