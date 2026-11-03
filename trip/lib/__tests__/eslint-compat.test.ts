import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

describe('ESLint 10 plugin compatibility', () => {
  it.each([
    ['jsx-a11y/alt-text', 'scripts/lint-compat-fixture.jsx', 'export function Example() { return <img src="/x.png" />; }'],
    ['import/no-anonymous-default-export', 'scripts/lint-compat-fixture.mjs', 'export default {};'],
    ['react/display-name', 'components/lint-compat-fixture.tsx', 'import React from "react"; export default React.memo(() => <div />);'],
    ['jsx-a11y/alt-text', 'components/lint-compat-fixture.tsx', 'export function Example() { return <img src="/x.png" />; }'],
    ['react-hooks/rules-of-hooks', 'components/lint-compat-fixture.tsx', 'import { useEffect } from "react"; export function Example({ flag }: { flag: boolean }) { if (flag) useEffect(() => {}, []); return null; }'],
    ['@typescript-eslint/no-restricted-imports', 'core/lint-compat-fixture.ts', 'import { getFirestore } from "firebase/firestore"; export const db = getFirestore();'],
    ['import/no-anonymous-default-export', 'lib/lint-compat-fixture.ts', 'export default {};'],
  ])('still reports %s', async (ruleId, filePath, source) => {
    const results = await eslint.lintText(source, { filePath });
    expect(results.flatMap((result) => result.messages.map((message) => message.ruleId))).toContain(ruleId);
  });

  it.each([['next.config.js', 'module.exports = {};'], ['postcss.config.cjs', 'module.exports = {};'], ['scripts/lint-compat-fixture.mjs', 'export const config = {};']])('accepts standard JavaScript in %s', async (filePath, source) => {
    const results = await eslint.lintText(source, { filePath });
    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });

  it('accepts a valid component', async () => {
    const results = await eslint.lintText('export function Example() { return <div>Trip</div>; }', {
      filePath: 'components/lint-compat-fixture.tsx',
    });
    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });
});
