import { describe, it, expect } from 'vitest';

// S357A — the composer's time EXTRACTOR. It does NOT parse time itself: it peels a
// leading-or-trailing time token off the typed text and delegates that token to the ONE
// pinned parser (`parseTimeString`, D-139 — not widened, not re-implemented here).
import { extractQuickAddTime } from '@/lib/quick-add-parse';
import { parseTimeString } from '@/core/dates';

describe('extractQuickAddTime — leading token', () => {
  it('peels a leading 12h token', () => {
    expect(extractQuickAddTime('7pm dinner')).toEqual({ title: 'dinner', startMinutes: 1140 });
  });

  it('peels a leading 24h token', () => {
    expect(extractQuickAddTime('19:00 dinner')).toEqual({ title: 'dinner', startMinutes: 1140 });
  });

  it('peels a leading two-word token ("7 pm")', () => {
    expect(extractQuickAddTime('7 pm dinner')).toEqual({ title: 'dinner', startMinutes: 1140 });
  });

  it('peels a leading two-word token with periods ("12:30 p.m.")', () => {
    expect(extractQuickAddTime('12:30 p.m. lunch')).toEqual({ title: 'lunch', startMinutes: 750 });
  });

  it('drops the connector left behind at the seam', () => {
    expect(extractQuickAddTime('08:30 - breakfast')).toEqual({ title: 'breakfast', startMinutes: 510 });
  });
});

describe('extractQuickAddTime — trailing token', () => {
  it('peels a trailing 24h token', () => {
    expect(extractQuickAddTime('dinner 19:00')).toEqual({ title: 'dinner', startMinutes: 1140 });
  });

  it('peels a trailing token off a multi-word title', () => {
    expect(extractQuickAddTime('Dinner at Ichiran 7pm')).toEqual({
      title: 'Dinner at Ichiran',
      startMinutes: 1140,
    });
  });

  it('drops a trailing "at" left behind at the seam', () => {
    expect(extractQuickAddTime('dinner at 7pm')).toEqual({ title: 'dinner', startMinutes: 1140 });
  });

  it('peels a trailing two-word token', () => {
    expect(extractQuickAddTime('lunch 12:30 p.m.')).toEqual({ title: 'lunch', startMinutes: 750 });
  });
});

describe('extractQuickAddTime — leaves the text alone when there is no time', () => {
  it('a bare title is untimed and unchanged', () => {
    expect(extractQuickAddTime('dinner')).toEqual({ title: 'dinner' });
  });

  it('a multi-word title with no time token is unchanged', () => {
    expect(extractQuickAddTime('Boudhanath Stupa sunrise')).toEqual({
      title: 'Boudhanath Stupa sunrise',
    });
  });

  it('a bare number is NOT a time (the pinned parser rejects it)', () => {
    expect(extractQuickAddTime('Table for 2')).toEqual({ title: 'Table for 2' });
  });

  it('an out-of-range clock value is NOT a time', () => {
    expect(extractQuickAddTime('25:00 meeting')).toEqual({ title: '25:00 meeting' });
    expect(extractQuickAddTime('meeting 12:75')).toEqual({ title: 'meeting 12:75' });
  });

  it('trims surrounding whitespace', () => {
    expect(extractQuickAddTime('   breakfast   08:30   ')).toEqual({
      title: 'breakfast',
      startMinutes: 510,
    });
  });

  it('empty / whitespace input yields an empty title and no time', () => {
    expect(extractQuickAddTime('')).toEqual({ title: '' });
    expect(extractQuickAddTime('    ')).toEqual({ title: '' });
  });
});

describe('extractQuickAddTime — never produces an empty title', () => {
  // A time token ALONE must stay the title: an item with no title is unaddable
  // (QuickAddInput no-ops on blank), so swallowing the whole string is never right.
  for (const only of ['7pm', '19:00', '12:30 p.m.', '7 pm']) {
    it(`"${only}" alone stays the title, untimed`, () => {
      expect(extractQuickAddTime(only)).toEqual({ title: only });
    });
  }
});

describe('extractQuickAddTime — delegates to the pinned parser (D-139)', () => {
  // Every shape `parseTimeString` accepts must extract to exactly the value IT returns —
  // this is the tie that breaks if the extractor ever grows its own parsing.
  const SHAPES = ['06:00', '6:00', '23:59', '14.30', '2pm', '2:15 PM', '12am', '12pm', '12:30 p.m.', '05:45'];
  for (const shape of SHAPES) {
    it(`"${shape}" extracts to parseTimeString("${shape}")`, () => {
      const expected = parseTimeString(shape);
      expect(expected).toBeTypeOf('number');
      expect(extractQuickAddTime(`ramen ${shape}`)).toEqual({ title: 'ramen', startMinutes: expected });
      expect(extractQuickAddTime(`${shape} ramen`)).toEqual({ title: 'ramen', startMinutes: expected });
    });
  }

  it('every extracted value is inside the 0–1439 convention', () => {
    for (const shape of SHAPES) {
      const { startMinutes } = extractQuickAddTime(`ramen ${shape}`);
      expect(startMinutes).toBeGreaterThanOrEqual(0);
      expect(startMinutes).toBeLessThanOrEqual(1439);
    }
  });
});
