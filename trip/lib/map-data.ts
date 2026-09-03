// Interactive-map data. The map is now a REAL MapLibre GL map (
// superseded), so every marker carries genuine WGS84 `lng`/`lat` for a famous,
// well-known place. This is a PURE data module — no imports with side effects —
// so it stays dormant-safe and tree-shakeable (map-section.tsx is the only
// consumer that mounts the GL canvas, and it does so client-only).
//
// The legacy `x`/`y` fields (0-100 % positions on the former CSS/SVG mock panel)
// are kept as harmless, unused metadata; nothing renders them once the mock is
// gone. `lng`/`lat` are the source of truth for placement now.

export type MarkerCategory =
  | 'Attraction'
  | 'Restaurant'
  | 'Hotel'
  | 'Photo Spot'
  | 'Day Trip'
  | 'Shopping'
  | 'Cultural';

export interface MapMarker {
  id: string;
  name: string;
  category: MarkerCategory;
  /** A leg's `legLabel()` — `'Nepal'` / `'Japan'` on the default pack, a custom trip's own
   * destinations label (or `''` for a bare world-search point) on a custom trip. */
  country: string;
  area: string;
  description: string;
  /** Real longitude. Source of truth for map placement. */
  lng: number;
  /** Real latitude. Source of truth for map placement. */
  lat: number;
  /** Legacy 0-100 % X on the former mock panel — unused, kept harmless. */
  x: number;
  /** Legacy 0-100 % Y on the former mock panel — unused, kept harmless. */
  y: number;
  /** Optional bundled photo for the popup. */
  image?: string;
}

export const MARKER_CATEGORIES: MarkerCategory[] = [
  'Attraction',
  'Restaurant',
  'Hotel',
  'Photo Spot',
  'Day Trip',
  'Shopping',
  'Cultural',
];

