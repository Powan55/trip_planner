// @vitest-environment jsdom
//
// S350 — the concierge's rewritten `renderAssistantContent`: a two-pass block grouper
// (`fence`/`ul`/`ol`/`heading`/`para`) around the UNTOUCHED `renderInline`. Asserted on REAL DOM
// (render the returned nodes through react-dom and read the tree back), not on a string.
// Supersedes `lib/__tests__/concierge-render.test.ts` (S341), whose assertions pinned the OLD
// one-`<span>`-per-line-with-a-literal-"•"-glyph shape that this rewrite deliberately replaces —
// kept here instead so a `.tsx` file can use real JSX (this project's `lib/__tests__` convention
// is deliberately JSX-free; see that directory's other component test for why).

import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { renderAssistantContent } from '@/components/concierge-chat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Render one assistant reply and hand back its container for DOM assertions. */
function render(text: string): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<div>{renderAssistantContent(text)}</div>);
  });
  return container;
}

/** The top-level block elements, in order. */
function blocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.firstElementChild!.children) as HTMLElement[];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('S350 — renderAssistantContent: lists become real <ul>/<ol>, not typed glyphs', () => {
  it('a 3-bullet reply renders EXACTLY ONE <ul> with three <li>, no literal bullet glyph', () => {
    const c = render('- Boudhanath Stupa\n- Pashupatinath Temple\n- Swayambhunath');
    const b = blocks(c);
    expect(b).toHaveLength(1);
    expect(b[0].tagName).toBe('UL');
    const items = b[0].querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(Array.from(items).map((li) => li.textContent)).toEqual([
      'Boudhanath Stupa',
      'Pashupatinath Temple',
      'Swayambhunath',
    ]);
    // The marker is CSS (list-disc) now — no typed "•" left in any item's text.
    for (const li of Array.from(items)) expect(li.textContent).not.toContain('•');
    expect(c.textContent).not.toContain('•');
  });

  it('`*` and `-` bullets merge into the SAME list', () => {
    const b = blocks(render('- one\n* two\n- three'));
    expect(b).toHaveLength(1);
    expect(b[0].querySelectorAll('li')).toHaveLength(3);
  });

  it('consecutive bullets get REAL, CSS-driven spacing — not conditional on a blank line', () => {
    // No blank line between bullets (the common case the old renderer got wrong — zero spacing).
    const tight = blocks(render('- one\n- two'))[0];
    expect(tight.className).toContain('space-y-1.5'); // spacing is a fixed class on <ul>, not per-item margin
    expect(tight.querySelectorAll('li')).toHaveLength(2);
  });

  it('numbered lists (`1.` and `1)`) render as ONE <ol>, stripping the typed number', () => {
    const b = blocks(render('1. Fly to Kathmandu\n2) Trek Poon Hill'));
    expect(b).toHaveLength(1);
    expect(b[0].tagName).toBe('OL');
    const items = b[0].querySelectorAll('li');
    expect(Array.from(items).map((li) => li.textContent)).toEqual([
      'Fly to Kathmandu',
      'Trek Poon Hill',
    ]);
  });

  it('does NOT treat a line starting with *italic* / **bold** as a bullet (marker needs a space)', () => {
    // Neither line is list-shaped, so both merge into ONE <p> (consecutive para lines, no blank
    // line between) — the point of this test is that NEITHER was mis-eaten as a bullet.
    const b = blocks(render('*keen*\n**Kathmandu**'));
    expect(b).toHaveLength(1);
    expect(b[0].tagName).toBe('P');
    expect(b[0].querySelector('em')).not.toBeNull();
    expect(b[0].querySelector('strong')).not.toBeNull();
  });
});

