import type { DayPlan } from '@/lib/trip-data';

/**
 * THE single authoring source for the trip's day-by-day plan content.
 * Edit THIS file to change what a fresh device sees and what the per-day city map
 * (`core/dates/trip-cities.ts` — DERIVED from here) computes from. Framework-free:
 * plain TS, no React / Next / `window`, and — critically — it imports NOTHING from
 * `core/dates` (the one-way arrow keeps the derivation acyclic; `country`-vs-date agreement
 * is a `validate:content` check, not a derivation).
 *
 * `lib/sample-itinerary.ts` is a one-line delegate re-export (`TRIP_ITINERARY as
 * SAMPLE_ITINERARY` — the same object), so the Vault fallback wiring and every
 * caller are untouched, and the seed stays a synchronous pure module-scope const at the
 * Vault read boundary (NO schema parse / I/O / laziness at runtime; strict
 * validation runs authoring/CI-time only, in `core/content/schema.ts` + the validate:content
 * suite). A content/seed swap NEVER rewrites live saved or synced data.
 *
 * See docs/trip-content.md for the edit runbook (edit map, invariants, workflow, danger zone).
 */
export const TRIP_ITINERARY: DayPlan[] = [
  {
    date: '2026-12-09',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n1-1', title: 'Depart Syracuse (SYR) — Delta 5363 to New York (JFK)', category: 'transportation', time: '05:30', duration: '1h 32m', notes: 'SYR → JFK Terminal 4 · Delta 5363 · arrive 7:02am · seats 11A/11B/11C · Economy. Keep passport & onward boarding passes handy', location: 'Syracuse Hancock Intl (SYR) → New York JFK (T4)' },
      { id: 'n1-2', title: 'Layover at New York (JFK) Terminal 4', category: 'transportation', time: '07:02', duration: '4h 53m', notes: 'Connection to the long-haul; grab a meal before the Air India flight to Delhi', location: 'New York JFK — Terminal 4' },
      { id: 'n1-3', title: 'Fly JFK → Delhi (DEL) — Air India 102', category: 'transportation', time: '11:55', duration: '14h 55m', notes: 'JFK T4 → DEL Terminal 3 · Air India 102 · arrives 1:20pm Dec 10 · seats 31D/31E/31G · Economy. Long-haul — set watch ahead, hydrate, sleep on board', location: 'New York JFK (T4) → Delhi (DEL T3)' },
    ],
  },
  {
    date: '2026-12-10',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n2-1', title: 'Layover at Delhi (DEL) Terminal 3', category: 'transportation', time: '13:20', duration: '1h 10m', notes: 'Short connection at Indira Gandhi Intl before the final hop to Kathmandu', location: 'Delhi Indira Gandhi Intl — Terminal 3' },
      { id: 'n2-2', title: 'Fly Delhi (DEL) → Kathmandu (KTM) — Air India 219', category: 'transportation', time: '14:30', duration: '1h 45m', notes: 'DEL T3 → KTM Terminal I · Air India 219 · arrives 4:30pm · seats 26D/26E/26F · Economy. Window seat for first glimpses of the Himalaya on descent', location: 'Delhi (DEL T3) → Kathmandu Tribhuvan Intl (KTM)' },
      { id: 'n2-3', title: 'Arrive Tribhuvan (KTM): visa on arrival & transfer', category: 'transportation', time: '16:30', duration: '1.5h', notes: 'Visa on arrival, baggage claim, currency exchange to Nepali rupees, then transfer into the city', location: 'Tribhuvan Intl Airport (KTM)' },
      { id: 'n2-3b', title: 'Check in to Tulsi Kathmandu Hotel', category: 'hotel', time: '18:00', duration: '1h', notes: '3-star hotel on Keshar Mahal Marga, beside the Garden of Dreams and a short walk from Thamel; rest and freshen up after the long journey', location: 'Keshar Mahal Marga, Kathmandu' },
      { id: 'n2-4', title: 'Evening walk in Thamel', category: 'sightseeing', time: '19:30', duration: '1h', notes: 'Ease into the city — buy a local SIM card, browse the shops, get oriented', location: 'Thamel' },
      { id: 'n2-5', title: 'Welcome dinner at Bhojan Griha', category: 'food', time: '20:30', duration: '2h', notes: 'Traditional Nepali dal bhat feast in a 150-year-old heritage building with a cultural dance show — reserve ahead', location: 'Dillibazar, Kathmandu' },
    ],
  },
  {
    date: '2026-12-11',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n3-1', title: 'Sunrise at Swayambhunath (Monkey Temple)', category: 'photography', time: '06:00', duration: '2h', notes: '365 steps to the top for a 360° valley panorama; bring a wide-angle lens for the cityscape', location: 'Swayambhu Hill' },
      { id: 'n3-2', title: 'Breakfast at OR2K Restaurant', category: 'food', time: '08:30', duration: '1h', notes: 'Mediterranean-Nepali fusion with rooftop cushion seating; vegetarian-friendly', location: 'Thamel' },
      { id: 'n3-3', title: 'Kathmandu Durbar Square', category: 'cultural', time: '10:00', duration: '3h', notes: 'UNESCO royal square — Hanuman Dhoka, the temples, and the living goddess at Kumari Ghar', location: 'Basantapur' },
      { id: 'n3-4', title: 'Lunch — momos at Yangling', category: 'food', time: '13:00', duration: '1h', notes: 'Legendary Thamel momo spot; try the jhol (soup) momos', location: 'Thamel' },
      { id: 'n3-5', title: 'Asan Bazaar street photography', category: 'photography', time: '14:30', duration: '2h', notes: 'Oldest market in the city — spices, fabrics and hidden temples; ask permission for portraits', location: 'Asan, Kathmandu' },
      { id: 'n3-6', title: 'Sunset at Boudhanath Stupa', category: 'sightseeing', time: '16:30', duration: '2h', notes: 'Walk clockwise with the pilgrims; shoot the golden-hour dome from a rooftop cafe', location: 'Boudha, Kathmandu' },
    ],
  },
  {
    date: '2026-12-12',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n4-1', title: 'Morning aarti at Pashupatinath Temple', category: 'cultural', time: '07:00', duration: '2.5h', notes: 'Sacred Hindu temple on the Bagmati; cremation ghats and ritual — photograph with sensitivity (non-Hindus cannot enter the main shrine)', location: 'Pashupatinath' },
      { id: 'n4-2', title: 'Kopan Monastery viewpoint', category: 'photography', time: '10:00', duration: '2h', notes: 'Hilltop monastery overlooking Boudhanath; prayer flags and golden roofs — respect quiet hours', location: 'Kopan Hill, Boudha' },
      { id: 'n4-3', title: 'Lunch at Himalayan Java', category: 'food', time: '12:30', duration: '1h', notes: 'Nepali-grown coffee and a light bite at the garden-view branch', location: 'Boudha, Kathmandu' },
      { id: 'n4-4', title: 'Garden of Dreams', category: 'free', time: '14:30', duration: '2h', notes: 'Neo-classical garden oasis — fountains and pavilions, a calm break from the city bustle', location: 'Kaiser Mahal, Kathmandu' },
      { id: 'n4-5', title: 'Dinner at Roadhouse Cafe', category: 'food', time: '18:30', duration: '1.5h', notes: 'Best wood-fired pizza in town with a craft-beer selection; lively Thamel branch', location: 'Thamel' },
    ],
  },
  {
    date: '2026-12-13',
    city: 'Lalitpur',
    country: 'nepal',
    items: [
      { id: 'n5-1', title: 'Patan Durbar Square', category: 'sightseeing', time: '08:30', duration: '3h', notes: 'The finest Newari architecture — Krishna Temple and the Golden Temple ring the square', location: 'Lalitpur' },
      { id: 'n5-2', title: 'Patan Museum', category: 'cultural', time: '11:30', duration: '1.5h', notes: 'The best museum in Nepal — Hindu & Buddhist bronze and stone art in a restored palace', location: 'Patan' },
      { id: 'n5-3', title: 'Lunch at Cafe Swotha', category: 'food', time: '13:30', duration: '1.5h', notes: 'Newari set meal in a beautifully restored heritage courtyard', location: 'Patan' },
      { id: 'n5-4', title: 'Patan alley courtyards & metalwork', category: 'shopping', time: '15:30', duration: '1.5h', notes: 'Wander the back lanes for hidden bahals and workshops; Patan is famous for handmade bronze and silver', location: 'Patan' },
      { id: 'n5-5', title: 'Golden-hour street photography in Patan', category: 'photography', time: '17:00', duration: '1.5h', notes: 'Warm side light filters through the narrow streets and brick facades', location: 'Patan' },
    ],
  },
  {
    date: '2026-12-14',
    city: 'Nagarkot',
    country: 'nepal',
    items: [
      { id: 'n6-1', title: 'Pre-dawn drive to Nagarkot', category: 'transportation', time: '04:30', duration: '1.5h', notes: 'Early departure to reach the ridge before first light', location: 'Kathmandu → Nagarkot' },
      { id: 'n6-2', title: 'Himalayan sunrise viewpoint', category: 'photography', time: '06:00', duration: '2h', notes: 'Panorama over the Everest, Langtang and Ganesh Himal ranges; telephoto 70-200mm and a tripod essential', location: 'Nagarkot View Tower' },
      { id: 'n6-3', title: 'Mountain breakfast at Club Himalaya', category: 'food', time: '08:30', duration: '1h', notes: 'Relaxed breakfast with the range still in view', location: 'Nagarkot' },
      { id: 'n6-4', title: 'Bhaktapur Durbar Square', category: 'cultural', time: '11:00', duration: '4h', notes: 'Best-preserved medieval city — 55-Window Palace, Nyatapola Temple and the pottery square', location: 'Bhaktapur' },
      { id: 'n6-5', title: 'Juju Dhau (King Curd) tasting', category: 'food', time: '15:00', duration: '30min', notes: 'The famous Bhaktapur sweet yogurt served in a clay pot — a must-try', location: 'Bhaktapur' },
      { id: 'n6-6', title: 'Drive back to Kathmandu', category: 'transportation', time: '16:00', duration: '1.5h', notes: 'Return to the hotel; quiet evening to rest', location: 'Bhaktapur → Kathmandu' },
    ],
  },
  {
    date: '2026-12-15',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n7-1', title: 'Chandragiri Hills cable car', category: 'nature', time: '08:00', duration: '3.5h', notes: 'Cable car to a hilltop with Himalayan and valley views; December offers the clearest skies — bring layers for the cold at the top', location: 'Chandragiri' },
      { id: 'n7-2', title: 'Summit photography — Everest on a clear day', category: 'photography', time: '11:30', duration: '1h', notes: 'On a clear winter morning the distant peaks line the horizon; telephoto for compressed ridges', location: 'Chandragiri summit' },
      { id: 'n7-3', title: 'Lunch at Thakali Kitchen', category: 'food', time: '13:30', duration: '1h', notes: 'Authentic Thakali dal bhat with unlimited refills — the quintessential Nepali meal', location: 'Kathmandu' },
      { id: 'n7-4', title: 'Budhanilkantha (Sleeping Vishnu)', category: 'cultural', time: '15:00', duration: '1.5h', notes: "Nepal's largest stone statue — a 5-metre reclining Vishnu floating in a water tank", location: 'Budhanilkantha, north Kathmandu' },
      { id: 'n7-5', title: 'Dinner & live music in Thamel', category: 'nightlife', time: '19:00', duration: '2h', notes: 'Wind down with a rooftop dinner and a local band in the tourist quarter', location: 'Thamel' },
    ],
  },
  {
    date: '2026-12-16',
    city: 'Bhaktapur',
    country: 'nepal',
    items: [
      { id: 'n8-1', title: 'Changu Narayan Temple', category: 'cultural', time: '08:00', duration: '2h', notes: 'The oldest Hindu temple in the valley and a UNESCO site — exquisite 5th-century stone and woodcarving', location: 'Changunarayan Hill' },
      { id: 'n8-2', title: 'Hike down toward Bhaktapur', category: 'nature', time: '10:00', duration: '2h', notes: 'Gentle ridge walk through terraced fields with valley views; easy half-day trail', location: 'Changunarayan → Bhaktapur' },
      { id: 'n8-3', title: 'Pottery Square & lunch in Bhaktapur', category: 'food', time: '12:30', duration: '1.5h', notes: 'Watch potters at the wheel, then a Newari lunch in the old town', location: 'Bhaktapur' },
      { id: 'n8-4', title: 'Taudaha Lake birdwatching', category: 'nature', time: '15:30', duration: '1.5h', notes: 'Tranquil lake on the valley rim — December is best for migratory birds; tea stalls along the shore', location: 'Chobhar' },
      { id: 'n8-5', title: 'Quiet dinner near the hotel', category: 'food', time: '19:00', duration: '1.5h', notes: 'Low-key evening to recharge before the final days', location: 'Keshar Mahal Marga, Kathmandu' },
    ],
  },
  {
    date: '2026-12-17',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n9-1', title: 'Pre-dawn climb to Phulchowki', category: 'photography', time: '05:30', duration: '4h', notes: "The valley's highest rim peak, blanketed in rhododendron forest — layered ridge-lines and a Himalayan panorama on clear December mornings", location: 'Phulchowki, Godavari' },
      { id: 'n9-2', title: 'Godavari Botanical Garden', category: 'nature', time: '10:00', duration: '1.5h', notes: 'Peaceful gardens at the foot of Phulchowki — a calm stroll after the climb', location: 'Godavari' },
      { id: 'n9-3', title: 'Lunch back in Patan', category: 'food', time: '13:00', duration: '1h', notes: 'Refuel on the way back into the city', location: 'Patan' },
      { id: 'n9-4', title: 'Chobhar Gorge & Jal Binayak', category: 'sightseeing', time: '15:00', duration: '2h', notes: 'Dramatic gorge where the Bagmati cuts the valley rim; vintage suspension bridge and a riverside temple in soft afternoon light', location: 'Chobhar' },
      { id: 'n9-5', title: 'Farewell dinner at OR2K rooftop', category: 'food', time: '18:30', duration: '1.5h', notes: 'A relaxed last proper Nepal dinner with sunset rooftop views', location: 'Thamel' },
    ],
  },
  {
    date: '2026-12-18',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n10-1', title: 'Slow breakfast & last city views', category: 'free', time: '08:00', duration: '1.5h', notes: 'No rush this morning — coffee and a final look over the valley', location: 'Kathmandu' },
      { id: 'n10-2', title: 'Souvenir shopping in Thamel & Asan', category: 'shopping', time: '10:00', duration: '2.5h', notes: 'Pashmina, singing bowls, Nepali tea, prayer flags and handmade paper — last gifts before Japan', location: 'Thamel & Asan, Kathmandu' },
      { id: 'n10-3', title: 'Lunch at Cafe Swotha', category: 'food', time: '13:00', duration: '1.5h', notes: 'One more Newari meal in the Patan courtyard', location: 'Patan' },
      { id: 'n10-4', title: 'Garden of Dreams — afternoon unwind', category: 'free', time: '15:00', duration: '1.5h', notes: 'Quiet pavilions and fountains to close out the Nepal leg', location: 'Kaiser Mahal, Kathmandu' },
      { id: 'n10-5', title: 'Check out & transfer to airport (KTM)', category: 'transportation', time: '20:30', duration: '2h', notes: 'Check out of Tulsi Kathmandu Hotel, last dinner, and head to Tribhuvan for the late-night departure', location: 'Tulsi Kathmandu Hotel → Tribhuvan Intl (KTM)' },
      { id: 'n10-6', title: 'Depart Kathmandu (KTM) → Guangzhou (CAN) — China Southern 3068', category: 'transportation', time: '23:30', duration: '4h 10m', notes: 'KTM Terminal I → CAN Terminal 2 · China Southern 3068 · arrives 5:55am Dec 19 · Economy. Overnight flight — sleep if you can', location: 'Kathmandu (KTM) → Guangzhou Baiyun (CAN T2)' },
    ],
  },
  {
    date: '2026-12-19',
    city: 'Osaka',
    country: 'japan',
    items: [
      { id: 'j1-1', title: 'Layover at Guangzhou (CAN) Terminal 2', category: 'transportation', time: '05:55', duration: '2h 55m', notes: 'Early-morning connection at Baiyun Intl before the flight to Tokyo', location: 'Guangzhou Baiyun Intl — Terminal 2' },
      { id: 'j1-2', title: 'Fly Guangzhou (CAN) → Tokyo Haneda (HND) — China Southern 385', category: 'transportation', time: '08:50', duration: '3h 45m', notes: 'CAN T2 → HND Terminal 3 · China Southern 385 · arrives 1:35pm · Economy. Fill out Visit Japan Web before landing', location: 'Guangzhou (CAN T2) → Tokyo Haneda (HND T3)' },
      { id: 'j1-3', title: 'Immigration, baggage & transfer to Haneda domestic terminal (T1)', category: 'transportation', time: '13:45', duration: '2h 40m', notes: 'Clear immigration and collect baggage after the international arrival, then transfer across Haneda to the domestic terminal (T1) to check in for the Osaka flight', location: 'Tokyo Haneda (HND T3 → T1)' },
      { id: 'j1-3b', title: 'Fly Tokyo Haneda (HND) → Osaka Itami (ITM) — Japan Airlines 127', category: 'transportation', time: '16:25', duration: '1h 10m', notes: 'HND Terminal 1 → ITM · Japan Airlines 127 · arrives 5:35pm · Economy (Q). Real booked domestic flight — render the times exactly as booked', location: 'Tokyo Haneda (HND T1) → Osaka Itami (ITM)' },
      { id: 'j1-4', title: 'Check in to Hotel The Grandee Shinsaibashi', category: 'hotel', time: '18:15', duration: '1h', notes: 'Real booked hotel — 1-6-28 Higashi-Shinsaibashi, Osaka, 542-0083 Japan. Drop bags and freshen up before the first Osaka night out', location: 'Hotel The Grandee Shinsaibashi, Osaka' },
      { id: 'j1-5', title: 'Dotonbori evening walk & the Glico sign', category: 'sightseeing', time: '19:00', duration: '1.5h', notes: 'First look at the neon canal-front strip — the Glico Running Man sign, the giant crab and puffer-fish signs; an easy, low-effort orientation for jet-lagged legs', location: 'Dotonbori, Osaka' },
      { id: 'j1-6', title: 'Namba/Shinsaibashi bars & late-night food', category: 'nightlife', time: '21:00', duration: '3h', notes: 'Ease into the trip with a first round of Namba/Shinsaibashi bars, then ramen or takoyaki to close out night one — confirm cover charges and drink prices before sitting down', location: 'Namba/Shinsaibashi, Osaka' },
    ],
  },
  {
    date: '2026-12-20',
    city: 'Osaka',
    country: 'japan',
    items: [
      { id: 'j2-1', title: 'Osaka Castle & grounds', category: 'sightseeing', time: '09:30', duration: '2h', notes: 'Reconstructed keep with a museum and skyline views; the moat and plum grove are crisp and quiet in winter', location: 'Chuo, Osaka' },
      { id: 'j2-2', title: 'Lunch near Namba', category: 'food', time: '12:00', duration: '1h', notes: 'Casual bite before the afternoon shopping run', location: 'Namba, Osaka' },
      { id: 'j2-3', title: 'Shinsaibashi shopping & Amerikamura', category: 'shopping', time: '13:30', duration: '2.5h', notes: "The long covered Shinsaibashi-suji arcade for shopping, then Amerikamura's streetwear blocks and casual cafes next door", location: 'Shinsaibashi & Amerikamura, Osaka' },
      { id: 'j2-4', title: 'Dotonbori dinner', category: 'food', time: '18:00', duration: '1.5h', notes: 'Takoyaki, okonomiyaki and the canal-front neon before the night out', location: 'Dotonbori, Osaka' },
      { id: 'j2-5', title: 'Shinsaibashi/Amerikamura party night', category: 'nightlife', time: '21:00', duration: '3h', notes: 'The first big party night — bar and club hopping through Shinsaibashi and Amerikamura; agree the cover charge and any drink minimum before going in', location: 'Shinsaibashi/Amerikamura, Osaka' },
    ],
  },
  {
    date: '2026-12-21',
    city: 'Osaka',
    country: 'japan',
    items: [
      { id: 'j3-1', title: 'Universal Studios Japan — Super Nintendo World', category: 'sightseeing', time: '09:00', duration: '8h', notes: 'A full day at USJ; prioritize Super Nintendo World and an Express Pass if available — check current anime/game collaborations closer to the date', location: 'Universal Studios Japan, Konohana, Osaka' },
      { id: 'j3-2', title: 'Lunch inside the park', category: 'food', time: '13:00', duration: '1h', notes: 'Quick refuel between rides', location: 'Universal Studios Japan, Osaka' },
      { id: 'j3-3', title: 'Dinner near Namba', category: 'food', time: '19:00', duration: '1.5h', notes: 'Recover from a long theme-park day before a lighter night', location: 'Namba, Osaka' },
      { id: 'j3-4', title: 'Lighter Namba night', category: 'nightlife', time: '21:00', duration: '2h', notes: 'A lower-key night after USJ — late food and a couple of easy bars in Namba', location: 'Namba, Osaka' },
    ],
  },
  {
    date: '2026-12-22',
    city: 'Osaka',
    country: 'japan',
    items: [
      { id: 'j4-1', title: 'Den Den Town / Nipponbashi anime shopping', category: 'shopping', time: '10:30', duration: '3h', notes: "Osaka's anime and electronics district — hunt for One Piece, Naruto and Dragon Ball Z figures and collectibles across the arcade's specialty shops", location: 'Nipponbashi, Osaka' },
      { id: 'j4-2', title: 'Lunch in Nipponbashi', category: 'food', time: '13:30', duration: '1h', notes: 'Casual lunch between the figure shops', location: 'Nipponbashi, Osaka' },
      { id: 'j4-3', title: 'Dotonbori food crawl', category: 'food', time: '18:00', duration: '2h', notes: 'A second pass through Dotonbori for more street food before the night out', location: 'Dotonbori, Osaka' },
      { id: 'j4-4', title: 'Namba/Shinsaibashi bars & clubs', category: 'nightlife', time: '21:00', duration: '3h', notes: 'Another round through Namba and Shinsaibashi — mix up the venues from the first party night', location: 'Namba/Shinsaibashi, Osaka' },
    ],
  },
  {
    date: '2026-12-23',
    city: 'Osaka',
    country: 'japan',
    items: [
      { id: 'j5-1', title: 'Shinsekai & Spa World flex day', category: 'sightseeing', time: '10:30', duration: '4h', notes: 'The retro Shinsekai district under Tsutenkaku Tower for kushikatsu and old-Osaka atmosphere, then an afternoon soak at the Spa World bathhouse complex — a relaxed recovery day before the last Osaka night', location: 'Shinsekai, Osaka' },
      { id: 'j5-2', title: 'Lunch — kushikatsu in Shinsekai', category: 'food', time: '13:00', duration: '1h', notes: "Deep-fried skewers, Osaka's other signature street food; the rule is no double-dipping the sauce", location: 'Shinsekai, Osaka' },
      { id: 'j5-3', title: 'Dinner before the final Osaka night', category: 'food', time: '18:30', duration: '1.5h', notes: 'Fuel up before the biggest party night of the Osaka leg', location: 'Namba, Osaka' },
      { id: 'j5-4', title: 'Biggest Osaka party night', category: 'nightlife', time: '21:30', duration: '3.5h', notes: "The final and biggest Osaka night out across Shinsaibashi, Amerikamura and Namba before the move to Kyoto — pace the group for tomorrow's checkout", location: 'Shinsaibashi/Amerikamura/Namba, Osaka' },
    ],
  },
  {
    date: '2026-12-24',
    city: 'Kyoto',
    country: 'japan',
    items: [
      { id: 'j6-1', title: 'Check out of Osaka hotel', category: 'hotel', time: '10:00', duration: '1h', notes: 'Pack up and settle out before the short hop to Kyoto', location: 'Osaka' },
      { id: 'j6-2', title: 'Osaka → Kyoto by JR train', category: 'transportation', time: '11:30', duration: '45min', notes: 'JR Special Rapid (or Shinkansen, depending on exact hotel locations) from Osaka/Umeda to Kyoto Station; a light travel day — keep Christmas Eve easy', location: 'Osaka → Kyoto' },
      { id: 'j6-3', title: 'Check in to Hotel Forza Kyoto Shijo Kawaramachi', category: 'hotel', time: '14:00', duration: '1h', notes: 'Real booked hotel (official check-in 2:00pm) — Shijo-Dori, Fuya, Nishihairu, Tachiuri, Kyoto, 600-8005 Japan. Drop bags and rest before the Christmas Eve evening', location: 'Hotel Forza Kyoto Shijo Kawaramachi, Kyoto' },
      { id: 'j6-4', title: 'Pontocho Christmas Eve dinner', category: 'food', time: '18:30', duration: '2h', notes: 'Dinner down the narrow riverside lane — obanzai (Kyoto home cooking) or a casual yudofu hot-pot to warm up; reserve ahead if possible', location: 'Pontocho, Kyoto' },
      { id: 'j6-5', title: 'Kiyamachi-dori bars', category: 'nightlife', time: '21:00', duration: '2.5h', notes: "Kyoto's main drinking street for a lighter first night — keep it easy after the transfer day", location: 'Kiyamachi-dori, Kyoto' },
    ],
  },
  {
    date: '2026-12-25',
    city: 'Kyoto',
    country: 'japan',
    items: [
      { id: 'j7-1', title: 'Dawn at Fushimi Inari', category: 'photography', time: '06:30', duration: '2.5h', notes: 'Thousands of vermillion torii winding up the mountain; arrive before 7 AM for empty tunnel shots, use the gates as leading lines', location: 'Fushimi, Kyoto' },
      { id: 'j7-2', title: 'Inari-style breakfast & tea', category: 'food', time: '09:30', duration: '1h', notes: 'Kitsune udon and inari-zushi at a shrine-approach stall after the climb', location: 'Fushimi, Kyoto' },
      { id: 'j7-3', title: 'Higashiyama & Kiyomizu-dera', category: 'cultural', time: '12:00', duration: '2.5h', notes: 'Hilltop temple with its wooden stage over the valley, then the preserved Sannenzaka/Ninenzaka slopes down through Higashiyama', location: 'Higashiyama, Kyoto' },
      { id: 'j7-4', title: 'Gion evening walk', category: 'sightseeing', time: '17:00', duration: '1.5h', notes: 'Stroll the lantern-lit lanes of Gion and Hanamikoji as they light up for Christmas evening', location: 'Gion, Kyoto' },
      { id: 'j7-5', title: 'Pontocho/Kawaramachi bars', category: 'nightlife', time: '20:30', duration: '2.5h', notes: 'Christmas night bars along Pontocho and Kawaramachi — traditional atmosphere with an easy night out', location: 'Pontocho/Kawaramachi, Kyoto' },
    ],
  },
  {
    date: '2026-12-26',
    city: 'Kyoto',
    country: 'japan',
    items: [
      { id: 'j8-1', title: 'Early Arashiyama Bamboo Grove', category: 'photography', time: '07:00', duration: '1.5h', notes: 'Walk the towering bamboo path before the crowds; arrive before 8 AM and look straight up for the canopy shot with an ultra-wide', location: 'Arashiyama, Kyoto' },
      { id: 'j8-2', title: 'Tenryu-ji garden & Togetsukyo Bridge', category: 'nature', time: '08:45', duration: '1.5h', notes: 'Zen garden with borrowed-scenery mountains, then the riverside Togetsukyo Bridge with the winter hills behind. Optional: the Iwatayama Monkey Park across the bridge', location: 'Arashiyama, Kyoto' },
      { id: 'j8-3', title: 'Lunch — yudofu by the river', category: 'food', time: '11:00', duration: '1h', notes: 'Simmering tofu hot-pot, an Arashiyama winter speciality, beside the Hozu River', location: 'Arashiyama, Kyoto' },
      { id: 'j8-4', title: 'Nishiki Market & Kawaramachi', category: 'shopping', time: '14:00', duration: '2h', notes: '"Kyoto\'s Kitchen" covered arcade for pickles, knives, yuba and sweets, spilling into the Kawaramachi shopping streets', location: 'Nishiki Market & Kawaramachi, Kyoto' },
      { id: 'j8-5', title: 'Final Kyoto night — Gion/Kiyamachi', category: 'nightlife', time: '20:00', duration: '3h', notes: "The final Kyoto night out — Gion's traditional bars into the Kiyamachi strip before the move to Tokyo tomorrow", location: 'Gion/Kiyamachi-dori, Kyoto' },
    ],
  },
  {
    date: '2026-12-27',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j9-1', title: 'Check out of Hotel Forza Kyoto Shijo Kawaramachi', category: 'hotel', time: '11:00', duration: '1h', notes: 'Real booked checkout time — pack up before the Shinkansen to Tokyo', location: 'Kyoto' },
      { id: 'j9-2', title: 'Kyoto → Tokyo by Shinkansen', category: 'transportation', time: '12:30', duration: '2.5h', notes: 'Tokaido Shinkansen from Kyoto Station to Tokyo/Shinagawa; book seats ahead — this is New Year travel season. Right-side seats for a Mt Fuji glimpse past Shizuoka', location: 'Kyoto → Tokyo' },
      { id: 'j9-3', title: 'Check in to Tokyo hotel (Shinjuku/Kabukicho edge)', category: 'hotel', time: '15:30', duration: '1h', notes: 'Not yet booked at itinerary-writing time — target the Shinjuku/Kabukicho edge (Higashi-Shinjuku, Seibu-Shinjuku or Shinjuku-sanchome) for easy walking access to nightlife; 3 separate rooms, same hotel (see the to-book list)', location: 'Shinjuku, Tokyo' },
      { id: 'j9-4', title: 'Omoide Yokocho food & drinks', category: 'food', time: '18:30', duration: '1.5h', notes: '"Memory Lane" — lantern-lit yakitori stalls under the Shinjuku tracks; an easy orientation dinner. Cash only', location: 'Shinjuku, Tokyo' },
      { id: 'j9-5', title: 'Kabukicho walk, Golden Gai & Shinjuku bars', category: 'nightlife', time: '20:30', duration: '3h', notes: "Orientation night — walk Kabukicho's neon blocks, then bar-hop through Golden Gai's tiny alleys; look for an English-friendly sign", location: 'Kabukicho & Golden Gai, Shinjuku' },
    ],
  },
  {
    date: '2026-12-28',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j10-1', title: 'Senso-ji Temple & Nakamise-dori', category: 'cultural', time: '09:30', duration: '2h', notes: "Tokyo's oldest Buddhist temple — the Thunder Gate (Kaminarimon), the main hall, and the Nakamise-dori approach lined with snack and souvenir stalls", location: 'Asakusa, Tokyo' },
      { id: 'j10-2', title: 'Lunch in Asakusa', category: 'food', time: '12:00', duration: '1h', notes: 'Casual bite near the temple before heading to Ueno', location: 'Asakusa, Tokyo' },
      { id: 'j10-3', title: 'Ueno Park & Ameyoko Market', category: 'sightseeing', time: '13:30', duration: '2.5h', notes: 'A relaxed park stroll, then the bustling Ameyoko market street under the train tracks for snacks and cheap finds', location: 'Ueno, Tokyo' },
      { id: 'j10-4', title: 'Dinner in Shinjuku', category: 'food', time: '18:30', duration: '1.5h', notes: 'Back to the home base for dinner', location: 'Shinjuku, Tokyo' },
      { id: 'j10-5', title: 'Easy Shinjuku night', category: 'nightlife', time: '21:00', duration: '2.5h', notes: 'A lighter night after a sightseeing-heavy day — an easy Shinjuku bar round', location: 'Shinjuku, Tokyo' },
    ],
  },
  {
    date: '2026-12-29',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j11-1', title: 'Akihabara anime/figures/games/arcades', category: 'shopping', time: '10:00', duration: '4h', notes: 'Multi-floor arcades, manga shops and figure stores — hunt for One Piece, Naruto, DBZ figures and Jump merch. Super Potato for retro games', location: 'Akihabara, Tokyo' },
      { id: 'j11-2', title: 'Lunch in Akihabara', category: 'food', time: '14:00', duration: '1h', notes: 'Quick curry or a themed anime cafe between the figure shops', location: 'Akihabara, Tokyo' },
      { id: 'j11-3', title: 'GiGO arcade & gachapon', category: 'free', time: '15:30', duration: '1.5h', notes: 'Floors of UFO-catchers, rhythm games and retro cabinets; bring a stack of 100-yen coins', location: 'Akihabara, Tokyo' },
      { id: 'j11-4', title: 'Dinner in Shinjuku', category: 'food', time: '18:30', duration: '1.5h', notes: 'Reset before the night out', location: 'Shinjuku, Tokyo' },
      { id: 'j11-5', title: 'Shinjuku/Kabukicho bars & nightlife', category: 'nightlife', time: '21:00', duration: '3h', notes: 'Another round through the Shinjuku/Kabukicho base — try a different strip of bars each night', location: 'Shinjuku/Kabukicho, Tokyo' },
    ],
  },
  {
    date: '2026-12-30',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j12-1', title: 'Shibuya Crossing & Shibuya Sky', category: 'sightseeing', time: '10:00', duration: '2h', notes: "The world's busiest crossing from ground level, then the open-air Shibuya Sky observation deck for the view down onto it", location: 'Shibuya, Tokyo' },
      { id: 'j12-2', title: 'Harajuku — Takeshita-dori & Omotesando', category: 'shopping', time: '12:30', duration: '2h', notes: 'Youth-fashion chaos on Takeshita-dori, then the tree-lined Omotesando; check for anime pop-ups and Jump-related events along the way', location: 'Harajuku, Tokyo' },
      { id: 'j12-3', title: 'Shibuya dinner', category: 'food', time: '18:00', duration: '1.5h', notes: 'Fuel up before the big club night', location: 'Shibuya, Tokyo' },
      { id: 'j12-4', title: 'Shibuya or Roppongi club night', category: 'nightlife', time: '21:00', duration: '3.5h', notes: "Prioritize rap/hip-hop events if available — Shibuya's younger club scene, or Roppongi as the international backup", location: 'Shibuya/Roppongi, Tokyo' },
    ],
  },
  {
    date: '2026-12-31',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j13-1', title: 'Late brunch & easy shopping', category: 'free', time: '11:00', duration: '2h', notes: 'Keep the daytime light — rest up for the big night ahead', location: 'Shinjuku, Tokyo' },
      { id: 'j13-2', title: 'Pre-game dinner', category: 'food', time: '18:00', duration: '1.5h', notes: 'A relaxed dinner in Shinjuku or Shibuya before the countdown', location: 'Shinjuku/Shibuya, Tokyo' },
      { id: 'j13-3', title: "New Year's Eve club/event", category: 'nightlife', time: '21:30', duration: '4h', notes: 'Book NYE tickets in advance if a strong event is found in Shinjuku, Shibuya or Roppongi — avoid relying on random street promoters', location: 'Shinjuku/Shibuya/Roppongi, Tokyo' },
      { id: 'j13-4', title: 'New Year countdown', category: 'nightlife', time: '23:45', duration: '1h', notes: "See in 2027 with the club/event crowd; trains run all night on New Year's Eve", location: 'Tokyo' },
    ],
  },
  {
    date: '2027-01-01',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j14-1', title: 'Recovery morning', category: 'free', time: '11:00', duration: '2h', notes: "A deliberately late start after New Year's Eve", location: 'Shinjuku, Tokyo' },
      { id: 'j14-2', title: 'Meiji Shrine hatsumode (if energy allows)', category: 'cultural', time: '14:00', duration: '2h', notes: 'The first shrine visit of the year draws big New Year crowds; many places keep holiday hours, so treat this as optional if the group needs the extra rest', location: 'Harajuku, Tokyo' },
      { id: 'j14-3', title: 'New Year lunch', category: 'food', time: '16:30', duration: '1h', notes: 'Note many restaurants shut on Jan 1 — a hotel-area spot or konbini is a reliable backup', location: 'Shinjuku, Tokyo' },
      { id: 'j14-4', title: 'Low-pressure Shinjuku bars', category: 'nightlife', time: '20:00', duration: '2h', notes: 'A calmer chill night — some venues may be closed for the holiday, so keep expectations light', location: 'Shinjuku, Tokyo' },
    ],
  },
  {
    date: '2027-01-02',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j15-1', title: 'Ikebukuro & Sunshine City anime day', category: 'shopping', time: '10:30', duration: '3h', notes: 'Anime stores, the Pokémon Center, gashapon walls and character-goods pop-ups; holiday and New Year limited-edition merch appears in early January', location: 'Ikebukuro, Tokyo' },
      { id: 'j15-2', title: 'Lunch in Ikebukuro', category: 'food', time: '14:00', duration: '1h', notes: 'Easy lunch between the shops', location: 'Ikebukuro, Tokyo' },
      { id: 'j15-3', title: 'Dinner in Shinjuku', category: 'food', time: '18:30', duration: '1.5h', notes: 'Back to the home base for dinner', location: 'Shinjuku, Tokyo' },
      { id: 'j15-4', title: 'Kabukicho/Shinjuku nightlife', category: 'nightlife', time: '21:00', duration: '3h', notes: "Another Shinjuku/Kabukicho night — the group's reliable go-to base", location: 'Kabukicho, Shinjuku' },
    ],
  },
  {
    date: '2027-01-03',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j16-1', title: "Nakano Broadway collectors' run", category: 'shopping', time: '10:30', duration: '2.5h', notes: 'Retro multi-floor mall — the original Mandarake, vintage manga, cels and rare Dragon Ball/Naruto/One Piece figures; quieter than Akihabara', location: 'Nakano, Tokyo' },
      { id: 'j16-2', title: 'Koenji thrift & streetwear (optional)', category: 'free', time: '13:30', duration: '1.5h', notes: 'An optional afternoon detour nearby for thrift shops, streetwear and low-key bar culture', location: 'Koenji, Tokyo' },
      { id: 'j16-3', title: 'Omoide Yokocho dinner', category: 'food', time: '18:00', duration: '1.5h', notes: 'A second round of yakitori-alley food before the last stretch of nights', location: 'Shinjuku, Tokyo' },
      { id: 'j16-4', title: 'Golden Gai & Kabukicho', category: 'nightlife', time: '20:30', duration: '3h', notes: 'Bar-hop a different corner of Golden Gai, then into Kabukicho', location: 'Golden Gai & Kabukicho, Shinjuku' },
    ],
  },
  {
    date: '2027-01-04',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j17-1', title: 'Tokyo Tower & Roppongi Hills/Mori', category: 'sightseeing', time: '10:30', duration: '3h', notes: "Daytime look at the 333m Tokyo Tower and the Roppongi Hills/Mori area ahead of tonight's nightlife focus", location: 'Roppongi/Minato, Tokyo' },
      { id: 'j17-2', title: 'Lunch near Roppongi', category: 'food', time: '14:00', duration: '1h', notes: 'Casual lunch before the afternoon wind-down', location: 'Roppongi, Tokyo' },
      { id: 'j17-3', title: 'Roppongi dinner', category: 'food', time: '18:30', duration: '1.5h', notes: 'Dinner near the lights before the club night', location: 'Roppongi, Tokyo' },
      { id: 'j17-4', title: 'Roppongi clubs/bars', category: 'nightlife', time: '21:00', duration: '3.5h', notes: "Roppongi's foreigner-friendly, international club scene — prioritize hip-hop/rap events where available; watch for overcharging and tout traps in this district", location: 'Roppongi, Tokyo' },
    ],
  },
  {
    date: '2027-01-05',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j18-1', title: 'Warner Bros. Studio Tour Tokyo', category: 'sightseeing', time: '10:00', duration: '4h', notes: 'The Harry Potter studio-tour attraction — a major themed day out; alternative is the Ghibli Museum or an anime cafe/pop-up day if tickets are unavailable', location: 'Toshimaen, Nerima, Tokyo' },
      { id: 'j18-2', title: 'Lunch at the studio tour', category: 'food', time: '14:30', duration: '1h', notes: 'On-site cafe between the sets', location: 'Toshimaen, Tokyo' },
      { id: 'j18-3', title: 'Dinner in Shinjuku', category: 'food', time: '18:30', duration: '1.5h', notes: 'Back to base for dinner', location: 'Shinjuku, Tokyo' },
      { id: 'j18-4', title: 'Shinjuku nightlife', category: 'nightlife', time: '21:00', duration: '3h', notes: 'An easy Shinjuku night to close out the day', location: 'Shinjuku, Tokyo' },
    ],
  },
  {
    date: '2027-01-06',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j19-1', title: 'TeamLab (Borderless or Planets)', category: 'sightseeing', time: '10:00', duration: '3h', notes: 'Immersive digital-art museum of ever-changing light and projection rooms; pre-booked timed ticket, wear white/light colours for the best effect', location: 'Azabudai Hills / Toyosu, Tokyo' },
      { id: 'j19-2', title: 'Lunch nearby', category: 'food', time: '13:30', duration: '1h', notes: 'Casual bite after the museum', location: 'Tokyo' },
      { id: 'j19-3', title: 'Dinner', category: 'food', time: '18:00', duration: '1.5h', notes: "Pick the neighbourhood based on tonight's best event", location: 'Tokyo' },
      { id: 'j19-4', title: 'Shibuya, Roppongi or Shinjuku night', category: 'nightlife', time: '20:30', duration: '3.5h', notes: 'Choose the venue closest to wherever the best event is tonight', location: 'Shibuya/Roppongi/Shinjuku, Tokyo' },
    ],
  },
  {
    date: '2027-01-07',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j20-1', title: 'Last souvenir & anime-merch shopping', category: 'shopping', time: '10:00', duration: '3h', notes: 'Shibuya, Harajuku, Akihabara, Nakano or Ikebukuro — whichever still has gaps to fill; souvenirs, streetwear and gifts', location: 'Tokyo' },
      { id: 'j20-2', title: 'Lunch', category: 'food', time: '13:30', duration: '1h', notes: 'Quick refuel between shopping stops', location: 'Tokyo' },
      { id: 'j20-3', title: 'Final dinner', category: 'food', time: '18:30', duration: '2h', notes: 'A proper final-full-day dinner to mark the trip winding down; reserve ahead', location: 'Shinjuku, Tokyo' },
      { id: 'j20-4', title: 'Final major club/bar night', category: 'nightlife', time: '21:00', duration: '4h', notes: 'The last big scheduled night — Shinjuku, Shibuya or Roppongi, whichever has the best event', location: 'Shinjuku/Shibuya/Roppongi, Tokyo' },
    ],
  },
  {
    date: '2027-01-08',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j21-1', title: 'Tokyo DisneySea', category: 'sightseeing', time: '09:00', duration: '8h', notes: 'A relaxed bonus day at Tokyo DisneySea — themed lands, rides and parades; a lighter, change-of-pace day before the very last night out', location: 'Urayasu, Chiba' },
      { id: 'j21-2', title: 'Dinner near the hotel', category: 'food', time: '19:00', duration: '1.5h', notes: 'Reset after a full park day', location: 'Shinjuku, Tokyo' },
      { id: 'j21-3', title: 'One more big night out', category: 'nightlife', time: '21:00', duration: '4h', notes: "The group's \"party 95% of nights\" preference gets one more full night — Shinjuku, Shibuya or Roppongi, whichever still has the best energy; Jan 9 is not an early flight, so there's no need to hold back", location: 'Shinjuku/Shibuya/Roppongi, Tokyo' },
    ],
  },
  {
    date: '2027-01-09',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j22-1', title: 'Slow final breakfast & checkout', category: 'free', time: '09:00', duration: '1.5h', notes: 'Unhurried last morning after the final night out; check out of the Shinjuku hotel late morning', location: 'Shinjuku, Tokyo' },
      { id: 'j22-2', title: 'Last-minute shopping (if time allows)', category: 'shopping', time: '11:00', duration: '1.5h', notes: 'A light last-minute souvenir run, or simply resting up before the flight home', location: 'Shinjuku, Tokyo' },
      { id: 'j22-3', title: 'Transfer to Haneda (HND)', category: 'transportation', time: '13:00', duration: '2h', notes: 'Tokyo/Shinjuku to Haneda by train or airport limousine bus; allow ~3h before the international departure and check in for the flight home', location: 'Shinjuku, Tokyo → Haneda (HND)' },
      { id: 'j22-4', title: 'Fly Tokyo Haneda (HND) → Detroit (DTW) — Delta 274', category: 'transportation', time: '17:35', duration: '12h', notes: 'HND Terminal 3 → DTW Terminal M · Delta 274 · departs 5:35pm, arrives 3:35pm the same calendar day (Jan 9), crossing the international date line eastbound · Economy. Real booked return flight — render the times exactly as booked', location: 'Tokyo Haneda (HND T3) → Detroit Metro (DTW Terminal M)' },
      { id: 'j22-5', title: 'Layover at Detroit (DTW) Terminal M', category: 'transportation', time: '15:35', duration: '6h', notes: 'Connection at Detroit Metro before the final short hop home to Syracuse', location: 'Detroit Metropolitan Wayne County — Terminal M' },
      { id: 'j22-6', title: 'Fly Detroit (DTW) → Syracuse (SYR) — Delta 1689', category: 'transportation', time: '21:35', duration: '1h 23m', notes: 'DTW Terminal M → SYR · Delta 1689 · departs 9:35pm, arrives 10:58pm · Economy. Trip complete', location: 'Detroit (DTW T M) → Syracuse Hancock Intl (SYR)' },
    ],
  },
];
