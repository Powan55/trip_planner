/**
 * Travel Inspiration content — the curated gallery behind Home's `#inspiration`
 * section (`components/travel-inspiration.tsx`).
 *
 * It is a normal content domain and carries the whole standard shape: ONE data file
 * here, one strict authoring schema (`core/content/schema.ts` →
 * `inspirationHighlightSchema`), one case in the validator
 * (`lib/__tests__/content-validation.test.ts`), one row in the runbook table
 * (`docs/trip-content.md`, the edit-map table). Edit this file, run
 * `npm run validate:content`, done.
 *
 * STATIC AND CURATED ON PURPOSE. No API, no key, no quota, nothing that can go stale
 * or start billing — the same stance the rest of the content layer takes.
 *
 * IMAGERY. Every `image` is an asset ALREADY bundled in this repo under
 * `public/images/` and already attributed in `public/images/CREDITS.md`. This section
 * adds no new asset and hotlinks nothing; it surfaces photography the app was already
 * shipping but only ever showed on the guide pages. The validator asserts each path is
 * a real `lib/image-manifest.json` key, so a typo can never quietly degrade a card to
 * its gradient fallback.
 *
 * TWO TEXTS, TWO JOBS. `alt` describes the PHOTOGRAPH (it is what a screen-reader user
 * gets instead of the picture) and `blurb` describes the EXPERIENCE. They are
 * deliberately not the same sentence, and `alt` is never just the title again.
 *
 * DATES LIVE IN THE ITINERARY, NOT HERE. `when` is a time-of-day mood ('After dark'),
 * never a calendar date — `core/content/itinerary.ts` owns which day anything happens
 * on, and duplicating a date here would be a second source of truth that silently rots.
 */

export interface InspirationHighlight {
  /** Stable id, unique within this collection. */
  id: string;
  /** Card headline. */
  title: string;
  country: 'Nepal' | 'Japan';
  /** Time-of-day kicker, e.g. 'After dark'. Never a calendar date. */
  when: string;
  /** One line on why this is worth the flight. */
  blurb: string;
  /** Bundled asset path — must be a key of `lib/image-manifest.json`. */
  image: string;
  /** Descriptive alt text for the photograph itself. */
  alt: string;
}

/** Trip order: the Nepal leg first, then Japan. */
export const INSPIRATION_HIGHLIGHTS: InspirationHighlight[] = [
  {
    id: 'insp-boudhanath',
    title: 'Sunset kora at Boudhanath',
    country: 'Nepal',
    when: 'At dusk',
    blurb:
      'Join the evening circuit around one of the largest stupas on earth — butter lamps, prayer wheels, and a whole neighbourhood walking clockwise.',
    image: '/images/photography/ps3.jpg',
    alt: "The white dome and gilded spire of Boudhanath stupa, the Buddha's painted eyes below strings of prayer flags radiating out against a blue sky.",
  },
  {
    id: 'insp-asan',
    title: 'Asan bazaar at full tilt',
    country: 'Nepal',
    when: 'Early morning',
    blurb:
      'Six lanes of the old Tibet trade route meet at one junction. Spices, brass, bicycles and bargaining — the best street photography in Kathmandu.',
    image: '/images/photography/ps6.jpg',
    alt: 'A crowded junction in Asan bazaar, Kathmandu, filled with shoppers, market stalls and rickshaws around a tall woven bamboo chariot.',
  },
  {
    id: 'insp-bhaktapur',
    title: 'Bhaktapur, still medieval',
    country: 'Nepal',
    when: 'A whole day',
    blurb:
      'Car-free brick lanes, the five-tiered Nyatapola, potters spinning clay in the open air, and a bowl of juju dhau to finish.',
    image: '/images/nepal/na6.jpg',
    alt: 'The wide brick-paved expanse of Bhaktapur Durbar Square, ringed by tiered pagoda temples and the arcaded royal palace under piled clouds.',
  },
  {
    id: 'insp-chandragiri',
    title: 'Over the rim to Chandragiri',
    country: 'Nepal',
    when: 'A clear morning',
    blurb:
      'A few minutes of cable lifts you over the forested valley rim to a ridge-top view — December is the month the Himalaya actually shows up.',
    image: '/images/nepal/na18.jpg',
    alt: 'A red cable car on the Chandragiri line crossing forested ridges high above the haze-filled Kathmandu Valley.',
  },
  {
    id: 'insp-fushimi',
    title: 'Dawn at Fushimi Inari',
    country: 'Japan',
    when: 'First light',
    blurb:
      'Arrive before the crowds and the gate tunnels are yours — thousands of vermilion torii climbing the mountain in near silence.',
    image: '/images/photography/ps5.jpg',
    alt: 'A curving tunnel of vermilion torii gates at Fushimi Inari, their pillars inscribed in black, with a lantern hanging over the empty stone path.',
  },
  {
    id: 'insp-teamlab',
    title: 'Walking into teamLab',
    country: 'Japan',
    when: 'Afternoon',
    blurb:
      'Rooms you step inside rather than look at: mirrored floors, light with no edges, and no two minutes the same.',
    image: '/images/japan/ja8.jpg',
    alt: 'Visitors silhouetted in a dark mirrored room crossed by thousands of fine white beams of light at a teamLab installation.',
  },
  {
    id: 'insp-shibuya',
    title: 'The Shibuya scramble',
    country: 'Japan',
    when: 'After dark',
    blurb:
      'A thousand people crossing at once under six storeys of moving billboards. Watch it from above first, then walk straight through it.',
    image: '/images/photography/ps4.jpg',
    alt: 'Shibuya at night seen from above: illuminated billboards and glass towers around a crossing packed with people.',
  },
  {
    id: 'insp-dotonbori',
    title: 'Dotonbori neon on the water',
    country: 'Japan',
    when: 'Night',
    blurb:
      "Osaka's canal-side wall of signs — the Glico runner, the takoyaki queues, and the entire thing doubled in the water below.",
    image: '/images/japan/ja12.jpg',
    alt: 'The Dotonbori canal in Osaka at night, walls of neon signs on both banks reflecting in colour on the water.',
  },
];
