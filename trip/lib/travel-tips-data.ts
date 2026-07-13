export interface FeaturedDestination {
  name: string;
  country: 'Nepal' | 'Japan';
  blurb: string;
  emoji: string;
  image?: string;
}

export const FEATURED_DESTINATIONS: FeaturedDestination[] = [
  { name: 'Boudhanath Stupa', image: '/images/featured/boudhanath.jpg', country: 'Nepal', blurb: 'One of the largest Buddhist stupas in the world — circle it at dusk among butter lamps and prayer flags.', emoji: '🏯' },
  { name: 'Patan Durbar Square', image: '/images/featured/patan-durbar.jpg', country: 'Nepal', blurb: 'A living museum of Newari architecture, intricate woodwork, and centuries-old temples and courtyards.', emoji: '🛕' },
  { name: 'Nagarkot Sunrise', image: '/images/featured/nagarkot.jpg', country: 'Nepal', blurb: 'Hilltop viewpoint with a panoramic Himalayan horizon — catch first light over the snow peaks.', emoji: '⛰️' },
  { name: 'Shibuya, Tokyo', image: '/images/featured/shibuya.jpg', country: 'Japan', blurb: 'Neon-soaked energy, the world\'s busiest crossing, and endless food and fashion in every direction.', emoji: '🌆' },
  { name: 'Arashiyama, Kyoto', image: '/images/featured/arashiyama.jpg', country: 'Japan', blurb: 'Towering bamboo groves, riverside temples, and the timeless calm of old Kyoto.', emoji: '🎋' },
  { name: 'Mt. Fuji', image: '/images/featured/mount-fuji.jpg', country: 'Japan', blurb: 'Japan\'s iconic snow-capped peak — best viewed from the Fuji Five Lakes on a clear winter morning.', emoji: '🗻' },
];

export interface FoodItem {
  name: string;
  country: 'Nepal' | 'Japan';
  description: string;
  emoji: string;
}

export const LOCAL_FOODS: FoodItem[] = [
  { name: 'Momo', country: 'Nepal', description: 'Steamed or fried dumplings filled with buffalo meat or vegetables, served with spicy tomato chutney.', emoji: '🥟' },
  { name: 'Dal Bhat', country: 'Nepal', description: 'The national dish — lentil soup with rice, vegetables, pickles, and meat curry. Unlimited refills!', emoji: '🍛' },
  { name: 'Newari Samay Baji', country: 'Nepal', description: 'Traditional Newari feast platter with beaten rice, buffalo meat, egg, beans, and local alcohol.', emoji: '🍽️' },
  { name: 'Sel Roti', country: 'Nepal', description: 'Sweet ring-shaped rice bread, crispy outside and soft inside. Traditional festive snack.', emoji: '🍩' },
  { name: 'Tonkotsu Ramen', country: 'Japan', description: 'Rich pork bone broth simmered for hours, thin noodles, chashu pork, soft-boiled egg, nori.', emoji: '🍜' },
  { name: 'Fresh Sushi & Sashimi', country: 'Japan', description: 'Pristine raw fish on vinegared rice. Try omakase (chef\'s choice) for the ultimate experience.', emoji: '🍣' },
  { name: 'Takoyaki', country: 'Japan', description: 'Crispy-outside, gooey-inside octopus balls from Osaka. Topped with mayo, sauce, and bonito flakes.', emoji: '🐙' },
  { name: 'Wagyu Beef', country: 'Japan', description: 'Marbled Japanese beef that melts in your mouth. Try A5 grade for the ultimate luxury cut.', emoji: '🥩' },
  { name: 'Matcha Everything', country: 'Japan', description: 'Green tea in every form — ice cream, parfait, latte, mochi, Kit-Kat, and traditional ceremony.', emoji: '🍵' },
  { name: 'Onigiri', country: 'Japan', description: 'Rice balls with various fillings from convenience stores. Salmon, tuna mayo, umeboshi — perfect snacks.', emoji: '🍙' },
];

export interface EtiquetteTip {
  title: string;
  country: 'Nepal' | 'Japan' | 'Both';
  description: string;
  icon: string;
}

export const ETIQUETTE_TIPS: EtiquetteTip[] = [
  { title: 'Remove Shoes Indoors', country: 'Both', description: 'Always remove shoes before entering temples, homes, and many restaurants. Look for shoe racks at entrances.', icon: 'FootprintsIcon' },
  { title: 'Temple Photography', country: 'Nepal', description: 'Ask permission before photographing people or ceremonies. Some inner sanctums prohibit photography entirely.', icon: 'CameraOff' },
  { title: 'Walk Clockwise', country: 'Nepal', description: 'Always walk clockwise around Buddhist stupas and prayer wheels. Spin prayer wheels with your right hand.', icon: 'RotateCw' },
  { title: 'Quiet on Trains', country: 'Japan', description: 'Keep voices low on public transport. Set phones to silent mode. Avoid phone calls on trains.', icon: 'VolumeX' },
  { title: 'No Tipping', country: 'Japan', description: 'Tipping is not practiced and can be considered rude. Service is included in the price.', icon: 'Ban' },
  { title: 'Chopstick Etiquette', country: 'Japan', description: 'Never stick chopsticks upright in rice (funeral ritual). Don\'t pass food chopstick-to-chopstick.', icon: 'Utensils' },
  { title: 'Cash is King', country: 'Both', description: 'Nepal is heavily cash-based. Japan also uses more cash than expected. Carry local currency at all times.', icon: 'Banknote' },
  { title: 'Bowing', country: 'Japan', description: 'A slight bow shows respect in greetings. Deeper bows show more respect. Follow the local\'s lead.', icon: 'HeartHandshake' },
];

export const WEATHER_INFO = {
  nepal: {
    tempHigh: '19°C (66°F)',
    tempLow: '2°C (36°F)',
    description: 'Dry season with clear skies — best time for mountain views. Cold mornings and evenings, pleasant sunny days. Very little rain.',
    whatToWear: 'Layers are key: thermal base + fleece + light down jacket. Warm hat for early mornings.',
  },
  japan: {
    tempHigh: '12°C (54°F)',
    tempLow: '1°C (34°F)',
    description: 'Cold and dry winter. Clear skies are common but snow possible in mountainous areas. Winter illuminations create magical atmosphere.',
    whatToWear: 'Warm coat, thermal layers, boots. Indoor heating is strong so dress in removable layers.',
  },
};
