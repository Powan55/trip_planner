export interface NightlifeVenue {
  id: string;
  name: string;
  country: 'Nepal' | 'Japan';
  location: string;
  vibe: string;
  musicType: string;
  priceRange: string;
  bestDays: string;
  description: string;
}

export const NIGHTLIFE_VENUES: NightlifeVenue[] = [
  { id: 'nl1', name: 'Purple Haze Rock Bar', country: 'Nepal', location: 'Thamel, Kathmandu', vibe: 'Rock & live music', musicType: 'Rock, Blues, Indie', priceRange: '$$', bestDays: 'Fri-Sat', description: 'Kathmandu\'s legendary live music venue. Local and international bands perform nightly in an intimate setting.' },
  { id: 'nl2', name: 'Sam\'s Bar', country: 'Nepal', location: 'Thamel, Kathmandu', vibe: 'Backpacker social hub', musicType: 'Mixed / DJ', priceRange: '$', bestDays: 'Every night', description: 'The most famous bar in Thamel. Pool tables, cheap drinks, and a melting pot of travelers from around the world.' },
  { id: 'nl3', name: 'LOD (Lord of the Drinks)', country: 'Nepal', location: 'Thamel, Kathmandu', vibe: 'Upscale lounge', musicType: 'House, Electronic', priceRange: '$$$', bestDays: 'Thu-Sat', description: 'Multi-level upscale lounge with rooftop terrace. Premium cocktails and modern ambiance.' },
  { id: 'nl4', name: 'Club Fahrenheit', country: 'Nepal', location: 'Durbarmarg, Kathmandu', vibe: 'Nightclub', musicType: 'EDM, Bollywood, Hip-Hop', priceRange: '$$$', bestDays: 'Fri-Sat', description: 'One of Kathmandu\'s premium nightclubs with international DJs and a spacious dance floor.' },
  { id: 'nl5', name: 'Golden Gai', country: 'Japan', location: 'Shinjuku, Tokyo', vibe: 'Intimate micro-bars', musicType: 'Varies by bar', priceRange: '$$-$$$', bestDays: 'Any night', description: 'A maze of 200+ tiny bars, each seating 5-10 people. Each bar has a unique theme, from jazz to punk to anime.' },
  { id: 'nl6', name: 'Robot Restaurant', country: 'Japan', location: 'Kabukicho, Tokyo', vibe: 'Wild spectacle', musicType: 'Electronic / Pop', priceRange: '$$$$', bestDays: 'Any night', description: 'Insane neon-lit robot show with giant mechs, dancers, and lasers. Pure sensory overload. Book in advance.' },
  { id: 'nl7', name: 'Womb', country: 'Japan', location: 'Shibuya, Tokyo', vibe: 'Super club', musicType: 'Techno, House', priceRange: '$$$', bestDays: 'Fri-Sat', description: 'One of Asia\'s top nightclubs. World-class sound system, international DJs, and four dance floors.' },
  { id: 'nl8', name: 'Bar High Five', country: 'Japan', location: 'Ginza, Tokyo', vibe: 'Cocktail bar', musicType: 'Jazz / Ambient', priceRange: '$$$$', bestDays: 'Any night', description: 'Consistently ranked among the world\'s best bars. Master bartender Hidetsugu Ueno creates bespoke cocktails.' },
  { id: 'nl9', name: 'Roppongi Hills Club Area', country: 'Japan', location: 'Roppongi, Tokyo', vibe: 'International nightlife hub', musicType: 'Mixed', priceRange: '$$$', bestDays: 'Fri-Sat', description: 'Tokyo\'s famous nightlife district with dozens of clubs and bars. Popular with expats and tourists.' },
  { id: 'nl10', name: 'Zoetrope Whisky Bar', country: 'Japan', location: 'Shinjuku, Tokyo', vibe: 'Whisky haven', musicType: 'Jazz', priceRange: '$$$', bestDays: 'Any night', description: 'Over 200 Japanese whiskies in a tiny, atmospheric bar. Perfect for whisky enthusiasts. Cinema-themed decor.' },
];
