import { isGooglePlaceUrl } from '@/core/places/model';
import type { ShareItem } from '@/core/share/model';

/** The URL to offer for place import; an explicit share URL always takes precedence. */
export function sharePlaceUrl(item: Pick<ShareItem, 'url' | 'text'>): string | undefined {
  if (item.url) return item.url;

  // Android share targets commonly put a sentence and a Maps link in `text` only.
  // Keep commas inside Maps URLs, but remove punctuation around a link in prose.
  for (const match of item.text?.matchAll(/https:\/\/[^\s<>"'`]+/gi) ?? []) {
    const candidate = match[0].replace(/[.,!?;:)}\]]+$/, '');
    if (isGooglePlaceUrl(candidate)) return candidate;
  }
  return undefined;
}
