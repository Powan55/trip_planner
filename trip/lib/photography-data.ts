export interface PhotoSpot {
  id: string;
  name: string;
  country: 'Nepal' | 'Japan';
  city: string;
  bestTime: string;
  style: string;
  gear: string;
  tip: string;
  category: string;
  image?: string;
}

export const PHOTO_SPOTS: PhotoSpot[] = [
  { id: 'ps1', image: '/images/photography/ps1.jpg', name: 'Nagarkot Himalayan Panorama', country: 'Nepal', city: 'Nagarkot', bestTime: 'Sunrise (6:00-7:00 AM)', style: 'Landscape', gear: 'Telephoto 70-200mm, tripod', tip: 'Arrive 30 min before sunrise. Shoot through blue hour into golden hour.', category: 'Sunrise' },
  { id: 'ps2', image: '/images/photography/ps2.jpg', name: 'Swayambhunath Valley View', country: 'Nepal', city: 'Kathmandu', bestTime: 'Sunrise', style: 'Cityscape / Landscape', gear: 'Wide-angle 16-35mm', tip: 'Climb to the top of the stupa for 360° valley panorama.', category: 'Sunrise' },
  { id: 'ps3', image: '/images/photography/ps3.jpg', name: 'Boudhanath Golden Hour', country: 'Nepal', city: 'Kathmandu', bestTime: 'Sunset (4:30-5:30 PM)', style: 'Architecture / Street', gear: '35mm or 50mm prime', tip: 'Shoot from rooftop cafes for elevated perspective of the stupa.', category: 'Sunset' },
  { id: 'ps4', image: '/images/photography/ps4.jpg', name: 'Shibuya Crossing from Above', country: 'Japan', city: 'Tokyo', bestTime: 'Blue hour (5:00-6:00 PM)', style: 'Urban / Street', gear: 'Wide-angle, fast lens f/1.8', tip: 'Shibuya Sky deck for the ultimate aerial shot. Long exposure for light trails.', category: 'Night' },
  { id: 'ps5', image: '/images/photography/ps5.jpg', name: 'Fushimi Inari Torii Gates', country: 'Japan', city: 'Kyoto', bestTime: 'Dawn (6:00-7:00 AM)', style: 'Architecture / Leading Lines', gear: '24-70mm zoom', tip: 'Arrive before 7 AM for empty tunnel shots. Use leading line composition.', category: 'Instagram' },
  { id: 'ps6', image: '/images/photography/ps6.jpg', name: 'Asan Bazaar Street Life', country: 'Nepal', city: 'Kathmandu', bestTime: 'Morning (8:00-10:00 AM)', style: 'Street / Documentary', gear: '35mm or 50mm prime', tip: 'Use a compact setup. Ask permission for portraits. Morning light filters through narrow alleys.', category: 'Street' },
  { id: 'ps7', image: '/images/photography/ps7.jpg', name: 'Kabukicho Neon District', country: 'Japan', city: 'Tokyo', bestTime: 'Night (8:00-11:00 PM)', style: 'Night / Neon', gear: 'Fast prime 35mm f/1.4, high ISO capable body', tip: 'Shoot in rain for reflections on wet streets. Cyberpunk vibes guaranteed.', category: 'Night' },
  { id: 'ps8', image: '/images/photography/ps8.jpg', name: 'Golden Pavilion (Kinkaku-ji)', country: 'Japan', city: 'Kyoto', bestTime: 'Morning (9:00 AM)', style: 'Architecture / Reflection', gear: '70-200mm telephoto', tip: 'Mirror reflection in pond is the classic shot. Snow days are rare magic.', category: 'Architecture' },
  { id: 'ps9', image: '/images/photography/ps9.jpg', name: 'Kathmandu Durbar Square Details', country: 'Nepal', city: 'Kathmandu', bestTime: 'Morning', style: 'Architecture / Detail', gear: 'Macro or 100mm', tip: 'Focus on intricate wood carvings and stone sculptures. Side light reveals textures.', category: 'Architecture' },
  { id: 'ps10', image: '/images/photography/ps10.jpg', name: 'Tsukiji Market Food Close-ups', country: 'Japan', city: 'Tokyo', bestTime: 'Morning (7:00-10:00 AM)', style: 'Food Photography', gear: '50mm or 85mm, natural light', tip: 'Shoot the preparation process, not just the final dish. Steam adds atmosphere.', category: 'Food' },
  { id: 'ps11', image: '/images/photography/ps11.jpg', name: 'Arashiyama Bamboo Forest', country: 'Japan', city: 'Kyoto', bestTime: 'Early morning', style: 'Nature / Leading Lines', gear: 'Ultra-wide 14mm', tip: 'Look up for the canopy shot. December illumination adds warm lights.', category: 'Nature' },
  { id: 'ps12', image: '/images/photography/ps12.jpg', name: 'Pashupatinath Aarti Ceremony', country: 'Nepal', city: 'Kathmandu', bestTime: 'Evening aarti', style: 'Cultural / Low Light', gear: 'Fast prime, high ISO', tip: 'Shoot from across the river. Fire and smoke create dramatic atmosphere.', category: 'Cultural' },
];

export const PHOTO_CATEGORIES = ['All', 'Sunrise', 'Sunset', 'Night', 'Street', 'Architecture', 'Instagram', 'Food', 'Nature', 'Cultural'];
