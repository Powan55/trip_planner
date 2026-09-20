/** Escape a literal release tag before placing it in a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Index of the first `## ` heading carrying `tag` as a whole token, or -1.
 * Markdown emphasis is ignored so held and ordinary headings use the same match.
 */
export function findReleaseHeadingIndex(lines, tag) {
  const tagToken = new RegExp(
    `(^|[^0-9A-Za-z.-])${escapeRegExp(tag)}([^0-9A-Za-z.-]|$)`,
  );
  return lines.findIndex(
    (line) => line.startsWith('## ') && tagToken.test(line.replace(/\*\*/g, '')),
  );
}
