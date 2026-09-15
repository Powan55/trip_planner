// Extracts one version's RELEASES.md entry body, for the GitHub Release deploy.yml creates
// right after tagging. Both scripts import the same heading matcher, so "which entry is this
// version's" cannot drift between the gate and the release's own notes.

import { readFileSync } from 'node:fs';
import { findReleaseHeadingIndex } from './release-heading.mjs';

const tag = process.argv[2];
if (!tag) {
  console.error('usage: node scripts/release-notes.mjs v<version>');
  process.exit(1);
}

const releases = readFileSync('trip/docs/RELEASES.md', 'utf-8');
const lines = releases.split('\n');
const start = findReleaseHeadingIndex(lines, tag);

if (start === -1) {
  console.error(`No "## " heading carries ${tag} as a whole token in trip/docs/RELEASES.md.`);
  process.exit(1);
}

let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
if (end === -1) end = lines.length;

const body = lines.slice(start, end);
// Entries are separated by a blank line and a "---" line; drop both so the release notes
// don't end with a stray horizontal rule.
while (body.length && ['', '---'].includes(body[body.length - 1].trim())) body.pop();

process.stdout.write(body.join('\n').trim() + '\n');
