'use client';

// Next 15: an `ssr:false` dynamic import is only legal inside a client module — same shape as
// app/trips/sections.tsx and app/recap/sections.tsx, and the same two reasons. The stamp board
// reads localStorage (the lifetime visit set, key 32) so it has no meaningful server render, and
// keeping it behind a dynamic import keeps its chunk out of every other route's First Load JS.
//
// The parchment SHEET itself is not in here: it is static markup in the Server Component page, so
// the <h1>, the page material and the empty-state copy are all in the prerendered HTML and the
// island supplies only the part that depends on this device.
import dynamic from 'next/dynamic';

export const PassportStamps = dynamic(() => import('@/components/passport-stamps'), { ssr: false });
