import { describe, it, expect } from 'vitest';

// S122 — the seed golden snapshot. The trip-content consolidation moves the
// 32-day itinerary literal from `lib/sample-itinerary.ts` into `core/content/itinerary.ts`
// and leaves `SAMPLE_ITINERARY` a delegate re-export of the SAME object. This snapshot,
// captured on the PRE-refactor tree, proves the produced value is byte-for-byte deep-equal
// before and after that move (the S122 hard-acceptance guarantee).
//
// LIFECYCLE: after S122 this is NOT a frozen net that blocks
// content edits. It is the seed's DELIBERATE-EDIT baseline — a legitimate content change to
// `core/content/itinerary.ts` regenerates it with one documented command
// (`npx vitest run lib/__tests__/sample-itinerary-golden.test.ts -u`), and the `.golden.json`
// diff in review shows exactly what content changed. See docs/trip-content.md.

import { SAMPLE_ITINERARY } from '@/lib/sample-itinerary';

describe('S122 seed golden — SAMPLE_ITINERARY deep-equal across the content-layer refactor', () => {
  it('matches the captured golden snapshot byte-for-byte', async () => {
    await expect(JSON.stringify(SAMPLE_ITINERARY, null, 2) + '\n').toMatchFileSnapshot(
      './__fixtures__/sample-itinerary.golden.json',
    );
  });
});