describe('S350 — renderAssistantContent: fenced code becomes ONE <pre>, not one pill per line', () => {
  it('a multi-line fenced block renders as a single <pre>, not one element per line', () => {
    const c = render('Try:\n```bash\nnpm install\nnpm test\n```\ndone');
    const b = blocks(c);
    expect(b.map((el) => el.textContent)).toEqual(['Try:', 'npm install\nnpm test', 'done']);
    expect(b[1].tagName).toBe('PRE');
    expect(c.querySelectorAll('pre')).toHaveLength(1); // exactly one <pre> for the whole fence
    expect(c.textContent).not.toContain('`');
  });

  it('does not re-interpret markdown markers inside fenced or inline code', () => {
    const fenced = render('```\n**not bold**\n```');
    expect(fenced.querySelector('strong')).toBeNull();
    expect(fenced.querySelector('pre')!.textContent).toBe('**not bold**');

    const inline = render('`**not bold**`');
    expect(inline.querySelector('strong')).toBeNull();
    expect(inline.querySelector('code')!.textContent).toBe('**not bold**');
  });
});

describe('S350 — renderAssistantContent: heading vs. bold render distinctly', () => {
  it('a `#` heading renders as its own block-level element, not a <p><strong> pair', () => {
    const b = blocks(render('## Day 3 in Kathmandu'));
    expect(b).toHaveLength(1);
    expect(b[0].tagName).toBe('STRONG'); // the heading IS the block, not a <p> wrapping a <strong>
    expect(b[0].textContent).toBe('Day 3 in Kathmandu');
  });

  it('**bold** inside prose stays INSIDE a <p>, distinguishing it from a heading block', () => {
    const b = blocks(render('**Kathmandu** is next'));
    expect(b).toHaveLength(1);
    expect(b[0].tagName).toBe('P');
    expect(b[0].querySelector('strong')!.textContent).toBe('Kathmandu');
  });
});

describe('S350 — renderAssistantContent: paragraphs / blank lines / empty input', () => {
  it('a blank line still starts a new paragraph block', () => {
    const b = blocks(render('First para.\n\nSecond para.'));
    expect(b).toHaveLength(2);
    expect(b.map((el) => el.textContent)).toEqual(['First para.', 'Second para.']);
  });

  it('renders empty input as nothing', () => {
    expect(blocks(render(''))).toHaveLength(0);
  });

  it('handles a realistic mixed reply end to end', () => {
    const c = render(
      '## Day 3 in Kathmandu\n\nHere is the plan:\n- **Boudhanath** at sunrise\n- Patan Durbar Square\n\nBook via [the site](https://example.com).',
    );
    const b = blocks(c);
    expect(b.map((el) => el.tagName)).toEqual(['STRONG', 'P', 'UL', 'P']);
    expect(b[2].querySelectorAll('li')).toHaveLength(2);
    expect(b[2].querySelector('strong')!.textContent).toBe('Boudhanath');
    expect(b[3].querySelector('a')!.getAttribute('href')).toBe('https://example.com');
  });
});

describe('S350 — renderInline is UNTOUCHED: the injection-safety boundary still holds', () => {
  it('renders [text](url) as a safe external anchor', () => {
    const c = render('See [the guide](https://example.com/kathmandu) for more');
    const a = c.querySelector('a')!;
    expect(a.textContent).toBe('the guide');
    expect(a.getAttribute('href')).toBe('https://example.com/kathmandu');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a javascript: link is still NOT an anchor — renders the literal source text instead', () => {
    const c = render('[click](javascript:alert(1))');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('[click](javascript:alert(1))');
  });

  it('a data: link is also refused', () => {
    const c = render('[x](data:text/html,evil)');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('[x](data:text/html,evil)');
  });

  it('bolds `**a*b**` (inner asterisk) and does not italicise arithmetic-style spaced asterisks', () => {
    const bold = render('**a*b** done');
    expect(bold.querySelector('strong')!.textContent).toBe('a*b');

    const arith = render('2 * 3 * 4');
    expect(arith.querySelector('em')).toBeNull();
    expect(arith.textContent).toBe('2 * 3 * 4');
  });
});
