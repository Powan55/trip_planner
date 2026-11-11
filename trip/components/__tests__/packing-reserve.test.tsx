import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PackingChecklist from '@/components/packing-checklist';

describe('packing pre-hydration shell', () => {
  it('reserves list height so back-nav scroll restore is not clamped', () => {
    const html = renderToString(<PackingChecklist />);
    expect(html).toContain('Loading your checklist');
    expect(html).toContain('min-height:110rem');
  });
});
