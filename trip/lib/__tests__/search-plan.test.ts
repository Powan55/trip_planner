import { describe, it, expect } from 'vitest';

import { searchPlanItems } from '@/lib/search-plan';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

function mkItem(id: string, fields: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: id, category: 'sightseeing', ...fields };
}

function mkPlan(date: string, items: ItineraryItem[]): DayPlan {
  return { date, city: 'Kathmandu', country: 'nepal', items };
}

describe('searchPlanItems — pure client-side matcher (S147, D-018 read-only)', () => {
  it('empty/whitespace query returns []', () => {
    const plans = [mkPlan('2026-12-09', [mkItem('a', { title: 'Boudhanath Stupa' })])];
    expect(searchPlanItems(plans, '')).toEqual([]);
    expect(searchPlanItems(plans, '   ')).toEqual([]);
  });

  it('matches by title (partial word, case-insensitive)', () => {
    const target = mkItem('a', { title: 'Boudhanath Stupa' });
    const plans = [mkPlan('2026-12-09', [target, mkItem('b', { title: 'Garden of Dreams' })])];
    const results = searchPlanItems(plans, 'boudha');
    expect(results.map((r) => r.item.id)).toEqual(['a']);
    // case-insensitivity
    expect(searchPlanItems(plans, 'BOUDHA').map((r) => r.item.id)).toEqual(['a']);
  });

  it('matches by notes', () => {
    const target = mkItem('a', { title: 'Dinner', notes: 'Best wood-fired pizza in town' });
    const plans = [mkPlan('2026-12-09', [target])];
    expect(searchPlanItems(plans, 'wood-fired').map((r) => r.item.id)).toEqual(['a']);
    expect(searchPlanItems(plans, 'PIZZA').map((r) => r.item.id)).toEqual(['a']);
  });

  it('matches by category', () => {
    const target = mkItem('a', { title: 'Momos at Yangling', category: 'food' });
    const plans = [mkPlan('2026-12-09', [target])];
    expect(searchPlanItems(plans, 'food').map((r) => r.item.id)).toEqual(['a']);
  });

  it('no match returns []', () => {
    const plans = [mkPlan('2026-12-09', [mkItem('a', { title: 'Boudhanath Stupa' })])];
    expect(searchPlanItems(plans, 'ramen')).toEqual([]);
  });

  it('multi-day results carry the right date', () => {
    const item1 = mkItem('a', { title: 'Ramen shop' });
    const item2 = mkItem('b', { title: 'Ramen alley crawl' });
    const plans = [
      mkPlan('2026-12-09', [item1]),
      mkPlan('2026-12-20', [item2]),
    ];
    const results = searchPlanItems(plans, 'ramen');
    expect(results).toEqual([
      { item: item1, date: '2026-12-09' },
      { item: item2, date: '2026-12-20' },
    ]);
  });

  it('ranks a title match above a notes-only match above a category-only match', () => {
    const titleHit = mkItem('title-hit', { title: 'has-query-here', category: 'sightseeing' });
    const notesHit = mkItem('notes-hit', { title: 'unrelated', notes: 'has-query-here too', category: 'sightseeing' });
    const categoryHit = mkItem('category-hit', { title: 'unrelated', category: 'has-query-here' as ItineraryItem['category'] });
    const plans = [mkPlan('2026-12-09', [categoryHit, notesHit, titleHit])];
    const results = searchPlanItems(plans, 'has-query-here');
    expect(results.map((r) => r.item.id)).toEqual(['title-hit', 'notes-hit', 'category-hit']);
  });

  it('#121: a tombstoned item is not searchable (the palette reads an unfiltered snapshot)', () => {
    const live = mkItem('live', { title: 'Ramen shop' });
    const tombstoned = mkItem('gone', { title: 'Ramen alley crawl', deleted: true });
    const plans = [mkPlan('2026-12-09', [live, tombstoned])];
    expect(searchPlanItems(plans, 'ramen').map((r) => r.item.id)).toEqual(['live']);
  });

  it('does not mutate the input plans/items', () => {
    const item = mkItem('a', { title: 'Boudhanath Stupa' });
    const plans = [mkPlan('2026-12-09', [item])];
    const snapshot = JSON.parse(JSON.stringify(plans));
    searchPlanItems(plans, 'boudha');
    expect(plans).toEqual(snapshot);
  });
});
