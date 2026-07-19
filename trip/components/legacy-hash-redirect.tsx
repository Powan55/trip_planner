'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { scrollToSectionWhenReady } from '@/lib/scroll-to-hash';

/**
 * Legacy v1 anchor deep-link redirects. Mounted on HOME only.
 *
 * v1 was a single page of anchored sections, so old links look like `/#nepal`.
 * v2 splits those sections across five routes. On load, this island maps
 * a legacy hash to its new home:
 *
 * #itinerary → /plan/ #photography → /nepal/#photography
 * #nepal → /nepal/ #nightlife → /nepal/#nightlife
 * #japan → /japan/ #flights → /flights/
 * #map → /map/
 *
 * via `router.replace` (no history entry for the dead URL — basePath-agnostic,
 *). Hashes whose sections still live on Home (#hero/#dashboard/#timeline/
 * #inspiration — inspiration is now the travel-essentials section, which
 * keeps the `inspiration` id) scroll locally; an unknown hash no-ops harmlessly.
 *
 * Scrolling goes through `scrollToSectionWhenReady` because every section is a
 * `dynamic({ssr:false})` island — the target does not exist at effect time. For
 * the cross-route cases the poll is deliberately NOT tied to this component's
 * lifetime: the redirect unmounts Home (and this island with it), and the bounded
 * poll must survive that to scroll the sub-anchor once the destination mounts.
 */

const ROUTE_REDIRECTS: Record<string, string> = {
  itinerary: '/plan/',
  nepal: '/nepal/',
  japan: '/japan/',
  map: '/map/',
  photography: '/nepal/#photography',
  nightlife: '/nepal/#nightlife',
  flights: '/flights/',
};

const LOCAL_ANCHORS = new Set(['hero', 'dashboard', 'timeline', 'inspiration']);

export default function LegacyHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;

    const target = ROUTE_REDIRECTS[hash];
    if (target) {
      router.replace(target);
      const hashIdx = target.indexOf('#');
      if (hashIdx !== -1) {
        // Fire-and-forget on purpose (see header comment): Home unmounts on the
        // replace, so returning this canceler as cleanup would kill the scroll.
        scrollToSectionWhenReady(target.slice(hashIdx + 1));
      }
      return;
    }

    if (LOCAL_ANCHORS.has(hash)) {
      // Local scroll — we stay on Home, so tie the poll to this island's lifetime.
      return scrollToSectionWhenReady(hash);
    }
    // Unknown hash → no-op.
  }, [router]);

  return null;
}
