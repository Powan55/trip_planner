// Mock interactive-map data. The map is a mock — category markers, popup cards,
// regional layout — built so it could later be wired to a real provider. No real
// map library/API is used; maplibre-gl stays unused.
//
// Each marker's x/y are 0-100 percentages relative to its OWN country panel
// (the stylized mock surface), NOT real lat/lng. They are hand-distributed to
// approximate the relative geography of each region while avoiding overlap.

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
  country: 'Nepal' | 'Japan';
  area: string;
  description: string;
  /** 0-100 — horizontal % position on that country's mock panel. */
  x: number;
  /** 0-100 — vertical % position on that country's mock panel. */
  y: number;
  /** Optional bundled photo for the popup (root-relative). */
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
    x: 68,
    y: 30,
  },
  {
    id: 'np-swayambhunath', image: '/images/map/np-swayambhunath.jpg',
    name: 'Swayambhunath (Monkey Temple)',
    category: 'Attraction',
    country: 'Nepal',
    area: 'West Kathmandu',
    description:
      'A hilltop stupa with the watchful eyes of the Buddha gazing over the valley. A steep 365-step climb rewards you with sweeping city panoramas.',
    x: 24,
    y: 38,
  },
  {
    id: 'np-pashupatinath', image: '/images/map/np-pashupatinath.jpg',
    name: 'Pashupatinath Temple',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Gaushala, Kathmandu',
    description:
      'The most sacred Hindu temple complex on the banks of the Bagmati River, dedicated to Lord Shiva and alive with sadhus and evening aarti rituals.',
    x: 74,
    y: 44,
  },
  {
    id: 'np-durbar-ktm', image: '/images/map/np-durbar-ktm.jpg',
    name: 'Kathmandu Durbar Square',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Old City, Kathmandu',
    description:
      'A historic royal plaza of pagoda temples, courtyards, and the Kumari Ghar — home of Nepal’s living goddess. A UNESCO site at the heart of the old city.',
    x: 42,
    y: 50,
  },
  {
    id: 'np-thamel', image: '/images/map/np-thamel.jpg',
    name: 'Thamel Bazaar',
    category: 'Shopping',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'The buzzing tourist quarter packed with trekking gear, pashmina, singing bowls, thangka art, and souvenir stalls. Best haggled at after dusk.',
    x: 38,
    y: 40,
  },
  {
    id: 'np-garden-dreams',
    name: 'Garden of Dreams',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'Kaiser Mahal, Kathmandu',
    description:
      'A restored neo-classical garden oasis of pavilions, fountains, and pergolas — a serene, photogenic escape from the city bustle.',
    x: 46,
    y: 34,
  },
  {
    id: 'np-patan', image: '/images/map/np-patan.jpg',
    name: 'Patan Durbar Square',
    category: 'Cultural',
    country: 'Nepal',
    area: 'Lalitpur',
    description:
      'A masterpiece of Newari architecture with the Krishna Mandir and the Patan Museum — arguably the finest of the valley’s three durbar squares.',
    x: 50,
    y: 66,
  },
  {
    id: 'np-bhaktapur', image: '/images/map/np-bhaktapur.jpg',
    name: 'Bhaktapur Durbar Square',
    category: 'Attraction',
    country: 'Nepal',
    area: 'Bhaktapur',
    description:
      'A perfectly preserved medieval city of brick streets, the 55-Window Palace, and Nyatapola Temple. Famous for juju dhau (king curd) and pottery.',
    x: 86,
    y: 58,
  },
  {
    id: 'np-nagarkot', image: '/images/map/np-nagarkot.jpg',
    name: 'Nagarkot Viewpoint',
    category: 'Day Trip',
    country: 'Nepal',
    area: 'Nagarkot (~32 km)',
    description:
      'A ridge-top village famous for sunrise panoramas over the Himalaya, including glimpses of Everest on clear winter mornings. A classic valley day trip.',
    x: 92,
    y: 22,
  },
  {
    id: 'np-newa-kitchen', image: '/images/map/np-newa-kitchen.jpg',
    name: 'Newa Lahana',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Kirtipur',
    description:
      'A community-run Newari kitchen serving an authentic platter of choila, bara, and chhoyla — the most traditional way to taste valley cuisine.',
    x: 30,
    y: 60,
  },
  {
    id: 'np-yangling', image: '/images/map/np-yangling.jpg',
    name: 'Yangling Tibetan Restaurant',
    category: 'Restaurant',
    country: 'Nepal',
    area: 'Thamel, Kathmandu',
    description:
      'A beloved Thamel institution for steaming plates of momos and thukpa — hearty, warming fare perfect for a December evening.',
    x: 36,
    y: 46,
  },
  {
    id: 'np-dwarikas',
    name: "Dwarika's Hotel",
    category: 'Hotel',
    country: 'Nepal',
    area: 'Battisputali, Kathmandu',
    description:
      'A heritage luxury hotel built around a living museum of rescued Newari woodcarving — an immersion in Nepali craftsmanship and a base near Pashupatinath.',
    x: 66,
    y: 52,
  },
  {
    id: 'np-kopan', image: '/images/map/np-kopan.jpg',
    name: 'Kopan Monastery',
    category: 'Photo Spot',
    country: 'Nepal',
    area: 'North Kathmandu',
    description:
      'A hillside Tibetan Buddhist monastery with gardens and golden rooftops overlooking Boudha — luminous at sunrise and wonderfully peaceful.',
    x: 70,
    y: 16,
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
    x: 78,
    y: 26,
  },
  {
    id: 'jp-shibuya', image: '/images/map/jp-shibuya.jpg',
    name: 'Shibuya Crossing',
    category: 'Attraction',
    country: 'Japan',
    area: 'Shibuya, Tokyo',
    description:
      'The world’s busiest pedestrian scramble, a neon-soaked icon of Tokyo. Best viewed from above at the Shibuya Sky observation deck.',
    x: 72,
    y: 36,
  },
  {
    id: 'jp-akihabara', image: '/images/map/jp-akihabara.jpg',
    name: 'Akihabara Electric Town',
    category: 'Shopping',
    country: 'Japan',
    area: 'Akihabara, Tokyo',
    description:
      'The electric heart of anime, gaming, and gadgets — towers of arcades, retro game shops, and multi-floor electronics emporiums.',
    x: 80,
    y: 32,
  },
  {
    id: 'jp-ichiran', image: '/images/map/jp-ichiran.jpg',
    name: 'Ichiran Ramen',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Shinjuku, Tokyo',
    description:
      'Tonkotsu ramen perfected in solo focus booths — customize richness, spice, and noodle firmness, then slurp in distraction-free bliss.',
    x: 68,
    y: 30,
  },
  {
    id: 'jp-park-hyatt', image: '/images/map/jp-park-hyatt.jpg',
    name: 'Park Hyatt Tokyo',
    category: 'Hotel',
    country: 'Japan',
    area: 'Shinjuku, Tokyo',
    description:
      'A sky-high luxury landmark (of Lost in Translation fame) with floor-to-ceiling skyline views — a polished base for exploring central Tokyo.',
    x: 60,
    y: 40,
  },
  {
    id: 'jp-teamlab',
    name: 'teamLab Planets',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Toyosu, Tokyo',
    description:
      'An immersive digital-art museum of infinite mirrored light gardens and water rooms — one of the most photogenic experiences in the city.',
    x: 84,
    y: 42,
  },
  {
    id: 'jp-fushimi', image: '/images/map/jp-fushimi.jpg',
    name: 'Fushimi Inari Taisha',
    category: 'Cultural',
    country: 'Japan',
    area: 'Fushimi, Kyoto',
    description:
      'The shrine of a thousand vermilion torii gates winding up Mount Inari. Go early to walk the tunnels of gates in golden morning light.',
    x: 30,
    y: 60,
  },
  {
    id: 'jp-arashiyama', image: '/images/map/jp-arashiyama.jpg',
    name: 'Arashiyama Bamboo Grove',
    category: 'Photo Spot',
    country: 'Japan',
    area: 'Arashiyama, Kyoto',
    description:
      'A towering green corridor of swaying bamboo on Kyoto’s western edge, paired with the Togetsukyo Bridge and Tenryu-ji temple gardens.',
    x: 18,
    y: 54,
  },
  {
    id: 'jp-kinkakuji', image: '/images/map/jp-kinkakuji.jpg',
    name: 'Kinkaku-ji (Golden Pavilion)',
    category: 'Attraction',
    country: 'Japan',
    area: 'North Kyoto',
    description:
      'A gold-leaf Zen pavilion mirrored in its reflecting pond — Kyoto’s most iconic image, dusted with light frost in winter.',
    x: 26,
    y: 48,
  },
  {
    id: 'jp-nishiki', image: '/images/map/jp-nishiki.jpg',
    name: 'Nishiki Market',
    category: 'Shopping',
    country: 'Japan',
    area: 'Central Kyoto',
    description:
      'Kyoto’s "kitchen" — a narrow 400-year-old arcade of stalls selling pickles, tofu, sweets, knives, and street snacks.',
    x: 34,
    y: 52,
  },
  {
    id: 'jp-dotonbori', image: '/images/map/jp-dotonbori.jpg',
    name: 'Dotonbori',
    category: 'Restaurant',
    country: 'Japan',
    area: 'Namba, Osaka',
    description:
      'Osaka’s neon canal-side food strip — takoyaki, okonomiyaki, and the running Glico man sign. The capital of kuidaore ("eat till you drop").',
    x: 40,
    y: 80,
  },
  {
    id: 'jp-osaka-castle', image: '/images/map/jp-osaka-castle.jpg',
    name: 'Osaka Castle',
    category: 'Attraction',
    country: 'Japan',
    area: 'Chuo-ku, Osaka',
    description:
      'A grand reconstructed feudal castle ringed by moats and a park of plum and cherry trees, with a panoramic observation deck on top.',
    x: 48,
    y: 74,
  },
  {
    id: 'jp-nara', image: '/images/map/jp-nara.jpg',
    name: 'Nara Deer Park',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Nara (~45 min from Kyoto)',
    description:
      'Free-roaming bowing deer, the colossal Great Buddha of Todai-ji, and lantern-lined paths — an easy and unforgettable day trip from Kyoto or Osaka.',
    x: 44,
    y: 64,
  },
  {
    id: 'jp-hakone', image: '/images/map/jp-hakone.jpg',
    name: 'Hakone',
    category: 'Day Trip',
    country: 'Japan',
    area: 'Hakone (~85 min from Tokyo)',
    description:
      'A hot-spring retreat with Mt. Fuji views, the Hakone open-air sculpture museum, and a pirate-ship cruise on Lake Ashi — a scenic escape from Tokyo.',
    x: 58,
    y: 46,
  },
];
