export interface Recommendation {
  id: string;
  name: string;
  category: string;
  description: string;
  bestTime: string;
  duration: string;
  photoRating: number;
  notes: string;
  location?: string;
  image?: string;
}

export const NEPAL_ATTRACTIONS: Recommendation[] = [
  // --- Temples & Cultural Sites ---
  { id: 'na1', name: 'Boudhanath Stupa', category: 'Temple', description: 'One of the largest spherical stupas in Nepal, a UNESCO World Heritage Site. The mandala-design dome is surrounded by prayer wheels and monasteries.', bestTime: 'Early morning or sunset', duration: '2-3 hours', photoRating: 5, notes: 'Walk clockwise around the stupa. Best light at golden hour.', location: 'Boudha, Kathmandu' },
  { id: 'na2', name: 'Swayambhunath (Monkey Temple)', category: 'Temple', description: 'Ancient religious complex atop a hill with panoramic views of Kathmandu Valley. Watch playful monkeys and explore Buddhist and Hindu shrines.', bestTime: 'Sunrise', duration: '2 hours', photoRating: 5, notes: '365 steps to the top. Bring wide-angle lens for cityscape.', location: 'Swayambhu Hill' },
  { id: 'na3', name: 'Pashupatinath Temple', category: 'Temple', description: 'Sacred Hindu temple on the banks of the Bagmati River. Witness cremation ceremonies and the evening aarti ritual.', bestTime: 'Morning or evening aarti', duration: '2-3 hours', photoRating: 4, notes: 'Non-Hindus cannot enter main temple. Cremation photography requires sensitivity.', location: 'Pashupatinath' },
  { id: 'na11', name: 'Budhanilkantha Temple', category: 'Temple', description: 'Home to Nepal\'s largest stone statue of the reclining Vishnu, carved from a single block of black basalt and floating in a recessed water tank.', bestTime: 'Early morning', duration: '1-2 hours', photoRating: 4, notes: 'The 5-metre sleeping Vishnu dates to the 7th century. Quiet and uncrowded at dawn.', location: 'Budhanilkantha, north Kathmandu' },
  { id: 'na12', name: 'Changu Narayan Temple', category: 'Temple', description: 'The oldest Hindu temple in the Kathmandu Valley and a UNESCO site, famed for exquisite 5th-century stone, wood and metal craftsmanship.', bestTime: 'Morning', duration: '2 hours', photoRating: 5, notes: 'Pair with a short hike down to Bhaktapur or Nagarkot. Newari woodcarving at its finest.', location: 'Changunarayan hill' },

  // --- Must-Visit (Durbar Squares) ---
  { id: 'na4', name: 'Kathmandu Durbar Square', category: 'Must-Visit', description: 'Historic royal palace square with temples, courtyards, and the living goddess Kumari. A UNESCO site showcasing Newari architecture.', bestTime: 'Morning', duration: '3 hours', photoRating: 5, notes: 'Visit Kumari Ghar to see the living goddess. Entry fee for foreigners.', location: 'Basantapur' },
  { id: 'na5', name: 'Patan Durbar Square', category: 'Must-Visit', description: 'A dense collection of Newari architecture. Krishna Temple, the Golden Temple, and the Patan Museum ring the square.', bestTime: 'Morning to afternoon', duration: '3-4 hours', photoRating: 5, notes: 'The Patan Museum is well worth the time. Explore surrounding alleys for hidden courtyards.', location: 'Lalitpur' },
  { id: 'na6', name: 'Bhaktapur Durbar Square', category: 'Must-Visit', description: 'Best preserved medieval city in the Kathmandu Valley. 55-Window Palace, Nyatapola Temple, and traditional pottery squares.', bestTime: 'Full day visit', duration: '5-6 hours', photoRating: 5, notes: 'Try the famous Juju Dhau (King Curd). Least touristy of the three squares.' },

  // --- Hidden Gems ---
  { id: 'na7', name: 'Garden of Dreams', category: 'Hidden Gem', description: 'A neo-classical garden oasis in the heart of Kathmandu. Fountains, pergolas, and peaceful pavilions away from city chaos.', bestTime: 'Afternoon', duration: '1-2 hours', photoRating: 4, notes: 'Perfect escape from bustling Thamel. Small entry fee.' },
  { id: 'na8', name: 'Asan Bazaar', category: 'Hidden Gem', description: 'The oldest and most vibrant market in Kathmandu. Spices, vegetables, fabrics, and hidden temples in narrow alleyways.', bestTime: 'Morning', duration: '2 hours', photoRating: 5, notes: 'Best street photography spot in KTM. Follow the ancient trade route.' },
  { id: 'na13', name: 'Pharping & Asura Cave', category: 'Hidden Gem', description: 'A serene cluster of Buddhist monasteries and the sacred Asura Cave where Guru Rinpoche meditated, set in pine-forested hills south of the valley.', bestTime: 'Morning', duration: 'Half day', photoRating: 4, notes: 'Combine with the Dakshinkali temple nearby. Peaceful and rarely crowded.', location: 'Pharping' },

  // --- Nature ---
  { id: 'na9', name: 'Shivapuri National Park', category: 'Nature', description: 'Lush forested national park on the valley\'s northern rim with hiking trails, waterfalls and the Bagmati river source. Rich birdlife and mountain air.', bestTime: 'Morning', duration: 'Half to full day', photoRating: 4, notes: 'Trailhead near Budhanilkantha. Good for a half-day forest hike.', location: 'Shivapuri-Nagarjun' },
  { id: 'na10', name: 'Taudaha Lake', category: 'Nature', description: 'A tranquil natural lake on the valley\'s southern edge, a winter stopover for migratory birds and a calm spot for a quiet walk away from the city.', bestTime: 'Late afternoon', duration: '1-2 hours', photoRating: 3, notes: 'Best birdwatching in December. Tea stalls along the shore.', location: 'Chobhar' },

  // --- Photography Locations ---
  { id: 'na14', name: 'Chobhar Gorge', category: 'Photography', description: 'A dramatic river gorge where the Bagmati cuts through the valley rim, with the Jal Binayak temple and a vintage suspension bridge framing the water.', bestTime: 'Late afternoon', duration: '1-2 hours', photoRating: 4, notes: 'Wide-angle for the gorge, telephoto for temple detail. Soft side light after 3 PM.', location: 'Chobhar' },
  { id: 'na15', name: 'Kopan Monastery Viewpoint', category: 'Photography', description: 'A hilltop Buddhist monastery overlooking Boudhanath and the valley, with prayer flags, golden roofs and sweeping skyline compositions.', bestTime: 'Sunset', duration: '1-2 hours', photoRating: 5, notes: 'Frame Boudhanath stupa against the city below at dusk. Respect monastery quiet hours.', location: 'Kopan hill, Boudha' },
  { id: 'na16', name: 'Sarangkot-style Valley Rim at Phulchowki', category: 'Photography', description: 'The valley\'s highest rim peak, blanketed in rhododendron forest, offering layered ridge-line and Himalayan panorama shots on clear winter mornings.', bestTime: 'Pre-dawn to early morning', duration: 'Half day', photoRating: 5, notes: 'Clearest December skies reveal distant peaks. Bring a telephoto for compressed ridges.', location: 'Phulchowki, Godavari' },

  // --- Day Trips ---
  { id: 'na17', name: 'Nagarkot Sunrise', category: 'Day Trip', description: 'Famous hilltop viewpoint offering panoramic sunrise views over the Himalayan range including Everest, Langtang and Ganesh Himal.', bestTime: 'Pre-dawn to sunrise', duration: 'Half day', photoRating: 5, notes: 'Leave Kathmandu by 4:30 AM. Bring tripod and telephoto lens.', location: 'Nagarkot' },
  { id: 'na18', name: 'Chandragiri Hills Cable Car', category: 'Day Trip', description: 'Cable car ride to a hilltop with stunning views of the Himalayas and Kathmandu Valley. Clear winter days offer Everest views.', bestTime: 'Clear morning', duration: '3-4 hours', photoRating: 5, notes: 'December offers clearest mountain views. Bring layers for cold at the top.', location: 'Chandragiri' },
  { id: 'na19', name: 'Dhulikhel', category: 'Day Trip', description: 'A historic Newari town on the valley\'s eastern edge with cobbled streets, traditional architecture and a renowned wraparound Himalayan panorama.', bestTime: 'Sunrise or sunset', duration: 'Full day', photoRating: 5, notes: 'About 30 km from Kathmandu. Walk the ridge to the Kali shrine viewpoint.', location: 'Dhulikhel, Kavre' },
  { id: 'na20', name: 'Namo Buddha', category: 'Day Trip', description: 'One of Tibetan Buddhism\'s holiest sites, home to the Thrangu Tashi Yangtse Monastery set among terraced hills and forest stupas.', bestTime: 'Morning', duration: 'Full day', photoRating: 4, notes: 'Pair with Dhulikhel and Panauti for a scenic loop. Vegetarian meals at the monastery.', location: 'Namobuddha, Kavre' },
];