export const MAP_MARKERS: MapMarker[] = [
  // ── Nepal — Kathmandu Valley ──────────────────────────────────────────────
  {
    id: 'np-boudhanath', image: '/images/map/np-boudhanath.jpg',
    name: 'Boudhanath Stupa',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Boudha, Kathmandu',
    description:
      'One of the largest spherical stupas in the world and a UNESCO World Heritage Site, ringed by Tibetan monasteries and the constant turn of prayer wheels.',
    lng: 85.3620, lat: 27.7215,
    x: 68, y: 30,
  },
  {
    id: 'np-swayambhunath', image: '/images/map/np-swayambhunath.jpg',
    name: 'Swayambhunath (Monkey Temple)',
    category: 'Attraction',
    country: 'Nepal',
    area: 'West Kathmandu',
    description:
      'A hilltop stupa with the watchful eyes of the Buddha gazing over the valley. A steep 365-step climb rewards you with sweeping city panoramas.',
    lng: 85.2904, lat: 27.7149,
    x: 24, y: 38,
  },
  {
    id: 'np-pashupatinath', image: '/images/map/np-pashupatinath.jpg',
    name: 'Pashupatinath Temple',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Gaushala, Kathmandu',
    description:
      'The most sacred Hindu temple complex on the banks of the Bagmati River, dedicated to Lord Shiva and alive with sadhus and evening aarti rituals.',
    lng: 85.3488, lat: 27.7104,
    x: 74, y: 44,
  },
  {
    id: 'np-durbar-ktm', image: '/images/map/np-durbar-ktm.jpg',
    name: 'Kathmandu Durbar Square',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Old City, Kathmandu',
    description:
      'A historic royal plaza of pagoda temples, courtyards, and the Kumari Ghar — home of Nepal’s living goddess. A UNESCO site at the heart of the old city.',
    lng: 85.3072, lat: 27.7043,
    x: 42, y: 50,
  },
  {
    id: 'np-thamel', image: '/images/map/np-thamel.jpg',
    name: 'Thamel Bazaar',
    category: 'Shopping',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'The buzzing tourist quarter packed with trekking gear, pashmina, singing bowls, thangka art, and souvenir stalls. Best haggled at after dusk.',
    lng: 85.3110, lat: 27.7154,
    x: 38, y: 40,
  },
  {
    id: 'np-garden-dreams',
    name: 'Garden of Dreams',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'Kaiser Mahal, Kathmandu',
    description:
      'A restored neo-classical garden oasis of pavilions, fountains, and pergolas — a serene, photogenic escape from the city bustle.',
    lng: 85.3159, lat: 27.7143,
    x: 46, y: 34,
  },
  {
    id: 'np-patan', image: '/images/map/np-patan.jpg',
    name: 'Patan Durbar Square',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Lalitpur',
    description:
      'A masterpiece of Newari architecture with the Krishna Mandir and the Patan Museum — arguably the finest of the valley’s three durbar squares.',
    lng: 85.3253, lat: 27.6727,
    x: 50, y: 66,
  },
  {
    id: 'np-bhaktapur', image: '/images/map/np-bhaktapur.jpg',
    name: 'Bhaktapur Durbar Square',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Bhaktapur',
    description:
      'A perfectly preserved medieval city of brick streets, the 55-Window Palace, and Nyatapola Temple. Famous for juju dhau (king curd) and pottery.',
    lng: 85.4281, lat: 27.6721,
    x: 86, y: 58,
  },
  {
    id: 'np-nagarkot', image: '/images/map/np-nagarkot.jpg',
    name: 'Nagarkot Viewpoint',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Nagarkot (~32 km)',
    description:
      'A ridge-top village famous for sunrise panoramas over the Himalaya, including glimpses of Everest on clear winter mornings. A classic valley day trip.',
    lng: 85.5206, lat: 27.7154,
    x: 92, y: 22,
  },
  {
    id: 'np-newa-kitchen', image: '/images/map/np-newa-kitchen.jpg',
    name: 'Newa Lahana',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Kirtipur',
    description:
      'A community-run Newari kitchen serving an authentic platter of choila, bara, and chhoyla — the most traditional way to taste valley cuisine. Brews its own thwo; the top floor looks across to the Chandragiri ridge.',
    // Re-geocoded from a two-source lookup with a district sanity check. The old
    // 85.2774/27.6786 sat ~293 m away, and a second row for the same restaurant was briefly
    // added at this coordinate before being folded back in here.
    lng: 85.2744585, lat: 27.6789921,
    x: 30, y: 60,
  },
  {
    id: 'np-yangling', image: '/images/map/np-yangling.jpg',
    name: 'Yangling Tibetan Restaurant',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'A beloved Thamel institution for steaming plates of momos and thukpa — hearty, warming fare perfect for a December evening.',
    lng: 85.3126, lat: 27.7139,
    x: 36, y: 46,
  },
  {
    id: 'np-dwarikas',
    name: "Dwarika's Hotel",
    category: 'Hotel',
    country: 'Nepal',
    area: 'Battisputali, Kathmandu',
    description:
      'A heritage luxury hotel built around a living museum of rescued Newari woodcarving — an immersion in Nepali craftsmanship and a base near Pashupatinath.',
    lng: 85.3452, lat: 27.7061,
    x: 66, y: 52,
  },
  {
    id: 'np-kopan', image: '/images/map/np-kopan.jpg',
    name: 'Kopan Monastery',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'North Kathmandu',
    description:
      'A hillside Tibetan Buddhist monastery with gardens and golden rooftops overlooking Boudha — luminous at sunrise and wonderfully peaceful.',
    lng: 85.3641, lat: 27.7431,
    x: 70, y: 16,
  },
  {
    id: 'np-pottery-square', image: '/images/map/np-pottery-square.jpg',
    name: 'Bhaktapur Pottery Square',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'Talako Tole, Bhaktapur',
    description:
      'A working potters\' quarter five minutes south of Bhaktapur Durbar Square where black-clay pots dry in rings on the open brick and straw-fired kilns smoke at the edges.',
    lng: 85.4277012, lat: 27.6699005,
    x: 0, y: 0,
  },
  {
    id: 'np-dharahara', image: '/images/map/np-dharahara.jpg',
    name: 'Dharahara Observation Deck',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Sundhara, Kathmandu',
    description:
      'The rebuilt Bhimsen Tower, with an open-air viewing deck on the 20th floor giving a 360 over the old city and the Himalaya beyond on a clear morning.',
    lng: 85.3119, lat: 27.7007,
    x: 0, y: 0,
  },
  {
    id: 'np-rani-pokhari', image: '/images/map/np-rani-pokhari.jpg',
    name: 'Rani Pokhari',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'Jamal, Kathmandu',
    description:
      'A 17th-century tank in downtown Kathmandu with a white shikhara temple alone in the water, reopened to the public daily and free in March 2025.',
    lng: 85.3154, lat: 27.7078,
    x: 0, y: 0,
  },
  {
    id: 'np-itum-bahal',
    name: 'Itum Bahal',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Itum Bahal, Kathmandu',
    description:
      'The largest Newar Buddhist monastery courtyard in the old city, entered through an unmarked doorway on the walk between Thamel and Durbar Square.',
    lng: 85.3083304, lat: 27.7066603,
    x: 0, y: 0,
  },
  {
    id: 'np-nag-bahal', image: '/images/map/np-nag-bahal.jpg',
    name: 'Nag Bahal',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Nagbahal, Lalitpur',
    description:
      'A wide brick courtyard with chaityas and a sunken stone hiti just north of Patan Durbar Square, beside the Golden Temple.',
    lng: 85.3239585, lat: 27.6758703,
    x: 0, y: 0,
  },
  {
    id: 'np-kailashnath-mahadev',
    name: 'Kailashnath Mahadev Statue',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Sanga',
    description:
      'A 44 m standing Shiva on the hilltop at the valley\'s eastern pass, 15 minutes past Bhaktapur on the Araniko Highway.',
    lng: 85.474109, lat: 27.6461439,
    x: 0, y: 0,
  },
  {
    id: 'np-bungamati',
    name: 'Bungamati',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Bungamati',
    description:
      'A Newar woodcarving town whose earthquake-flattened Rato Machhindranath temple was rebuilt and reconsecrated in 2025.',
    lng: 85.3021177, lat: 27.6296539,
    x: 0, y: 0,
  },
  {
    id: 'np-khokana', image: '/images/map/np-khokana.jpg',
    name: 'Khokana',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Khokana',
    description:
      'A UNESCO tentative-list village 20 minutes from Bungamati, still pressing mustard oil on a Malla-era wooden beam press.',
    lng: 85.299034, lat: 27.635887,
    x: 0, y: 0,
  },
  {
    id: 'np-kirtipur', image: '/images/map/np-kirtipur.jpg',
    name: 'Kirtipur Old Town & Uma Maheshwor Hill',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Kirtipur',
    description:
      'A fortified Newar hill town with a 1,520 m temple knoll giving a 360 over the valley, with fog below and Langtang above on clear December mornings.',
    lng: 85.2747032, lat: 27.6799481,
    x: 0, y: 0,
  },
  {
    id: 'np-panauti', image: '/images/map/np-panauti.jpg',
    name: 'Panauti',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Panauti',
    description:
      'A medieval Newar town beyond Banepa holding the 1294 CE Indreshwar Mahadev, one of the oldest surviving pagoda temples in Nepal.',
    lng: 85.51746, lat: 27.58518,
    x: 0, y: 0,
  },
  {
    id: 'np-vajrayogini-sankhu',
    name: 'Vajrayogini Temple, Sankhu',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Sankhu',
    description:
      'A gilded tantric goddess temple reached by roughly 500 stone steps through pine forest above the medieval town of Sankhu.',
    lng: 85.46715, lat: 27.74385,
    x: 0, y: 0,
  },
  {
    id: 'np-everest-flight',
    name: 'Everest Experience Mountain Flight',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Sinamangal, Kathmandu',
    description:
      'Departure point for the one-hour Himalayan sightseeing flight - the DOMESTIC terminal, about 600 m north of the international one.',
    lng: 85.3595372, lat: 27.7024087,
    x: 0, y: 0,
  },
  {
    id: 'np-chitlang',
    name: 'Chitlang',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Chitlang, Makwanpur',
    description:
      'A Newar village over the Chandragiri ridge, reached by cable car and a two-hour downhill walk out of the Kathmandu Valley.',
    lng: 85.174042, lat: 27.65328,
    x: 0, y: 0,
  },
  {
    id: 'np-tu-cricket-ground',
    name: 'TU International Cricket Ground',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Kirtipur',
    description:
      'Nepal\'s national cricket ground on the Tribhuvan University campus at Kirtipur - about 13,000 seats, floodlit since November 2025, a 15-minute walk downhill from Kirtipur old town.',
    lng: 85.2906, lat: 27.6781,
    x: 0, y: 0,
  },
  {
    id: 'np-taragaon-next',
    name: 'Taragaon Next',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Boudha, Kathmandu',
    description:
      'A contemporary art space inside Carl Pruscha\'s 1970s brick-vaulted modernist complex, 600 m west of Boudhanath Stupa.',
    lng: 85.35625, lat: 27.72048,
    x: 0, y: 0,
  },
  {
    id: 'np-mona',
    name: 'Museum of Nepali Art',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'Nepal\'s first private art museum, in the Kathmandu Guest House courtyard, showing paubha and thangka as art rather than souvenirs.',
    lng: 85.3097838, lat: 27.7150597,
    x: 0, y: 0,
  },
  {
    id: 'np-ram-mandir',
    name: 'Ram Mandir, Battisputali',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Battisputali, Kathmandu',
    description:
      'Kathmandu\'s principal Ram temple, 1 km from Pashupatinath, and the valley\'s focus for Bibaha Panchami on 14 December 2026.',
    lng: 85.340588, lat: 27.7066929,
    x: 0, y: 0,
  },
  {
    id: 'np-kumbheshwar-tech-school',
    name: 'Kumbheshwar Technical School',
    category: 'Shopping',
    country: 'Nepal',
    area: 'Chakupat, Lalitpur',
    description:
      'A WFTO-certified fair-trade workshop north of Patan Durbar Square where hand-knitting and carpet weaving happen in the building you buy from.',
    lng: 85.3262633, lat: 27.6774357,
    x: 0, y: 0,
  },
  {
    id: 'np-honacha',
    name: 'Honacha',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Mangal Bazar, Lalitpur',
    description:
      'A smoke-blackened bara shop behind Krishna Mandir, run by the same family for 60-70 years. Note a sister shop of the same name 20 m away.',
    lng: 85.3248, lat: 27.6737,
    x: 0, y: 0,
  },
  {
    id: 'np-aama-ko-bara',
    name: 'Aama ko Bara Pasal',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Taumadhi, Bhaktapur',
    description:
      'A two-metre shopfront beside Nyatapola serving bara since the early 1970s. Pin is landmark-derived to within 30-60 m - ask locally.',
    lng: 85.4291, lat: 27.6715,
    x: 0, y: 0,
  },
  {
    id: 'np-tukche-thakali',
    name: 'Tukche Thakali Kitchen',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Gairidhara, Kathmandu',
    description:
      'Family-run Thakali kitchen since 1997, named for Tukche in the Kali Gandaki. Distinct from the Thamel restaurant of a similar name.',
    lng: 85.3292929, lat: 27.7175,
    x: 0, y: 0,
  },
  {
    id: 'np-chez-caroline',
    name: 'Chez Caroline',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Baber Mahal, Kathmandu',
    description:
      'French bistro cooking in the courtyard of Baber Mahal Revisited, a restored Rana palace and stable complex, since 1997.',
    lng: 85.3229068, lat: 27.6943354,
    x: 0, y: 0,
  },
  {
    id: 'np-raithaane',
    name: 'Raithaane',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Kupondole, Lalitpur',
    description:
      'Regional Nepali cooking on heritage grains sourced direct from farmers, with a seasonally rotating menu. Closed Mondays.',
    lng: 85.3158816, lat: 27.6848914,
    x: 0, y: 0,
  },
  {
    id: 'np-tusa',
    name: 'Restaurant TUSA',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Nagpokhari, Bhaktapur',
    description:
      'A twelve-seat seven-course tasting room in a rebuilt Newari courtyard house, opened 2024 by a Noma-trained chef. Books weeks ahead.',
    lng: 85.4334, lat: 27.6738,
    x: 0, y: 0,
  },
  {
    id: 'np-le-sherpa',
    name: 'Le Sherpa & Farmers\' Market',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Maharajgunj, Kathmandu',
    description:
      'Farm-to-table restaurant whose lawn hosts a 40-vendor farmers\' market every Saturday 08:00-12:30.',
    lng: 85.3282287, lat: 27.7314619,
    x: 0, y: 0,
  },
  {
    id: 'np-karma-coffee',
    name: 'kar.ma Coffee',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Jhamsikhel, Lalitpur',
    description:
      'Nepal\'s benchmark third-wave roaster and hand-brew bar, on Level 2 of the Gyan Mandala building and invisible from the street.',
    lng: 85.311, lat: 27.6776,
    x: 0, y: 0,
  },
  {
    id: 'np-utpala-cafe',
    name: 'Utpala Cafe',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Boudha, Kathmandu',
    description:
      'Monastery-run vegetarian cafe with the best sunny walled garden in Boudha; hosts the Boudha Farmers Market on Saturdays.',
    lng: 85.3623, lat: 27.7246,
    x: 0, y: 0,
  },
  {
    id: 'np-coffee-beans',
    name: 'Coffee Beans Specialty Coffee',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Tushal, Kathmandu',
    description:
      'A bright upstairs specialty bar roasting its own single-origin lots, and the warm indoor alternative on a cold Boudha morning.',
    lng: 85.3586, lat: 27.7204,
    x: 0, y: 0,
  },
  {
    id: 'np-chikusa-cafe',
    name: 'Chikusa Cafe',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Jyatha, Kathmandu',
    description:
      'Open since 1998 and deliberately without an espresso machine - cloth-filter drip, moka pot and French press only.',
    lng: 85.3121, lat: 27.7119,
    x: 0, y: 0,
  },
  {
    id: 'np-pumpernickel',
    name: 'Pumpernickel Bakery',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'Baking since 1986, with the best walled garden in Thamel and a 06:30 opening - the earliest verified on this list.',
    lng: 85.3109, lat: 27.7148,
    x: 0, y: 0,
  },

  {
    id: 'np-budhanilkantha', image: '/images/map/np-budhanilkantha.jpg',
    name: 'Budhanilkantha Temple',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Budhanilkantha, Kathmandu',
    description:
      'A 5 m reclining Vishnu carved from a single block of black basalt, lying in a recessed water tank and generally held to be the largest stone sculpture in Nepal. It sits at the foot of the Shivapuri hills about 9 km north of Thamel.',
    lng: 85.36234, lat: 27.77813,
    x: 0, y: 0,
  },
  {
    id: 'np-changu-narayan', image: '/images/map/np-changu-narayan.jpg',
    name: 'Changu Narayan Temple',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Changunarayan',
    description:
      'A hilltop Vishnu temple on the Changu (Dolagiri) ridge and one of the seven monument zones of the Kathmandu Valley UNESCO World Heritage Site. Its stone pillar inscription of 464 CE is the oldest dated inscription in Nepal.',
    lng: 85.4279, lat: 27.71635,
    x: 0, y: 0,
  },
  {
    id: 'np-asan', image: '/images/map/np-asan.jpg',
    name: 'Asan Bazaar',
    category: 'Shopping',
    country: 'Nepal',
    area: 'Asan, Kathmandu',
    description:
      "The six-street junction at the heart of old Kathmandu's bazaar, on the historic trade route running between Durbar Square and Thamel. The Annapurna Ajima temple, dedicated to the goddess of grain, presides over the square, which is busiest in the early morning when the grain, spice and vegetable sellers set up.",
    lng: 85.31226, lat: 27.70748,
    x: 0, y: 0,
  },
  {
    id: 'np-pharping-asura',
    name: 'Pharping & Asura Cave',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Pharping',
    description:
      'Asura Cave is the hillside meditation cave above Pharping village where Padmasambhava is said to have attained realisation, and it is among the most visited Guru Rinpoche sites outside Tibet. The lower Yangleshö cave and the Shesh Narayan temple sit together on the main road below, and legend holds that a tunnel inside Asura connects the two.',
    lng: 85.26028, lat: 27.61325,
    x: 0, y: 0,
  },
  {
    id: 'np-chobhar-gorge',
    name: 'Chobhar Gorge',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Chobhar, Kirtipur',
    description:
      "Jal Binayak, one of the Kathmandu Valley's four principal Ganesh shrines, stands on the west bank of the Bagmati at the mouth of the Chobhar gorge, where legend says Manjushri cut the valley's ancient lake free. The Ganesh image emerges from a large natural boulder in the temple courtyard.",
    lng: 85.29318, lat: 27.65832,
    x: 0, y: 0,
  },
  {
    id: 'np-taudaha', image: '/images/map/np-taudaha.jpg',
    name: 'Taudaha Lake',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Taudaha, Kirtipur',
    description:
      "A small spring-fed lake on the Dakshinkali road about 1.5 km south-west of Chobhar, where Newar legend says the serpent king Karkotaka was settled after Manjushri drained the valley's lake. It is a quiet picnic and birdwatching spot that draws migratory waterbirds in winter.",
    lng: 85.28216, lat: 27.64877,
    x: 0, y: 0,
  },
  {
    id: 'np-shivapuri', image: '/images/map/np-shivapuri.jpg',
    name: 'Shivapuri National Park',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Budhanilkantha',
    description:
      'This pin is the Panimuhan Gate, the main southern entry post to Shivapuri Nagarjun National Park, where the ticket counter and park office sit at the head of the Budhanilkantha road. Trails to Shivapuri Peak, Bagdwar and the Bagmati source all start here, and an entry fee is collected at the gate.',
    lng: 85.3713672, lat: 27.7913866,
    x: 0, y: 0,
  },
  {
    id: 'np-phulchowki', image: '/images/nepal/na16.jpg',
    name: 'Phulchowki',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'Godavari',
    description:
      'This pin is the summit. At roughly 2,762-2,782 m it is the highest point on the Kathmandu Valley rim, topped by the Phulchowki Mai shrine, an army post and telecom masts. The summit is reached by a switchback road up from Godavari and gives a clear-morning panorama from the Annapurnas round to Gaurishankar.',
    lng: 85.4067119, lat: 27.5710397,
    x: 0, y: 0,
  },
  {
    id: 'np-chandragiri', image: '/images/nepal/na18.jpg',
    name: 'Chandragiri Hills Cable Car',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Thankot',
    description:
      'This pin is the BASE STATION, not the summit: the valley-floor terminal of the 2.5 km Chandragiri gondola, at about 1,570 m on the Chitlang road above Thankot, roughly 8 km west of Kalanki on the Tribhuvan Highway. Ticket counters, a small plaza and a 200-space customer car park sit at the station; the ride to the top takes 9-12 minutes.',
    lng: 85.2145851, lat: 27.6862072,
    x: 0, y: 0,
  },
  {
    id: 'np-dhulikhel', image: '/images/map/np-dhulikhel.jpg',
    name: 'Dhulikhel',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Dhulikhel',
    description:
      'The historic Newar quarter of Dhulikhel, about 30 km east of Kathmandu at roughly 1,550 m, built around a cluster of brick-and-timber temples — Harasiddhi, Krishna and Bhagwati — and traditional stone water spouts. It is the arrival point and the start of the walk up the ridge to the Kali shrine viewpoint.',
    lng: 85.5523, lat: 27.6184,
    x: 0, y: 0,
  },
  {
    id: 'np-namobuddha',
    name: 'Namo Buddha',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Namo Buddha',
    description:
      'This pin is Thrangu Tashi Yangtse Monastery, a large Kagyu monastery and shedra at about 1,750 m on a ridge in Kavrepalanchok, roughly 40 km southeast of Kathmandu, marking the site where the Buddha in a previous life is said to have offered his body to a starving tigress. Visitors can walk the grounds, and vegetarian meals are served to guests.',
    lng: 85.5827565, lat: 27.5712778,
    x: 0, y: 0,
  },
  {
    id: 'np-bhojan-griha',
    name: 'Bhojan Griha',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Dillibazar, Kathmandu',
    description:
      'A traditional Nepali set-menu restaurant in a restored 150-year-old Rana-era mansion that once housed the royal priest of the King of Nepal. Multi-course dal bhat with live folk music and dance; reservation recommended.',
    lng: 85.3253489, lat: 27.7065526,
    x: 0, y: 0,
  },
  {
    id: 'np-or2k',
    name: 'OR2K',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'An all-vegetarian Mediterranean and Middle Eastern restaurant in central Thamel, with low cushion seating, hand-painted walls and a rooftop terrace. Known for hummus, falafel and the mezze platters.',
    lng: 85.3110168, lat: 27.7148007,
    x: 0, y: 0,
  },
  {
    id: 'np-cafe-swotha',
    name: 'Cafe Swotha',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Swotha, Lalitpur',
    description:
      'Newari and continental cooking in the courtyard of a restored Newar family house on Swotha Square, in a quiet lane just off Patan Durbar Square. It is the cafe of the Traditional Homes Swotha guest house, which opened in December 2010.',
    lng: 85.3258481, lat: 27.6743349,
    x: 0, y: 0,
  },
  {
    id: 'np-roadhouse-thamel',
    name: 'Roadhouse Cafe (Thamel)',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      "Wood-fired pizza and a craft-beer list in a busy two-storey room with a garden patio at the back, in the middle of Thamel. The group's own site calls this the first and original Roadhouse.",
    lng: 85.3103329, lat: 27.7143996,
    x: 0, y: 0,
  },
  {
    id: 'np-himalayan-java-thamel',
    name: 'Himalayan Java (Tridevi Marg)',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      "The flagship outlet of Nepal's home-grown coffee chain, on the Tridevi Marg approach to Thamel beside the Garden of Dreams, using beans grown in the Nepali hills. It is also the chain's head office and barista school address.",
    lng: 85.31392, lat: 27.7140252,
    x: 0, y: 0,
  },

  // ── Japan — Tokyo · Kyoto · Osaka ─────────────────────────────────────────
  {
    id: 'jp-sensoji', image: '/images/map/jp-sensoji.jpg',
    name: 'Senso-ji Temple',
    category: 'Cultural',
    country: 'Japan',
    area: 'Asakusa, Tokyo',
    description:
      'Tokyo’s oldest temple, entered through the giant Kaminarimon lantern gate and the Nakamise shopping street. Atmospheric and lantern-lit at night.',
    lng: 139.7967, lat: 35.7148,
    x: 78, y: 26,
  },
  {
    id: 'jp-shibuya', image: '/images/map/jp-shibuya.jpg',
    name: 'Shibuya Crossing',
    category: 'Attraction',
    country: 'Japan',
    area: 'Shibuya, Tokyo',
    description:
      'The world’s busiest pedestrian scramble, a neon-soaked icon of Tokyo. Best viewed from above at the Shibuya Sky observation deck.',
    lng: 139.7005, lat: 35.6595,
    x: 72, y: 36,
  },
  {
    id: 'jp-akihabara', image: '/images/map/jp-akihabara.jpg',
    name: 'Akihabara Electric Town',
    category: 'Shopping',
    country: 'Japan',
    area: 'Akihabara, Tokyo',
    description:
      'The electric heart of anime, gaming, and gadgets — towers of arcades, retro game shops, and multi-floor electronics emporiums.',
    lng: 139.7714, lat: 35.6984,
    x: 80, y: 32,
  },
  {
    id: 'jp-ichiran', image: '/images/map/jp-ichiran.jpg',
    name: 'Ichiran Ramen',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Shinjuku, Tokyo',
    description:
      'Tonkotsu ramen perfected in solo focus booths — customize richness, spice, and noodle firmness, then slurp in distraction-free bliss.',
    lng: 139.7038, lat: 35.6919,
    x: 68, y: 30,
  },
  {
    id: 'jp-park-hyatt', image: '/images/map/jp-park-hyatt.jpg',
    name: 'Park Hyatt Tokyo',
    category: 'Hotel',
    country: 'Japan',
    area: 'Shinjuku, Tokyo',
    description:
      'A sky-high luxury landmark (of Lost in Translation fame) with floor-to-ceiling skyline views — a polished base for exploring central Tokyo.',
    lng: 139.6905, lat: 35.6857,
    x: 60, y: 40,
  },
  {
    id: 'jp-teamlab',
    name: 'teamLab Planets',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Toyosu, Tokyo',
    description:
      'An immersive digital-art museum of infinite mirrored light gardens and water rooms — one of the most photogenic experiences in the city.',
    // Was 139.7900/35.6488, which is Shin-Toyosu Station, ~60 m short of the museum entrance.
    lng: 139.78973, lat: 35.64938,
    x: 84, y: 42,
  },
  {
    id: 'jp-fushimi', image: '/images/map/jp-fushimi.jpg',
    name: 'Fushimi Inari Taisha',
    category: 'Cultural',
    country: 'Japan',
    area: 'Fushimi, Kyoto',
    description:
      'The shrine of a thousand vermilion torii gates winding up Mount Inari. Go early to walk the tunnels of gates in golden morning light.',
    lng: 135.7727, lat: 34.9671,
    x: 30, y: 60,
  },
  {
    id: 'jp-arashiyama', image: '/images/map/jp-arashiyama.jpg',
    name: 'Arashiyama Bamboo Grove',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Arashiyama, Kyoto',
    description:
      'A towering green corridor of swaying bamboo on Kyoto’s western edge, paired with the Togetsukyo Bridge and Tenryu-ji temple gardens.',
    lng: 135.6716, lat: 35.0170,
    x: 18, y: 54,
  },
  {
    id: 'jp-kinkakuji', image: '/images/map/jp-kinkakuji.jpg',
    name: 'Kinkaku-ji (Golden Pavilion)',
    category: 'Attraction',
    country: 'Japan',
    area: 'North Kyoto',
    description:
      'A gold-leaf Zen pavilion mirrored in its reflecting pond — Kyoto’s most iconic image, dusted with light frost in winter.',
    lng: 135.7292, lat: 35.0394,
    x: 26, y: 48,
  },
  {
    id: 'jp-nishiki', image: '/images/map/jp-nishiki.jpg',
    name: 'Nishiki Market',
    category: 'Shopping',
    country: 'Japan',
    area: 'Central Kyoto',
    description:
      'Kyoto’s "kitchen" — a narrow 400-year-old arcade of stalls selling pickles, tofu, sweets, knives, and street snacks.',
    lng: 135.7649, lat: 35.0050,
    x: 34, y: 52,
  },
  {
    id: 'jp-dotonbori', image: '/images/map/jp-dotonbori.jpg',
    name: 'Dotonbori',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Namba, Osaka',
    description:
      'Osaka’s neon canal-side food strip — takoyaki, okonomiyaki, and the running Glico man sign. The capital of kuidaore ("eat till you drop").',
    lng: 135.5011, lat: 34.6687,
    x: 40, y: 80,
  },
  {
    id: 'jp-osaka-castle', image: '/images/map/jp-osaka-castle.jpg',
    name: 'Osaka Castle',
    category: 'Attraction',
    country: 'Japan',
    area: 'Chuo-ku, Osaka',
    description:
      'A grand reconstructed feudal castle ringed by moats and a park of plum and cherry trees, with a panoramic observation deck on top.',
    lng: 135.5259, lat: 34.6873,
    x: 48, y: 74,
  },
  {
    id: 'jp-nara', image: '/images/map/jp-nara.jpg',
    name: 'Nara Deer Park',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Nara (~45 min from Kyoto)',
    description:
      'Free-roaming bowing deer, the colossal Great Buddha of Todai-ji, and lantern-lined paths — an easy and unforgettable day trip from Kyoto or Osaka.',
    lng: 135.8430, lat: 34.6851,
    x: 44, y: 64,
  },
  {
    id: 'jp-hakone', image: '/images/map/jp-hakone.jpg',
    name: 'Hakone',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Hakone (~85 min from Tokyo)',
    description:
      'A hot-spring retreat with Mt. Fuji views, the Hakone open-air sculpture museum, and a pirate-ship cruise on Lake Ashi — a scenic escape from Tokyo.',
    lng: 139.1069, lat: 35.2324,
    x: 58, y: 46,
  },

  // ── Japan — Osaka ─────────────────────────────────────────────────────────
  {
    id: 'jp-kaiyukan', image: '/images/map/jp-kaiyukan.jpg',
    name: 'Osaka Aquarium Kaiyukan',
    category: 'Attraction',
    country: 'Japan',
    area: 'Tempozan, Osaka',
    description:
      'A spiral-descent aquarium built around a 9 m-deep central Pacific tank holding whale sharks. The Tempozan ferris wheel and the harbour ferry terminal share the same quay.',
    lng: 135.42892, lat: 34.65455,
    x: 0, y: 0,
  },

  // ── Japan — Nara ──────────────────────────────────────────────────────────
  {
    id: 'jp-todaiji', image: '/images/map/jp-todaiji.jpg',
    name: 'Todai-ji Daibutsuden (Great Buddha Hall)',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Nara Park, Nara',
    description:
      'The largest wooden temple hall in the world, holding a 15 m bronze Buddha cast in 752. The deer come right up the approach path to the Nandaimon gate, which is where most of the photographs happen.',
    lng: 135.83987, lat: 34.68907,
    x: 0, y: 0,
  },
  {
    id: 'jp-nakatanidou',
    name: 'Nakatanidou',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Sanjo-dori, Nara',
    description:
      'A mochi shop that pounds yomogi mochi in the street outside, two people swinging a mallet at speed while a crowd films it. The kusa-mochi is sold warm, one piece at a time, from the counter.',
    lng: 135.82886, lat: 34.68193,
    x: 0, y: 0,
  },

  // ── Japan — Himeji & Kobe ─────────────────────────────────────────────────
  {
    id: 'jp-himeji-castle', image: '/images/map/jp-himeji-castle.jpg',
    name: 'Himeji Castle',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Himeji, Hyogo',
    description:
      'The one large Japanese castle that came through the war and the fires intact — 83 original wooden structures around a six-floor keep, white-plastered and visible from the station down a straight 1 km avenue. You climb the keep in socks on the original stairs.',
    lng: 134.69402, lat: 34.83933,
    x: 0, y: 0,
  },
  {
    id: 'jp-nunobiki-herb', image: '/images/map/jp-nunobiki-herb.jpg',
    name: 'Kobe Nunobiki Herb Gardens & Ropeway',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Kitano, Kobe',
    description:
      'A ten-minute glass-sided gondola from a base station five minutes from Shin-Kobe, climbing over Nunobiki Falls to terraced gardens and a viewing deck. The city and the harbour sit directly below the top station.',
    lng: 135.19234, lat: 34.71506,
    x: 0, y: 0,
  },
  {
    id: 'jp-weathercock-house',
    name: 'Weathercock House (Kazamidori no Yakata)',
    category: 'Cultural',
    country: 'Japan',
    area: 'Kitano, Kobe',
    description:
      'A red-brick 1909 merchant house with a weathervane on the spire, the only brick building among Kobe\'s surviving foreign residences. It sits at the top of the Kitano slope with the city falling away behind it.',
    lng: 135.18951, lat: 34.70139,
    x: 0, y: 0,
  },
  {
    id: 'jp-meriken-park', image: '/images/map/jp-meriken-park.jpg',
    name: 'Meriken Park',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Hatobacho, Kobe',
    description:
      'A harbour park holding the red lattice Port Tower, the white Maritime Museum frame and the BE KOBE letters on the quay. The 1995 earthquake memorial keeps a collapsed section of the original wharf in place.',
    lng: 135.18932, lat: 34.68331,
    x: 0, y: 0,
  },

  // ── Japan — Uji ───────────────────────────────────────────────────────────
  {
    id: 'jp-byodoin', image: '/images/map/jp-byodoin.jpg',
    name: 'Byodo-in',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Uji, Kyoto',
    description:
      'The Phoenix Hall of 1053, one of the few original Heian-period wooden buildings still standing, mirrored in the pond of its Pure Land garden. It is the building on the back of the ten-yen coin.',
    lng: 135.80745, lat: 34.88950,
    x: 0, y: 0,
  },
  {
    id: 'jp-nakamura-tokichi',
    name: 'Nakamura Tokichi Byodoin-ten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Byodo-in approach, Uji',
    description:
      'The Byodo-in branch of an 1854 Uji tea merchant, serving matcha jelly, soba and thick koicha in a room over the tea shop. Uji is where Japanese green tea was first grown commercially.',
    lng: 135.80663, lat: 34.89148,
    x: 0, y: 0,
  },

  // ── Japan — Kyoto ─────────────────────────────────────────────────────────
  {
    id: 'jp-kiyomizudera', image: '/images/map/jp-kiyomizudera.jpg',
    name: 'Kiyomizu-dera',
    category: 'Cultural',
    country: 'Japan',
    area: 'Higashiyama, Kyoto',
    description:
      'A hillside temple founded in 780 above the Otowa waterfall, best known for the wooden stage that projects out over the valley on a lattice of pillars. It opens at 06:00 and has no closing days.',
    lng: 135.78444, lat: 34.99430,
    x: 0, y: 0,
  },
  {
    id: 'jp-sannenzaka', image: '/images/map/jp-sannenzaka.jpg',
    name: 'Sannenzaka and Ninenzaka',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Higashiyama, Kyoto',
    description:
      'Two stone-stepped lanes of preserved wooden machiya linking Kiyomizu-dera down towards Kodai-ji, lined with tea shops and craft stores. The five-storey Yasaka Pagoda stands below the foot of Ninenzaka and closes most of the frames shot here.',
    lng: 135.78084, lat: 34.99845,
    x: 0, y: 0,
  },
  {
    id: 'jp-hanamikoji', image: '/images/map/jp-hanamikoji.jpg',
    name: 'Hanamikoji-dori',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Gion, Kyoto',
    description:
      'The main north-south lane through Gion, wooden teahouse fronts on both sides and paper lanterns lit from dusk. Photography is fined on the private side alleys and photographing geiko or maiko without consent is not allowed, so the shooting happens from the public street.',
    lng: 135.77485, lat: 35.00265,
    x: 0, y: 0,
  },
  {
    id: 'jp-saryo-tsujiri',
    name: 'Saryo Tsujiri Gion Honten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Gion, Kyoto',
    description:
      'The Gion flagship of an Uji tea house trading since 1860: a shop at street level on Shijo-dori and a tearoom above it, built around matcha parfaits, soft serve and thick-whisked tea. Queues are normal and move fastest in the last hour before closing.',
    lng: 135.77448, lat: 35.00370,
    x: 0, y: 0,
  },
  {
    id: 'jp-pontocho', image: '/images/map/jp-pontocho.jpg',
    name: 'Pontocho Alley',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Pontocho, Kyoto',
    description:
      'A single lane barely two metres wide between the Kamo River and Kiyamachi, packed with restaurants and small bars behind wooden fronts. A posted menu or an English sign is the signal that a place will seat walk-ins.',
    lng: 135.77121, lat: 35.00425,
    x: 0, y: 0,
  },
  {
    id: 'jp-manga-museum', image: '/images/map/jp-manga-museum.jpg',
    name: 'Kyoto International Manga Museum',
    category: 'Cultural',
    country: 'Japan',
    area: 'Karasuma-Oike, Kyoto',
    description:
      'A 1920s elementary school converted into a manga library, its corridors walled floor to ceiling with roughly 300,000 volumes that visitors can pull down and read. Most of the collection is Japanese-only, with a smaller shelf of translated works.',
    lng: 135.75918, lat: 35.01170,
    x: 0, y: 0,
  },
  {
    id: 'jp-nijo-castle', image: '/images/map/jp-nijo-castle.jpg',
    name: 'Nijo Castle',
    category: 'Cultural',
    country: 'Japan',
    area: 'Nakagyo, Kyoto',
    description:
      'The shogun\'s Kyoto residence, finished in 1603, ringed by two moats and entered through the carved Karamon gate. The draw is the Ninomaru Palace interior with its nightingale floors and Kano-school screens; the grounds on their own are a walk round a moat.',
    lng: 135.74854, lat: 35.01401,
    x: 0, y: 0,
  },
  {
    id: 'jp-tenryuji', image: '/images/map/jp-tenryuji.jpg',
    name: 'Tenryu-ji',
    category: 'Cultural',
    country: 'Japan',
    area: 'Arashiyama, Kyoto',
    description:
      'The head temple of its Rinzai branch, whose Sogenchi pond garden keeps a fourteenth-century layout and borrows the Arashiyama hills as its backdrop. The Cloud Dragon painted on the Hatto ceiling is a separate ticket and opens only at weekends and on holidays.',
    lng: 135.67294, lat: 35.01622,
    x: 0, y: 0,
  },
  {
    id: 'jp-togetsukyo', image: '/images/map/jp-togetsukyo.jpg',
    name: 'Togetsukyo Bridge',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Arashiyama, Kyoto',
    description:
      'A 155 m timber-clad bridge across the Katsura River at the mouth of the Hozu gorge, with the wooded Arashiyama slope filling the frame behind it. In late December the hills are bare and brown and the sun drops behind the ridge by about 16:00.',
    lng: 135.67776, lat: 35.01287,
    x: 0, y: 0,
  },
  {
    id: 'jp-monkey-park',
    // Iwatayama sits in the description rather than the name: the alias builder strips
    // "park" mid-string, and a name with it in the middle leaves a two-space hole no
    // itinerary text can ever contain.
    name: 'Arashiyama Monkey Park',
    category: 'Attraction',
    country: 'Japan',
    area: 'Arashiyama, Kyoto',
    description:
      'Monkey Park Iwatayama: about 120 wild macaques on the hillside above the Katsura River, reached by a 15-to-20-minute climb from the entrance beside Ichitani Munakata Shrine. Feeding happens from inside a caged hut at the top, and the summit clearing gives the widest open view over Kyoto anywhere in the city.',
    lng: 135.67673, lat: 35.01142,
    x: 0, y: 0,
  },
  {
    id: 'jp-kyoto-station', image: '/images/map/jp-kyoto-station.jpg',
    name: 'Kyoto Station Building and Nidec Kyoto Tower',
    category: 'Attraction',
    country: 'Japan',
    area: 'Shimogyo, Kyoto',
    description:
      'The 1997 station building is a 470 m glass and steel canyon with a 171-step Daikaidan staircase that runs a free LED light show through the evening, a rooftop Skyway walk and a ramen floor on 10F. The tower across the road puts an observation deck at 100 m, the one high vantage point in a city that caps building heights.',
    lng: 135.75933, lat: 34.98755,
    x: 0, y: 0,
  },
  {
    id: 'jp-inoda-coffee',
    name: 'Inoda Coffee Honten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Sakaimachi-dori, Kyoto',
    description:
      'A kissaten opened in 1940 around a courtyard garden, serving its own dark roast with the milk and sugar already stirred in unless you ask otherwise. It opens at 07:00 every day of the year, the earliest proper cafe in central Kyoto.',
    lng: 135.76319, lat: 35.00809,
    x: 0, y: 0,
  },
  {
    id: 'jp-daiichi-asahi',
    name: 'Honke Daiichi Asahi',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Takabashi, Kyoto',
    description:
      'A ramen shop trading since 1947 five minutes east of Kyoto Station, serving the local soy-and-pork-bone style under a sheet of sliced chashu and a pile of green onion. It opens at 06:00 and a queue forms before the shutter goes up.',
    lng: 135.76249, lat: 34.98669,
    x: 0, y: 0,
  },
  {
    id: 'jp-yudofu-sagano',
    name: 'Yudofu Sagano',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Arashiyama, Kyoto',
    description:
      'A tofu specialist beside Tenryu-ji serving the yudofu set as a simmering pot of silken tofu with sesame tofu, konnyaku sashimi and tempura around it, eaten looking onto a garden. The seating is tatami.',
    lng: 135.67479, lat: 35.01455,
    x: 0, y: 0,
  },
  {
    id: 'jp-giro-giro',
    name: 'Giro Giro Hitoshina',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Nishi-Kiyamachi, Kyoto',
    description:
      'A converted warehouse on the Takase canal serving a set kaiseki course at a fraction of the usual Kyoto price, plated in front of you at an open counter. The menu changes constantly and the room is loud rather than hushed.',
    lng: 135.76759, lat: 34.99826,
    x: 0, y: 0,
  },
  {
    id: 'jp-tempura-yoshikawa',
    name: 'Tempura Yoshikawa',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Tominokoji, Kyoto',
    description:
      'An eight-seat tempura counter inside a sukiya-style inn, where each piece is fried and handed across one at a time. Lunch at the counter is the short version of the course; the tatami rooms run a longer kaiseki.',
    lng: 135.76496, lat: 35.01030,
    x: 0, y: 0,
  },
  {
    id: 'jp-menami',
    name: 'Menami',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Kiyamachi, Kyoto',
    description:
      'An obanzai house trading for over eighty years on Kiyamachi, where the day\'s dishes sit in bowls along the counter and you order by pointing at them. Kyoto home cooking on seasonal vegetables, yuba and fish, meant to be eaten alongside sake rather than as a course.',
    lng: 135.77107, lat: 35.00915,
    x: 0, y: 0,
  },

  // ── Japan — Tokyo ─────────────────────────────────────────────────────────
  {
    id: 'jp-skytree', image: '/images/map/jp-skytree.jpg',
    name: 'Tokyo Skytree',
    category: 'Attraction',
    country: 'Japan',
    area: 'Oshiage, Tokyo',
    description:
      'At 634 m the tallest structure in Japan, with a Tembo Deck at 350 m and a spiral Tembo Galleria ramp at 450 m. It stands on the east bank of the Sumida, so the view looks back across the whole city rather than out of the middle of it.',
    lng: 139.81071, lat: 35.71005,
    x: 0, y: 0,
  },
  {
    id: 'jp-jump-shop',
    name: 'JUMP SHOP Tokyo Solamachi',
    category: 'Shopping',
    country: 'Japan',
    area: 'Oshiage, Tokyo',
    description:
      'The official Shonen Jump store, on the souvenir floor of the mall at the base of the Skytree. Stock is One Piece, Naruto, Dragon Ball, Jujutsu Kaisen and the rest of the Jump roster, much of it shop-exclusive.',
    lng: 139.81135, lat: 35.71020,
    x: 0, y: 0,
  },
  {
    id: 'jp-suzukien',
    name: 'Suzukien Asakusa Honten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Asakusa, Tokyo',
    description:
      'A tea merchant behind Senso-ji selling matcha gelato in seven graded strengths, from mild up to a No. 7 it bills as the richest in the world. It is a counter with a couple of stools, not a cafe.',
    lng: 139.79694, lat: 35.71638,
    x: 0, y: 0,
  },
  {
    id: 'jp-ameyoko', image: '/images/map/jp-ameyoko.jpg',
    name: 'Ameya-Yokocho (Ameyoko)',
    category: 'Shopping',
    country: 'Japan',
    area: 'Ueno, Tokyo',
    description:
      'A few hundred metres of open-fronted stalls packed under and beside the elevated railway between Ueno and Okachimachi, selling dried seafood, fruit, sneakers, spices and cheap clothing. The basement of the Ameyoko Center Building is a Southeast and East Asian grocery.',
    lng: 139.77454, lat: 35.71002,
    x: 0, y: 0,
  },
  {
    id: 'jp-motsuyaki-daitoryo',
    name: 'Motsuyaki Daitoryo',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Ueno, Tokyo',
    description:
      'An open-fronted offal grill on the Ameyoko side of Ueno station where the drinking spills onto plastic crates on the pavement. Grilled skewers and a pot of nikomi stew, drunk with shochu highballs, from mid-morning onward.',
    lng: 139.77484, lat: 35.71035,
    x: 0, y: 0,
  },
  {
    id: 'jp-ponta-honke',
    name: 'Ponta Honke',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Ueno, Tokyo',
    description:
      'A tonkatsu house open since 1905 and generally credited with inventing the dish. The signature katsuretsu is a lean pork loin fried pale in lard and served without the usual heavy sauce, at a wooden counter.',
    lng: 139.77296, lat: 35.70632,
    x: 0, y: 0,
  },
  {
    id: 'jp-tokyo-national-museum', image: '/images/map/jp-tokyo-national-museum.jpg',
    name: 'Tokyo National Museum',
    category: 'Cultural',
    country: 'Japan',
    area: 'Ueno Park, Tokyo',
    description:
      'The oldest and largest museum in Japan, at the north end of Ueno Park across five buildings. The Honkan covers Japanese art from prehistory to the nineteenth century; the Gallery of Horyuji Treasures is the quiet one.',
    lng: 139.77597, lat: 35.71904,
    x: 0, y: 0,
  },
  {
    id: 'jp-super-potato', image: '/images/map/jp-super-potato.jpg',
    name: 'Super Potato Akihabara',
    category: 'Shopping',
    country: 'Japan',
    area: 'Akihabara, Tokyo',
    description:
      'Three floors of second-hand console games stacked to the ceiling — Famicom, Super Famicom, Mega Drive, Saturn, boxed and loose. The fifth floor is a free-to-browse retro arcade with a throne built out of Famicom shells.',
    lng: 139.77065, lat: 35.69939,
    x: 0, y: 0,
  },
  {
    id: 'jp-mandarake-akihabara',
    name: 'Mandarake Complex Akihabara',
    category: 'Shopping',
    country: 'Japan',
    area: 'Akihabara, Tokyo',
    description:
      'Eight floors of second-hand otaku goods, one category per floor — figures, cels, doujinshi, retro games on the sixth, toys and Gundam kits at the top. The deepest back-catalogue of Dragon Ball, Naruto and One Piece figures in the district.',
    lng: 139.77060, lat: 35.70031,
    x: 0, y: 0,
  },
  {
    id: 'jp-radio-kaikan', image: '/images/map/jp-radio-kaikan.jpg',
    name: 'Akihabara Radio Kaikan',
    category: 'Shopping',
    country: 'Japan',
    area: 'Akihabara, Tokyo',
    description:
      'Ten floors of specialist tenants directly outside the Electric Town exit — figure dealers, garage-kit makers, trading cards on the ninth, and a top-floor event space that runs anime pop-ups. One building, one lift, and the fastest way to cover a lot of ground on a cold day.',
    lng: 139.77188, lat: 35.69767,
    x: 0, y: 0,
  },
  {
    id: 'jp-gigo-akihabara',
    name: 'GiGO Akihabara Building 3',
    category: 'Attraction',
    country: 'Japan',
    area: 'Akihabara, Tokyo',
    description:
      'Claw machines on the lower floors, rhythm and fighting games above, and a retro floor of 1990s cabinets including Daytona, OutRun and Super Street Fighter II. It closes later than anything else in the district.',
    lng: 139.77089, lat: 35.69919,
    x: 0, y: 0,
  },
  {
    id: 'jp-nakano-broadway', image: '/images/map/jp-nakano-broadway.jpg',
    name: 'Nakano Broadway',
    category: 'Shopping',
    country: 'Japan',
    area: 'Nakano, Tokyo',
    description:
      'A 1966 shopping-and-apartment complex reached through the covered Nakano Sun Mall arcade, now given over to collectors. Most of the trade is on the second and third floors; the basement is still an ordinary neighbourhood food hall.',
    lng: 139.66569, lat: 35.70924,
    x: 0, y: 0,
  },
  {
    id: 'jp-mandarake-nakano',
    name: 'Mandarake Nakano',
    category: 'Shopping',
    country: 'Japan',
    area: 'Nakano Broadway, Tokyo',
    description:
      'The original Mandarake, opened here in 1980 as a second-hand manga stall and now spread across roughly two dozen shopfronts inside Broadway, each specialising — Showa-era toys, women\'s titles, cels, cards, figures. Vintage cels and out-of-print figures the Akihabara Complex does not carry.',
    lng: 139.66578, lat: 35.70897,
    x: 0, y: 0,
  },
  {
    id: 'jp-ginza-six', image: '/images/map/jp-ginza-six.jpg',
    name: 'Ginza Six',
    category: 'Shopping',
    country: 'Japan',
    area: 'Ginza, Tokyo',
    description:
      'The largest retail complex in Ginza, with a central atrium hung with a rotating commissioned art installation and a 4,000 sq m rooftop garden that is free to enter. Tokyo Tower and the Skytree are both visible from the roof.',
    lng: 139.76335, lat: 35.66945,
    x: 0, y: 0,
  },
  {
    id: 'jp-marunouchi-lights', image: '/images/map/jp-marunouchi-lights.jpg',
    name: 'Marunouchi Naka-dori Illumination',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Marunouchi, Tokyo',
    description:
      'A cobbled avenue of more than 200 zelkova trees beside Tokyo Station, wrapped in roughly 800,000 champagne-gold LEDs each winter. The season runs from mid-November to mid-February, so it covers any evening of the stay.',
    lng: 139.76285, lat: 35.68003,
    x: 0, y: 0,
  },
  {
    id: 'jp-tsukiji-outer', image: '/images/map/jp-tsukiji-outer.jpg',
    name: 'Tsukiji Outer Market',
    category: 'Shopping',
    country: 'Japan',
    area: 'Tsukiji, Tokyo',
    description:
      'Four hundred-plus retail shops and stalls in the lanes beside the old wholesale site, selling knives, dried bonito, tamagoyaki on a stick, grilled scallops and sea urchin. The auctions moved to Toyosu in 2018; this half stayed, and it eats early.',
    lng: 139.76965, lat: 35.66528,
    x: 0, y: 0,
  },
  {
    id: 'jp-sushi-zanmai',
    name: 'Sushi Zanmai Honten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Tsukiji, Tokyo',
    description:
      'The original branch of the chain whose owner makes the headlines bidding on the year\'s first tuna, on the corner of the Tsukiji outer market. Counter and table seating, an illustrated menu, open around the clock every day of the year.',
    lng: 139.77062, lat: 35.66596,
    x: 0, y: 0,
  },
  {
    // Named "Toyosu Fish Market" rather than the bare "Toyosu Market": the alias builder in
    // lib/itinerary-map.ts strips the word "market", which would leave `toyosu` — a district
    // alias that then swallows every item whose location merely says Toyosu, the teamLab
    // Planets day included.
    id: 'jp-toyosu-market', image: '/images/map/jp-toyosu-market.jpg',
    name: 'Toyosu Fish Market',
    category: 'Attraction',
    country: 'Japan',
    area: 'Toyosu, Tokyo',
    description:
      'The wholesale fish market that replaced the Tsukiji inner market, built as three sealed blocks with a public walkway threaded above the trading floors. Uogashi-Yokocho on the intermediate block has the shops and the sushi counters.',
    lng: 139.78272, lat: 35.64215,
    x: 0, y: 0,
  },
  {
    id: 'jp-monja-kondo', image: '/images/map/jp-monja-kondo.jpg',
    name: 'Monja Kondo Honten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Tsukishima, Tokyo',
    description:
      'One of the long-running shops on Tsukishima\'s Monja Street, a few hundred metres of nothing but monjayaki restaurants. You cook the batter yourself on the griddle set into the table; staff start the first one off, then it is on you.',
    lng: 139.78116, lat: 35.66261,
    x: 0, y: 0,
  },
  {
    id: 'jp-yanaka-ginza', image: '/images/map/jp-yanaka-ginza.jpg',
    name: 'Yanaka Ginza',
    category: 'Cultural',
    country: 'Japan',
    area: 'Yanaka, Tokyo',
    description:
      'A short pedestrian shopping street of about seventy small shops below a flight of steps known as Yuyake Dandan, in one of the few central districts that survived both the 1923 earthquake and the wartime firebombing. Menchi-katsu, senbei and a lot of resident cats.',
    lng: 139.76532, lat: 35.72767,
    x: 0, y: 0,
  },
  {
    id: 'jp-warner-bros',
    // Short form on purpose: the full title carries a subtitle after a dash, and the alias
    // builder matches a marker name as one contiguous run, so the long form would never match
    // an item that calls it by the name everybody uses.
    name: 'Warner Bros. Studio Tour Tokyo',
    category: 'Attraction',
    country: 'Japan',
    area: 'Kasugacho, Tokyo',
    description:
      'A walk-through studio attraction on the site of the former Toshimaen amusement park, with standing sets, props and costumes from the Harry Potter films. It is self-paced, timed-entry and most visitors take four hours or more.',
    lng: 139.64575, lat: 35.74562,
    x: 0, y: 0,
  },
  {
    id: 'jp-ghibli-museum', image: '/images/map/jp-ghibli-museum.jpg',
    name: 'Ghibli Museum, Mitaka',
    category: 'Cultural',
    country: 'Japan',
    area: 'Mitaka, Tokyo',
    description:
      'A small museum in Inokashira Park with original layout art, a rooftop robot soldier from Laputa and a cinema showing short films made only for this building. Advance reservation only, no door sales, and no photography indoors.',
    lng: 139.57063, lat: 35.69617,
    x: 0, y: 0,
  },
  {
    id: 'jp-metro-gov-decks', image: '/images/map/jp-metro-gov-decks.jpg',
    name: 'Tokyo Metropolitan Government Building Observation Decks',
    category: 'Attraction',
    country: 'Japan',
    area: 'Nishi-Shinjuku, Tokyo',
    description:
      'Two free observation decks at 202 m in the No. 1 building, reached by a dedicated lift from the ground floor. After dark the tower face becomes the screen for a free 15-minute projection-mapping show that repeats through the evening.',
    lng: 139.69171, lat: 35.68950,
    x: 0, y: 0,
  },
  {
    id: 'jp-omoide-yokocho',
    name: 'Omoide Yokocho',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Nishi-Shinjuku, Tokyo',
    description:
      'A lane of about sixty yakitori and offal counters wedged under the rail viaduct on the west side of Shinjuku Station, most seating six to eight people at a bar. Grill smoke and lanterns fill the alley from around 17:00, and it is mostly cash.',
    lng: 139.69970, lat: 35.69302,
    x: 0, y: 0,
  },
  {
    id: 'jp-golden-gai', image: '/images/map/jp-golden-gai.jpg',
    name: 'Shinjuku Golden Gai',
    category: 'Attraction',
    country: 'Japan',
    area: 'Kabukicho, Tokyo',
    description:
      'Six alleys of two-storey wooden shacks holding a bit over 200 bars, most with five to ten seats and a theme the owner picked decades ago. Doors open around 19:00 and most charge a seat fee on top of drinks — read the door sign for that and for whether they take a group of three.',
    lng: 139.70470, lat: 35.69399,
    x: 0, y: 0,
  },
  {
    id: 'jp-shinjuku-gyoen', image: '/images/map/jp-shinjuku-gyoen.jpg',
    name: 'Shinjuku Gyoen National Garden',
    category: 'Attraction',
    country: 'Japan',
    area: 'Naitomachi, Tokyo',
    description:
      'A 58-hectare garden of three linked landscapes — English lawn, French formal and Japanese strolling — ten minutes from Shinjuku-sanchome. In winter the trees are bare, the paths are quiet and the gates shut well before dark.',
    lng: 139.70955, lat: 35.68507,
    x: 0, y: 0,
  },
  {
    id: 'jp-hanazono-shrine', image: '/images/map/jp-hanazono-shrine.jpeg',
    name: 'Hanazono Shrine',
    category: 'Cultural',
    country: 'Japan',
    area: 'Shinjuku 5-chome, Tokyo',
    description:
      'The shrine that has watched over Shinjuku since before the town existed, in a walled compound on Meiji-dori three minutes from Golden Gai. The grounds are open around the clock and cost nothing.',
    lng: 139.70521, lat: 35.69359,
    x: 0, y: 0,
  },
  {
    id: 'jp-gyukatsu-motomura',
    name: 'Gyukatsu Motomura Shinjuku Honten',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Kabukicho, Tokyo',
    description:
      'Beef cutlet fried for sixty seconds and served rare, with a small charcoal stone at each seat so you finish each slice yourself. No reservations for counter seats.',
    lng: 139.70165, lat: 35.69463,
    x: 0, y: 0,
  },
  {
    id: 'jp-ramen-nagi',
    name: 'Sugoi Niboshi Ramen Nagi, Golden Gai Main Building',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Golden Gai, Tokyo',
    description:
      'Dried-sardine ramen served up a near-vertical staircase in a wooden Golden Gai house, open around the clock. The broth is heavy on niboshi and the room seats about ten.',
    lng: 139.70456, lat: 35.69376,
    x: 0, y: 0,
  },
  {
    id: 'jp-fuunji',
    name: 'Fuunji',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Yoyogi, Tokyo',
    description:
      'A ten-seat counter serving tsukemen in a chicken and dried-fish dipping broth, about eight minutes south of Shinjuku Station. The queue forms outside on the pavement and moves fast, but three people will be split up.',
    lng: 139.69669, lat: 35.68689,
    x: 0, y: 0,
  },
  {
    id: 'jp-shibuya-sky', image: '/images/map/jp-shibuya-sky.jpg',
    name: 'Shibuya Sky',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Shibuya, Tokyo',
    description:
      'An open rooftop at 229 m directly above the station, with the scramble crossing laid out below and Mt Fuji on the western horizon on a clear day. Entry is by timed slot and the rooftop closes in wind or rain, when only the indoor 46th floor stays open.',
    lng: 139.70222, lat: 35.65838,
    x: 0, y: 0,
  },
  {
    id: 'jp-miyashita-park',
    // Same mid-string "park" strip as jp-monkey-park — Shibuya Yokocho is on its ground
    // floor and is named in the description instead.
    name: 'Miyashita Park',
    category: 'Attraction',
    country: 'Japan',
    area: 'Jingumae, Tokyo',
    description:
      'A rooftop park laid over three floors of shops on the strip between Shibuya and Harajuku, with a skate bowl, a bouldering wall and a sand court on top. The north end of the ground floor is Shibuya Yokocho, a covered run of about nineteen regional-food counters that serves until 05:00.',
    lng: 139.70193, lat: 35.66196,
    x: 0, y: 0,
  },
  {
    id: 'jp-harlem',
    name: 'Harlem',
    category: 'Attraction',
    country: 'Japan',
    area: 'Maruyamacho, Tokyo',
    description:
      'A two-floor hip-hop club that has run in Maruyamacho since 1997, with the main room upstairs and a smaller bar level under it. The floor does not fill until after midnight and the calendar is weighted to Friday and Saturday.',
    lng: 139.69531, lat: 35.65843,
    x: 0, y: 0,
  },
  {
    id: 'jp-ichiran-shibuya', image: '/images/map/jp-ichiran-shibuya.png',
    name: 'Ichiran Shibuya',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Jinnan, Tokyo',
    description:
      'The Shibuya branch of the tonkotsu chain that seats you in a partitioned booth and takes the order on a paper form. It runs 24 hours, which is what earns it a slot near the clubs — for three people the dividers have to be opened on request.',
    lng: 139.70108, lat: 35.66111,
    x: 0, y: 0,
  },
  {
    id: 'jp-uobei',
    name: 'Uobei Shibuya Dogenzaka',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Dogenzaka, Tokyo',
    description:
      'A sushi shop where you order from a touchscreen and plates arrive along a three-lane express rail rather than a rotating belt. Individual panel seats, so three adjacent places is normal rather than a problem.',
    lng: 139.69780, lat: 35.65946,
    x: 0, y: 0,
  },
  {
    id: 'jp-takeshita-dori', image: '/images/map/jp-takeshita-dori.jpg',
    name: 'Takeshita-dori',
    category: 'Shopping',
    country: 'Japan',
    area: 'Harajuku, Tokyo',
    description:
      'A 350 m pedestrian street running from the Takeshita exit of Harajuku Station to Meiji-dori, packed with teen-fashion shops, crepe stands and character stores. It is narrow enough to jam solid on a weekend afternoon.',
    lng: 139.70307, lat: 35.67159,
    x: 0, y: 0,
  },
  {
    id: 'jp-meiji-jingu', image: '/images/map/jp-meiji-jingu.jpg',
    name: 'Meiji Jingu',
    category: 'Cultural',
    country: 'Japan',
    area: 'Yoyogi, Tokyo',
    description:
      'A Shinto shrine set in a planted forest of some 100,000 trees between Harajuku and Yoyogi, approached along a wide gravel path under timber torii. The gates follow sunrise and sunset, so the winter day here is short.',
    lng: 139.69963, lat: 35.67484,
    x: 0, y: 0,
  },
  {
    id: 'jp-tokyo-tower', image: '/images/map/jp-tokyo-tower.jpg',
    name: 'Tokyo Tower',
    category: 'Attraction',
    country: 'Japan',
    area: 'Shibakoen, Tokyo',
    description:
      'A 333 m lattice tower painted white and orange, with a main deck at 150 m and a guided top deck at 250 m. Winter air is the clearest of the year for the view, and the tower itself is floodlit after dark.',
    lng: 139.74554, lat: 35.65845,
    x: 0, y: 0,
  },
  {
    id: 'jp-tokyo-midtown', image: '/images/map/jp-tokyo-midtown.jpg',
    name: 'Tokyo Midtown',
    category: 'Attraction',
    country: 'Japan',
    area: 'Akasaka, Tokyo',
    description:
      'A mixed office and retail complex behind Roppongi with a lawn and a tree-lined garden path at the back. The path carries a lit walkway through the winter, with an outdoor rink beside it.',
    lng: 139.72979, lat: 35.66677,
    x: 0, y: 0,
  },
  {
    id: 'jp-sel-octagon',
    name: 'Sel Octagon Tokyo',
    category: 'Attraction',
    country: 'Japan',
    area: 'Roppongi, Tokyo',
    description:
      'A large basement club on Gaien-Higashi-dori built around a lighting rig closer to a festival stage than a bar. Mostly EDM with visiting DJs at weekends, and it is not fed by touts on the street.',
    lng: 139.72983, lat: 35.66495,
    x: 0, y: 0,
  },
  {
    id: 'jp-sbux-roastery',
    name: 'Starbucks Reserve Roastery Tokyo',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Nakameguro, Tokyo',
    description:
      'A four-floor roastery on the Meguro River with a copper cask running the height of the building and a bakery counter on the ground floor. Doors open at 07:00, earlier than almost anything else worth eating at nearby.',
    lng: 139.69263, lat: 35.64926,
    x: 0, y: 0,
  },
  {
    id: 'jp-ebisu-yokocho',
    name: 'Ebisu Yokocho',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Ebisu, Tokyo',
    description:
      'About twenty open-fronted izakaya counters filling the ground floor of an old shopping arcade a few minutes from Ebisu Station, dressed to look like a post-war market. Tables are shared, the aisle is one person wide, and it runs to 05:00.',
    lng: 139.71074, lat: 35.64815,
    x: 0, y: 0,
  },
  {
    id: 'jp-mikan-shimokita', image: '/images/map/jp-mikan-shimokita.jpg',
    name: 'Mikan Shimokita',
    category: 'Shopping',
    country: 'Japan',
    area: 'Shimokitazawa, Tokyo',
    description:
      'Five blocks of shops and restaurants built into the arches under the Keio Inokashira line at Shimokitazawa Station, opened in 2022. Vintage clothing, records, Thai and Japanese kitchens and a work floor sit side by side.',
    lng: 139.66800, lat: 35.66141,
    x: 0, y: 0,
  },
  {
    id: 'jp-pokemon-center', image: '/images/map/jp-pokemon-center.jpg',
    name: 'Pokemon Center MEGA TOKYO',
    category: 'Shopping',
    country: 'Japan',
    area: 'Higashi-Ikebukuro, Tokyo',
    description:
      'The largest Pokemon Center in Japan, on the second floor of the Alpa mall inside Sunshine City, with a card-game gym attached. Limited regional and seasonal goods land here first.',
    lng: 139.71918, lat: 35.72889,
    x: 0, y: 0,
  },
  {
    id: 'jp-animate-ikebukuro', image: '/images/map/jp-animate-ikebukuro.jpg',
    name: 'animate Ikebukuro Main Store',
    category: 'Shopping',
    country: 'Japan',
    area: 'Higashi-Ikebukuro, Tokyo',
    description:
      'Nine floors above ground and two below of manga, character goods, an event hall and a theatre, five minutes from the east exit of Ikebukuro Station. Rebuilt in 2023 and recognised as the largest anime shop in the world the year after.',
    lng: 139.71545, lat: 35.73115,
    x: 0, y: 0,
  },

  // ── Japan — day trips from Tokyo ──────────────────────────────────────────
  {
    id: 'jp-disneysea', image: '/images/map/jp-disneysea.jpg',
    name: 'Tokyo DisneySea',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Maihama, Urayasu',
    description:
      'A nautically themed park built around a harbour and a working volcano, next door to Tokyo Disneyland. The Fantasy Springs area, opened in 2024, adds Frozen, Tangled and Peter Pan lands at the back of the site.',
    lng: 139.88441, lat: 35.62726,
    x: 0, y: 0,
  },
  {
    id: 'jp-hakone-open-air', image: '/images/map/jp-hakone-open-air.jpg',
    name: 'Hakone Open-Air Museum',
    category: 'Day Trip',
    country: 'Japan',
    // The three Hakone areas name the PREFECTURE, not Hakone, on purpose. `containingCity`
    // reads the last comma-segment, so an area ending ", Hakone" would make Hakone a
    // containing city — and jp-hakone above is literally NAMED "Hakone", so its own name
    // alias would then be a bare city word claiming a landmark pin, which is the defect
    // the alias guard in lib/itinerary-map.ts exists to prevent.
    area: 'Ninotaira, Kanagawa',
    description:
      'A 70,000 sq m hillside sculpture park with a Picasso pavilion and a stained-glass tower you climb from inside. Most of the work stands outdoors against the mountains, and there is a free foot-onsen at the far end.',
    lng: 139.05208, lat: 35.24428,
    x: 0, y: 0,
  },
  {
    id: 'jp-owakudani', image: '/images/map/jp-owakudani.jpg',
    name: 'Owakudani',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Sengokuhara, Kanagawa',
    description:
      'A sulphur valley of steaming vents left by the last eruption, crossed by the ropeway between Sounzan and Togendai. The black eggs are boiled in the hot springs and sold at the station.',
    lng: 139.01986, lat: 35.24455,
    x: 0, y: 0,
  },
  {
    id: 'jp-hakone-shrine',
    // The place-type strip reduces this name to the alias `hakone`, which jp-hakone above
    // also carries. Equal-length aliases keep MAP_MARKERS order, so a bare "Hakone" resolves
    // to the district marker and only the full "Hakone Shrine" reaches this pin — right on
    // both counts, but it is order-dependent: do not move this entry above jp-hakone.
    name: 'Hakone Shrine',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Moto-Hakone, Kanagawa',
    description:
      'A shrine founded in 757 in cedar forest above Lake Ashi, with a vermilion torii standing in the water at the lakeshore below it. On a clear winter morning Mount Fuji sits directly behind the lake from the Moto-Hakone side.',
    lng: 139.02558, lat: 35.20397,
    x: 0, y: 0,
  },
  {
    id: 'jp-chureito',
    name: 'Arakurayama Sengen Park (Chureito Pagoda)',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Fujiyoshida, Yamanashi',
    description:
      'A five-storey pagoda on a hillside terrace with Mount Fuji framed behind it, reached by 398 steps from the shrine at the bottom. The viewing platform is a purpose-built deck, so the composition is fixed and everyone shoots the same frame.',
    lng: 138.80082, lat: 35.50049,
    x: 0, y: 0,
  },
  {
    id: 'jp-oishi-park', image: '/images/map/jp-oishi-park.jpg',
    name: 'Oishi Park, Lake Kawaguchi',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Fujikawaguchiko, Yamanashi',
    description:
      'A strip of lakeside park on the north shore of Lake Kawaguchi looking straight across the water at Fuji, with a flower field in front of the view. In winter the beds are bare and the reflection on a still morning is the whole point.',
    lng: 138.74654, lat: 35.52329,
    x: 0, y: 0,
  },
  {
    id: 'jp-nikko-toshogu', image: '/images/map/jp-nikko-toshogu.jpg',
    name: 'Nikko Toshogu',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Sannai, Nikko',
    description:
      'The mausoleum complex of Tokugawa Ieyasu, built in 1617 and carved and gilded to a density found nowhere else in Japan — the Yomeimon gate alone carries over 500 carvings. It stands in old cedar forest at 600 m, so it is properly cold and often has snow.',
    lng: 139.59911, lat: 36.75764,
    x: 0, y: 0,
  },
  {
    id: 'jp-kotokuin', image: '/images/map/jp-kotokuin.jpg',
    name: 'Kotoku-in (Great Buddha of Kamakura)',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Hase, Kamakura',
    description:
      'An 11.4 m bronze Amida Buddha cast in 1252, sitting in the open air since the hall around it was destroyed by a tsunami in the fifteenth century. For a few coins you can go inside the statue and see the casting seams.',
    lng: 139.53573, lat: 35.31650,
    x: 0, y: 0,
  },
  {
    id: 'jp-kamakurakokomae', image: '/images/map/jp-kamakurakokomae.jpg',
    name: 'Kamakurakokomae Station crossing',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Koshigoe, Kamakura',
    description:
      'A level crossing on the single-track Enoden line where the road meets the sea wall, with Enoshima island on the horizon. It is a working crossing on a residential street, and the city has put up signage about people standing in the road for the shot.',
    lng: 139.50209, lat: 35.30660,
    x: 0, y: 0,
  },
  {
    id: 'jp-cupnoodles',
    name: 'CUPNOODLES MUSEUM Yokohama',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Shinko, Yokohama',
    description:
      'A design museum about instant noodles whose main draw is the cup factory: you decorate a blank cup, choose a soup and four toppings, and it is sealed and shrink-wrapped in front of you. There is also a hall where you make ramen from flour.',
    lng: 139.63888, lat: 35.45549,
    x: 0, y: 0,
  },
  {
    id: 'jp-yokohama-chinatown', image: '/images/map/jp-yokohama-chinatown.jpg',
    name: 'Yokohama Chinatown',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Yamashitacho, Yokohama',
    description:
      'The largest Chinatown in Japan, roughly 300 restaurants and food stalls in a ten-block grid behind painted gates. Street stalls sell steamed buns, xiaolongbao and grilled skewers to eat standing up.',
    lng: 139.64519, lat: 35.44266,
    x: 0, y: 0,
  },
  {
    id: 'jp-gala-yuzawa', image: '/images/map/jp-gala-yuzawa.jpg',
    name: 'GALA Yuzawa Snow Resort',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Yuzawa, Niigata',
    description:
      'A ski area whose gondola station is built directly on top of its own Shinkansen station, so you walk from the platform to the rental counter to the lift without going outside. Rental gear, lockers and a bathhouse are all in the base building.',
    lng: 138.79955, lat: 36.95025,
    x: 0, y: 0,
  },
];
