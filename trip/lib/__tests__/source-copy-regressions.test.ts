import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPONENTS = resolve(__dirname, '../../components');
const read = (p: string) => readFileSync(resolve(COMPONENTS, p), 'utf8');

describe('source regressions', () => {
  it('photo input has no capture attribute, so phones offer the library too', () => {
    expect(read('photo-attach.tsx')).not.toMatch(/\bcapture=/);
  });

  it('no HTML entities inside JS string or template literals', () => {
    const bad: string[] = [];
    for (const f of readdirSync(COMPONENTS).filter((n) => n.endsWith('.tsx'))) {
      read(f)
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/(['"`])[^'"`<>]*&(rsquo|lsquo|rdquo|ldquo|amp|apos|quot|nbsp|mdash|ndash|hellip);/.test(line)) {
            bad.push(`${f}:${i + 1}`);
          }
        });
    }
    expect(bad).toEqual([]);
  });
});