export const NEPAL_FOOD: Recommendation[] = [
  { id: 'nf1', name: 'Bhojan Griha', category: 'Food', description: 'Traditional Nepali feast in a 150-year-old heritage building with cultural performances. Multi-course dal bhat dinner.', bestTime: 'Dinner', duration: '2 hours', photoRating: 4, notes: 'Reservation recommended. Cultural dance show included.' },
  { id: 'nf2', name: 'Yangling Restaurant', category: 'Food', description: 'Legendary momo spot in Thamel. Steamed, fried, and jhol momos with authentic Tibetan-Nepali flavors.', bestTime: 'Lunch', duration: '1 hour', photoRating: 3, notes: 'Try the jhol (soup) momos. Simple atmosphere, incredible food.' },
  { id: 'nf3', name: 'OR2K Restaurant', category: 'Café', description: 'Mediterranean-Nepali fusion with stunning rooftop views. Cushion seating, hookah-friendly, great hummus and falafel.', bestTime: 'Breakfast or sunset', duration: '1.5 hours', photoRating: 4, notes: 'Rooftop sunset views are magical. Vegetarian-friendly.' },
  { id: 'nf4', name: 'Cafe Swotha', category: 'Food', description: 'Newari cuisine served in a beautifully restored heritage courtyard in Patan. Authentic local flavors in elegant setting.', bestTime: 'Lunch', duration: '1.5 hours', photoRating: 4, notes: 'Try the Newari set meal. Beautiful courtyard architecture.' },
  { id: 'nf5', name: 'Roadhouse Cafe', category: 'Café', description: 'Best wood-fired pizza in Kathmandu with craft beer selection. Modern atmosphere, popular with expats.', bestTime: 'Dinner', duration: '1.5 hours', photoRating: 3, notes: 'Multiple locations. Thamel branch has best atmosphere.' },
  { id: 'nf6', name: 'Thakali Kitchen', category: 'Food', description: 'Authentic Thakali dal bhat - the quintessential Nepali meal. Unlimited refills on rice, dal, vegetables.', bestTime: 'Lunch', duration: '1 hour', photoRating: 3, notes: 'Eat with right hand for authentic experience. Dal bhat power!' },
  { id: 'nf7', name: 'Himalayan Java', category: 'Café', description: 'Nepal\'s premier coffee chain using locally grown beans from the hills. Multiple scenic locations across Kathmandu.', bestTime: 'Morning', duration: '1 hour', photoRating: 3, notes: 'Try Nepali-grown coffee. Garden-view branch near Thamel is best.' },
];

export const NEPAL_CATEGORIES = ['All', 'Must-Visit', 'Hidden Gem', 'Temple', 'Food', 'Café', 'Nature', 'Photography', 'Day Trip'];
