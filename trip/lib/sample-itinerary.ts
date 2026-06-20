import { DayPlan } from './trip-data';

export const SAMPLE_ITINERARY: DayPlan[] = [
  {
    date: '2026-12-09',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n1-1', title: 'Arrive at Tribhuvan International Airport', category: 'transportation', time: '14:00', duration: '2h', notes: 'Visa on arrival, currency exchange', location: 'Kathmandu Airport' },
      { id: 'n1-2', title: 'Check in to Hotel Yak & Yeti', category: 'hotel', time: '16:30', duration: '1h', notes: 'Heritage wing preferred', location: 'Durbar Marg' },
      { id: 'n1-3', title: 'Evening walk in Thamel', category: 'sightseeing', time: '18:00', duration: '2h', notes: 'Explore the tourist district, buy SIM card', location: 'Thamel' },
      { id: 'n1-4', title: 'Dinner at Bhojan Griha', category: 'food', time: '20:00', duration: '1.5h', notes: 'Traditional Nepali feast in heritage building', location: 'Dillibazar' },
    ],
  },
  {
    date: '2026-12-10',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n2-1', title: 'Sunrise at Swayambhunath (Monkey Temple)', category: 'photography', time: '06:00', duration: '2h', notes: 'Panoramic city views, bring wide-angle lens', location: 'Swayambhu Hill' },
      { id: 'n2-2', title: 'Breakfast at OR2K Restaurant', category: 'food', time: '08:30', duration: '1h', notes: 'Mediterranean-Nepali fusion, rooftop views', location: 'Thamel' },
      { id: 'n2-3', title: 'Kathmandu Durbar Square', category: 'cultural', time: '10:00', duration: '3h', notes: 'UNESCO World Heritage, Kumari Ghar, Hanuman Dhoka', location: 'Basantapur' },
      { id: 'n2-4', title: 'Lunch - Momos at Yangling', category: 'food', time: '13:00', duration: '1h', notes: 'Famous steamed & fried momos', location: 'Thamel' },
      { id: 'n2-5', title: 'Boudhanath Stupa', category: 'sightseeing', time: '15:00', duration: '2.5h', notes: 'Largest stupa in Nepal, golden hour photography', location: 'Boudha' },
    ],
  },
  {
    date: '2026-12-11',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'n3-1', title: 'Pashupatinath Temple', category: 'cultural', time: '07:00', duration: '2.5h', notes: 'Sacred Hindu temple, cremation ghats, respectful photography', location: 'Pashupatinath' },
      { id: 'n3-2', title: 'Patan Durbar Square', category: 'sightseeing', time: '10:30', duration: '3h', notes: 'Finest Newari architecture, Krishna Temple', location: 'Lalitpur' },
      { id: 'n3-3', title: 'Lunch at Cafe Swotha', category: 'food', time: '13:30', duration: '1h', notes: 'Newari cuisine in heritage courtyard', location: 'Patan' },
      { id: 'n3-4', title: 'Patan Museum', category: 'cultural', time: '15:00', duration: '1.5h', notes: 'Best museum in Nepal, Hindu & Buddhist art', location: 'Patan' },
      { id: 'n3-5', title: 'Street photography in Patan alleys', category: 'photography', time: '16:30', duration: '2h', notes: 'Golden hour light in narrow streets', location: 'Patan' },
    ],
  },
  {
    date: '2026-12-14',
    city: 'Nagarkot',
    country: 'nepal',
    items: [
      { id: 'n6-1', title: 'Early morning drive to Nagarkot', category: 'transportation', time: '04:30', duration: '1.5h', notes: 'Pre-dawn departure for sunrise', location: 'Kathmandu to Nagarkot' },
      { id: 'n6-2', title: 'Himalayan Sunrise Viewpoint', category: 'photography', time: '06:00', duration: '2h', notes: 'Panoramic view of Everest range, tripod essential', location: 'Nagarkot Tower' },
      { id: 'n6-3', title: 'Breakfast at Club Himalaya', category: 'food', time: '08:30', duration: '1h', notes: 'Mountain view breakfast', location: 'Nagarkot' },
      { id: 'n6-4', title: 'Bhaktapur Durbar Square', category: 'cultural', time: '11:00', duration: '4h', notes: 'Best preserved medieval city, 55 Window Palace, Nyatapola Temple', location: 'Bhaktapur' },
      { id: 'n6-5', title: 'Juju Dhau (King Curd) tasting', category: 'food', time: '15:00', duration: '30min', notes: 'Famous Bhaktapur yogurt, a must-try', location: 'Bhaktapur' },
    ],
  },
  {
    date: '2026-12-19',
    city: 'Tokyo',
    country: 'japan',
    items: [
      { id: 'j1-1', title: 'Fly from Kathmandu to Tokyo (Narita)', category: 'transportation', time: '08:00', duration: '10h', notes: 'Transit flight, arrive evening local time', location: 'TIA → NRT' },
      { id: 'j1-2', title: 'Check in to Shinjuku hotel', category: 'hotel', time: '20:00', duration: '1h', notes: 'Narita Express to Shinjuku', location: 'Shinjuku' },
      { id: 'j1-3', title: 'Late night ramen at Fuunji', category: 'food', time: '21:30', duration: '45min', notes: 'Famous tsukemen (dipping ramen)', location: 'Shinjuku' },
      { id: 'j1-4', title: 'Night walk in Kabukicho', category: 'sightseeing', time: '22:30', duration: '1h', notes: 'Neon lights, Godzilla head, Robot Restaurant area', location: 'Kabukicho' },
    ],
  },
];
