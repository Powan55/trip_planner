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
    id: 'np-pottery-square',
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
    id: 'np-dharahara',
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
    id: 'np-rani-pokhari',
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
    id: 'np-nag-bahal',
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
    id: 'np-khokana',
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
    id: 'np-kirtipur',
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
    id: 'np-panauti',
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
    id: 'np-budhanilkantha',
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
    id: 'np-changu-narayan',
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
    id: 'np-asan',
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
    id: 'np-taudaha',
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
    id: 'np-shivapuri',
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
    id: 'np-phulchowki',
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
    id: 'np-chandragiri',
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
    id: 'np-dhulikhel',
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
    lng: 139.7900, lat: 35.6488,
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
];
