// Extracts one version's RELEASES.md entry body, for the GitHub Release deploy.yml creates
// right after tagging. Heading match mirrors scripts/release-gate.mjs exactly, so "which
// entry is this version's" can never disagree between the gate and what ships as the
// release's own notes.

import { readFileSync } from 'node:fs';

const tag = process.argv[2];
if (!tag) {
  console.error('usage: node scripts/release-notes.mjs v<version>');
  process.exit(1);
}

const releases = readFileSync('trip/docs/RELEASES.md', 'utf-8');
const tagToken = new RegExp(`(^|[^0-9A-Za-z.-])${tag.replace(/\./g, '\\.')}([^0-9A-Za-z.-]|$)`);
const lines = releases.split('\n');
const start = lines.findIndex((line) => line.startsWith('## ') && tagToken.test(line.replace(/\*\*/g, '')));

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
