// scripts/fetch-images.mjs
//
// One-shot image fetcher for. Sources freely-licensed photos for the
// trip-planner's four image areas from Wikipedia/Wikimedia Commons — no API key
// required. Run from the app root (trip/): node scripts/fetch-images.mjs
//
// Mechanism (deterministic, free, no key):
// 1. Wikipedia REST summary API gives a representative thumbnail per page.
// 2. The thumbnail URL is upscaled to the requested width.
// 3. The image bytes are downloaded and validated (image/* + > ~8 KB).
// 4. Wikimedia Commons / en.wikipedia imageinfo gives attribution metadata.
//
// IMPORTANT: every request sets a descriptive User-Agent; the Wikimedia APIs
// return 403 without one. We cache by title so a subject used in several areas
// is fetched once, then copied into each <area>/<id> target.
//
// Correctness over coverage: if a title yields no usable image we SKIP it and
// leave the data `image` unset — the components' onError fallback covers misses.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'images');

const USER_AGENT =
  'TripPlannerImageFetch/1.0 (+https://github.com/Powan55/trip_planner; trip planner image fetch)';

const CARD_WIDTH = 1200;
const HERO_WIDTH = 1920;
const MIN_BYTES = 8 * 1024; // ~8 KB sanity floor
const POLITE_DELAY_MS = 350; // between distinct subjects (be gentle with the API)
const MAX_RETRIES = 5; // retry transient throttling (400/429/5xx) with backoff

// ── Manifest ────────────────────────────────────────────────────────────────
// Each entry: { id, area, title, width?, alt? }. width defaults per area.
/** @type {{id:string, area:string, title:string, width?:number, alt?:string}[]} */
const MANIFEST = [
  // Hero (decorative — empty alt). TWO heroes, one per trip leg (#83 follow-up): the hero
  // photograph follows the leg you are actually on — see `lib/hero-image.ts` for the mapping
  // and `components/hero-section.tsx` for the swap.
  //
  // `hero` was `title: 'Himalayas'` and that was the bug behind "the top looks ugly": this
  // fetcher asks the Wikipedia REST summary API for a PAGE's representative thumbnail, and the
  // "Himalayas" page's lead image is an annotated NASA Landsat SATELLITE MAP (red "Tibetan
  // plateau" labels and all), not a photograph of mountains. Ask for a peak, not a range, and
  // the lead image is a real photo. Same trap disqualified 'Kathmandu Valley' (also a satellite
  // image) and 'Annapurna Massif' (a good panorama, but overlaid with red peak-name labels) —
  // check the actual lead image before changing either title here.
  { id: 'hero', area: 'hero', title: 'Ama Dablam', width: HERO_WIDTH, alt: '' },
  { id: 'hero-japan', area: 'hero', title: 'Tokyo', width: HERO_WIDTH, alt: '' },

  // Nepal attractions
  { id: 'na1', area: 'nepal', title: 'Boudhanath' },
  { id: 'na2', area: 'nepal', title: 'Swayambhunath' },
  { id: 'na3', area: 'nepal', title: 'Pashupatinath Temple' },
  { id: 'na11', area: 'nepal', title: 'Budhanilkantha Temple' },
  { id: 'na12', area: 'nepal', title: 'Changu Narayan' },
  { id: 'na4', area: 'nepal', title: 'Kathmandu Durbar Square' },
  { id: 'na5', area: 'nepal', title: 'Patan Durbar Square' },
  { id: 'na6', area: 'nepal', title: 'Bhaktapur Durbar Square' },
  { id: 'na7', area: 'nepal', title: 'Garden of Dreams (Nepal)' },
  { id: 'na8', area: 'nepal', title: 'Asan, Kathmandu' },
  { id: 'na13', area: 'nepal', title: 'Pharping' },
  { id: 'na9', area: 'nepal', title: 'Shivapuri Nagarjun National Park' },
  { id: 'na10', area: 'nepal', title: 'Taudaha' },
  { id: 'na14', area: 'nepal', title: 'Chobhar' },
  { id: 'na15', area: 'nepal', title: 'Kopan Monastery' },
  { id: 'na16', area: 'nepal', title: 'Phulchowki' },
  { id: 'na17', area: 'nepal', title: 'Nagarkot' },
  { id: 'na18', area: 'nepal', title: 'Chandragiri, Kathmandu' },
  { id: 'na19', area: 'nepal', title: 'Dhulikhel' },
  { id: 'na20', area: 'nepal', title: 'Namo Buddha' },

  // Nepal food (map to the dish; substitute the closest illustrated subject)
  { id: 'nf1', area: 'nepal', title: 'Thali' },
  { id: 'nf2', area: 'nepal', title: 'Momo (food)' },
  { id: 'nf3', area: 'nepal', title: 'Falafel' },
  { id: 'nf4', area: 'nepal', title: 'Nepalese cuisine' },
  { id: 'nf5', area: 'nepal', title: 'Pizza' },
  { id: 'nf6', area: 'nepal', title: 'Thali' },
  { id: 'nf7', area: 'nepal', title: 'Coffee' },

  // Japan attractions
  { id: 'ja1', area: 'japan', title: 'Sensō-ji' },
  { id: 'ja2', area: 'japan', title: 'Fushimi Inari-taisha' },
  { id: 'ja3', area: 'japan', title: 'Shibuya Crossing' },
  { id: 'ja4', area: 'japan', title: 'Tokyo Tower' },
  { id: 'ja5', area: 'japan', title: 'Mount Fuji' },
  { id: 'ja6', area: 'japan', title: 'Akihabara' },
  { id: 'ja7', area: 'japan', title: 'Kinkaku-ji' },
  { id: 'ja8', area: 'japan', title: 'teamLab' },
  { id: 'ja9', area: 'japan', title: 'Meiji Shrine' },
  { id: 'ja10', area: 'japan', title: 'Arashiyama' },
  { id: 'ja11', area: 'japan', title: 'Tsukiji Market' },
  { id: 'ja12', area: 'japan', title: 'Dōtonbori' },
  { id: 'ja13', area: 'japan', title: 'Yanaka, Tokyo' },
  { id: 'ja14', area: 'japan', title: 'Golden Gai' },
  { id: 'ja15', area: 'japan', title: 'Omoide Yokochō' },
  { id: 'ja16', area: 'japan', title: 'Shimokitazawa' },
  { id: 'ja17', area: 'japan', title: 'Nagashima Spa Land' },
  { id: 'ja18', area: 'japan', title: 'Hakone' },
  { id: 'ja19', area: 'japan', title: 'Gala Yuzawa Station' },
  { id: 'ja20', area: 'japan', title: 'Shirakawa-gō' },
  { id: 'ja21', area: 'japan', title: 'Roppongi Hills' },
  { id: 'ja22', area: 'japan', title: 'Nakano Broadway' },
  { id: 'ja23', area: 'japan', title: 'Ikebukuro' },
  { id: 'ja24', area: 'japan', title: 'Ghibli Museum' },
  { id: 'ja25', area: 'japan', title: 'Akihabara' },
  { id: 'ja26', area: 'japan', title: 'Ginza' },
  { id: 'ja27', area: 'japan', title: 'Shinsaibashi' },

  // Japan food (dish)
  { id: 'jf1', area: 'japan', title: 'Ramen' },
  { id: 'jf2', area: 'japan', title: 'Tsukemen' },
  { id: 'jf3', area: 'japan', title: 'Conveyor belt sushi' },
  { id: 'jf4', area: 'japan', title: 'Onigiri' },
  { id: 'jf5', area: 'japan', title: 'Wagyu' },
  { id: 'jf6', area: 'japan', title: 'Matcha' },

  // Photography spots
  { id: 'ps1', area: 'photography', title: 'Nagarkot' },
  { id: 'ps2', area: 'photography', title: 'Swayambhunath' },
  { id: 'ps3', area: 'photography', title: 'Boudhanath' },
  { id: 'ps4', area: 'photography', title: 'Shibuya Crossing' },
  { id: 'ps5', area: 'photography', title: 'Fushimi Inari-taisha' },
  { id: 'ps6', area: 'photography', title: 'Asan, Kathmandu' },
  { id: 'ps7', area: 'photography', title: 'Kabukichō' },
  { id: 'ps8', area: 'photography', title: 'Kinkaku-ji' },
  { id: 'ps9', area: 'photography', title: 'Kathmandu Durbar Square' },
  { id: 'ps10', area: 'photography', title: 'Tsukiji Market' },
  { id: 'ps11', area: 'photography', title: 'Arashiyama' },
  { id: 'ps12', area: 'photography', title: 'Pashupatinath Temple' },

  // Featured destinations (slug ids)
  { id: 'boudhanath', area: 'featured', title: 'Boudhanath' },
  { id: 'patan-durbar', area: 'featured', title: 'Patan Durbar Square' },
  { id: 'nagarkot', area: 'featured', title: 'Nagarkot' },
  { id: 'shibuya', area: 'featured', title: 'Shibuya Crossing' },
  { id: 'arashiyama', area: 'featured', title: 'Arashiyama' },
  { id: 'mount-fuji', area: 'featured', title: 'Mount Fuji' },

  // Map markers (np-dwarikas intentionally absent — deliberately skipped)
  { id: 'np-boudhanath', area: 'map', title: 'Boudhanath' },
  { id: 'np-swayambhunath', area: 'map', title: 'Swayambhunath' },
  { id: 'np-pashupatinath', area: 'map', title: 'Pashupatinath Temple' },
  { id: 'np-durbar-ktm', area: 'map', title: 'Kathmandu Durbar Square' },
  { id: 'np-thamel', area: 'map', title: 'Thamel' },
  { id: 'np-garden-dreams', area: 'map', title: 'Garden of Dreams (Nepal)' },
  { id: 'np-patan', area: 'map', title: 'Patan Durbar Square' },
  { id: 'np-bhaktapur', area: 'map', title: 'Bhaktapur Durbar Square' },
  { id: 'np-nagarkot', area: 'map', title: 'Nagarkot' },
  { id: 'np-newa-kitchen', area: 'map', title: 'Nepalese cuisine' },
  { id: 'np-yangling', area: 'map', title: 'Momo (food)' },
  { id: 'np-kopan', area: 'map', title: 'Kopan Monastery' },
  { id: 'jp-sensoji', area: 'map', title: 'Sensō-ji' },
  { id: 'jp-shibuya', area: 'map', title: 'Shibuya Crossing' },
  { id: 'jp-akihabara', area: 'map', title: 'Akihabara' },
  { id: 'jp-ichiran', area: 'map', title: 'Ramen' },
  { id: 'jp-park-hyatt', area: 'map', title: 'Shinjuku' },
  { id: 'jp-teamlab', area: 'map', title: 'teamLab' },
  { id: 'jp-fushimi', area: 'map', title: 'Fushimi Inari-taisha' },
  { id: 'jp-arashiyama', area: 'map', title: 'Arashiyama' },
  { id: 'jp-kinkakuji', area: 'map', title: 'Kinkaku-ji' },
  { id: 'jp-nishiki', area: 'map', title: 'Nishiki Market' },
  { id: 'jp-dotonbori', area: 'map', title: 'Dōtonbori' },
  { id: 'jp-osaka-castle', area: 'map', title: 'Osaka Castle' },
  { id: 'jp-nara', area: 'map', title: 'Nara Park' },
  { id: 'jp-hakone', area: 'map', title: 'Hakone' },

  // Japan leg build-out: one entry per new marker / guide card that has a real
  // Commons subject. Venues with no article (ramen counters, clubs, single shops) are
  // deliberately absent — the fetcher skips a miss and the card's onError fallback covers it.
  // Shared titles are fetched once and copied into each target, same as the Nepal rows above.
  { id: 'jp-kaiyukan', area: 'map', title: 'Osaka Aquarium Kaiyukan' },
  { id: 'ja42', area: 'japan', title: 'Osaka Aquarium Kaiyukan' },
  { id: 'jp-todaiji', area: 'map', title: 'Tōdai-ji' },
  { id: 'ja38', area: 'japan', title: 'Tōdai-ji' },
  { id: 'jp-himeji-castle', area: 'map', title: 'Himeji Castle' },
  { id: 'ja39', area: 'japan', title: 'Himeji Castle' },
  { id: 'jp-meriken-park', area: 'map', title: 'Meriken Park' },
  { id: 'jp-nunobiki-herb', area: 'map', title: 'Nunobiki Falls' },
  { id: 'ja41', area: 'japan', title: 'Nunobiki Falls' },
  { id: 'jp-byodoin', area: 'map', title: 'Byōdō-in' },
  { id: 'ja40', area: 'japan', title: 'Byōdō-in' },
  { id: 'jp-kiyomizudera', area: 'map', title: 'Kiyomizu-dera' },
  { id: 'ja32', area: 'japan', title: 'Kiyomizu-dera' },
  { id: 'jp-sannenzaka', area: 'map', title: 'Sannenzaka' },
  { id: 'jp-hanamikoji', area: 'map', title: 'Gion' },
  { id: 'jp-pontocho', area: 'map', title: 'Pontochō' },
  { id: 'jp-manga-museum', area: 'map', title: 'Kyoto International Manga Museum' },
  { id: 'ja31', area: 'japan', title: 'Kyoto International Manga Museum' },
  { id: 'jp-nijo-castle', area: 'map', title: 'Nijō Castle' },
  { id: 'ja33', area: 'japan', title: 'Nijō Castle' },
  { id: 'jp-tenryuji', area: 'map', title: 'Tenryū-ji' },
  { id: 'ja34', area: 'japan', title: 'Tenryū-ji' },
  { id: 'jp-togetsukyo', area: 'map', title: 'Katsura River' },
  { id: 'jp-kyoto-station', area: 'map', title: 'Kyoto Station' },
  { id: 'ja37', area: 'japan', title: 'Kyoto Station' },
  { id: 'ja28', area: 'japan', title: 'Universal Studios Japan' },
  { id: 'ja29', area: 'japan', title: 'Nipponbashi' },
  { id: 'ja30', area: 'japan', title: 'Osaka Castle' },
  { id: 'ja35', area: 'japan', title: 'Iwatayama Monkey Park' },
  { id: 'ja36', area: 'japan', title: 'Nishiki Market' },
  { id: 'jp-skytree', area: 'map', title: 'Tokyo Skytree' },
  { id: 'ja43', area: 'japan', title: 'Tokyo Skytree' },
  { id: 'jp-ameyoko', area: 'map', title: 'Ameyoko' },
  { id: 'ja45', area: 'japan', title: 'Ameyoko' },
  { id: 'jp-tokyo-national-museum', area: 'map', title: 'Tokyo National Museum' },
  { id: 'ja46', area: 'japan', title: 'Tokyo National Museum' },
  { id: 'jp-super-potato', area: 'map', title: 'Super Potato' },
  { id: 'ja47', area: 'japan', title: 'Super Potato' },
  { id: 'jp-mandarake-akihabara', area: 'map', title: 'Mandarake' },
  { id: 'ja48', area: 'japan', title: 'Mandarake' },
  { id: 'jp-radio-kaikan', area: 'map', title: 'Akihabara Radio Kaikan' },
  { id: 'ja49', area: 'japan', title: 'Akihabara Radio Kaikan' },
  { id: 'jp-animate-ikebukuro', area: 'map', title: 'Animate (retailer)' },
  { id: 'ja50', area: 'japan', title: 'Animate (retailer)' },
  { id: 'jp-nakano-broadway', area: 'map', title: 'Nakano Broadway' },
  { id: 'jp-ginza-six', area: 'map', title: 'Ginza' },
  { id: 'jp-marunouchi-lights', area: 'map', title: 'Marunouchi' },
  { id: 'jp-tsukiji-outer', area: 'map', title: 'Tsukiji fish market' },
  { id: 'jp-toyosu-market', area: 'map', title: 'Toyosu Market' },
  { id: 'ja52', area: 'japan', title: 'Toyosu Market' },
  { id: 'jp-yanaka-ginza', area: 'map', title: 'Yanaka, Tokyo' },
  { id: 'jp-ghibli-museum', area: 'map', title: 'Ghibli Museum' },
  { id: 'jp-metro-gov-decks', area: 'map', title: 'Tokyo Metropolitan Government Building' },
  { id: 'ja56', area: 'japan', title: 'Tokyo Metropolitan Government Building' },
  { id: 'jp-omoide-yokocho', area: 'map', title: 'Omoide Yokochō' },
  { id: 'jp-golden-gai', area: 'map', title: 'Golden Gai' },
  { id: 'jp-shinjuku-gyoen', area: 'map', title: 'Shinjuku Gyoen' },
  { id: 'jp-hanazono-shrine', area: 'map', title: 'Hanazono Shrine' },
  { id: 'ja57', area: 'japan', title: 'Hanazono Shrine' },
  { id: 'jp-shibuya-sky', area: 'map', title: 'Shibuya Scramble Square' },
  { id: 'ja55', area: 'japan', title: 'Shibuya Scramble Square' },
  { id: 'jp-takeshita-dori', area: 'map', title: 'Takeshita Street' },
  { id: 'jp-meiji-jingu', area: 'map', title: 'Meiji Shrine' },
  { id: 'jp-tokyo-tower', area: 'map', title: 'Tokyo Tower' },
  { id: 'jp-tokyo-midtown', area: 'map', title: 'Tokyo Midtown' },
  { id: 'ja58', area: 'japan', title: 'Tokyo Midtown' },
  { id: 'jp-mikan-shimokita', area: 'map', title: 'Shimokitazawa' },
  { id: 'jp-pokemon-center', area: 'map', title: 'Pokémon Center' },
  { id: 'jp-teamlab', area: 'map', title: 'teamLab' },
  { id: 'ja51', area: 'japan', title: 'teamLab' },
  { id: 'jp-disneysea', area: 'map', title: 'Tokyo DisneySea' },
  { id: 'ja54', area: 'japan', title: 'Tokyo DisneySea' },
  { id: 'ja53', area: 'japan', title: 'Warner Bros. Studio Tour Tokyo – The Making of Harry Potter' },
  { id: 'jp-hakone-open-air', area: 'map', title: 'Hakone Open-Air Museum' },
  { id: 'ja59', area: 'japan', title: 'Hakone Open-Air Museum' },
  { id: 'jp-owakudani', area: 'map', title: 'Ōwakudani' },
  { id: 'ja60', area: 'japan', title: 'Ōwakudani' },
  { id: 'jp-chureito', area: 'map', title: 'Arakura Sengen Shrine' },
  { id: 'jp-oishi-park', area: 'map', title: 'Lake Kawaguchi' },
  { id: 'jp-nikko-toshogu', area: 'map', title: 'Nikkō Tōshō-gū' },
  { id: 'ja63', area: 'japan', title: 'Nikkō Tōshō-gū' },
  { id: 'jp-kotokuin', area: 'map', title: 'Kōtoku-in' },
  { id: 'ja61', area: 'japan', title: 'Kōtoku-in' },
  { id: 'jp-kamakurakokomae', area: 'map', title: 'Kamakurakōkōmae Station' },
  { id: 'jp-cupnoodles', area: 'map', title: 'Cup Noodles Museum' },
  { id: 'ja62', area: 'japan', title: 'Cup Noodles Museum' },
  { id: 'jp-yokohama-chinatown', area: 'map', title: 'Yokohama Chinatown' },
  { id: 'jf13', area: 'japan', title: 'Yokohama Chinatown' },
  { id: 'jp-gala-yuzawa', area: 'map', title: 'Gala Yuzawa Station' },
  { id: 'jp-ichiran-shibuya', area: 'map', title: 'Ichiran' },
  { id: 'jp-sushi-zanmai', area: 'map', title: 'Sushi Zanmai' },
  { id: 'jf7', area: 'japan', title: 'Sushi Zanmai' },
  { id: 'jp-monja-kondo', area: 'map', title: 'Monjayaki' },
  { id: 'jf11', area: 'japan', title: 'Monjayaki' },

  // Nepal leg build-out: markers added with the Dec place pass that had no photo.
  // Restaurants, cafes and bars are deliberately absent — no Commons subject exists for them.
  { id: 'np-pottery-square', area: 'map', title: 'Bhaktapur' },
  { id: 'np-dharahara', area: 'map', title: 'Dharahara' },
  { id: 'np-rani-pokhari', area: 'map', title: 'Rani Pokhari' },
  { id: 'np-kailashnath', area: 'map', title: 'Kailashnath Mahadev Statue' },
  { id: 'np-bungamati', area: 'map', title: 'Bungamati' },
  { id: 'np-khokana', area: 'map', title: 'Khokana' },
  { id: 'np-kirtipur', area: 'map', title: 'Kirtipur' },
  { id: 'np-panauti', area: 'map', title: 'Panauti' },
  { id: 'np-sankhu', area: 'map', title: 'Sankhu' },
  { id: 'np-chitlang', area: 'map', title: 'Chitlang' },
  { id: 'np-tu-cricket', area: 'map', title: 'Tribhuvan University International Cricket Ground' },
  { id: 'np-budhanilkantha', area: 'map', title: 'Budhanilkantha Temple' },
  { id: 'np-changu-narayan', area: 'map', title: 'Changu Narayan' },
  { id: 'np-asan', area: 'map', title: 'Asan, Kathmandu' },
  { id: 'np-pharping', area: 'map', title: 'Pharping' },
  { id: 'np-chobhar', area: 'map', title: 'Chobhar' },
  { id: 'np-taudaha', area: 'map', title: 'Taudaha' },
  { id: 'np-shivapuri', area: 'map', title: 'Shivapuri Nagarjun National Park' },
  { id: 'np-phulchowki', area: 'map', title: 'Phulchowki' },
  { id: 'np-chandragiri', area: 'map', title: 'Chandragiri Hills' },
  { id: 'np-dhulikhel', area: 'map', title: 'Dhulikhel' },
  { id: 'np-namo-buddha', area: 'map', title: 'Namo Buddha Stupa' },
  { id: 'np-itum-bahal', area: 'map', title: 'Itum Bahal' },
  { id: 'np-nag-bahal', area: 'map', title: 'Patan, Nepal' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Wikimedia throttles bursts with transient 400/429/5xx. Retry those with
// exponential backoff; treat a true 404 (page/file absent) as non-retryable.
async function fetchWithRetry(url, { accept } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const headers = { 'User-Agent': USER_AGENT };
      if (accept) headers.Accept = accept;
      const res = await fetch(url, { headers });
      if (res.ok) return res;
      if (res.status === 404) throw Object.assign(new Error('HTTP 404'), { fatal: true });
      // transient — back off and retry
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
    const backoff = 600 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
    await sleep(backoff);
  }
  throw lastErr ?? new Error('request failed');
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, { accept: 'application/json' });
  return res.json();
}

// Parse the "File:<name>" + Commons/en host from a Commons/Wikipedia image URL.
// Thumb form:.../wikipedia/<proj>/thumb/x/xx/<File>/<n>px-<File>
// Original:.../wikipedia/<proj>/x/xx/<File>
function parseFileRef(imgUrl) {
  const host = imgUrl.includes('/wikipedia/en/')
    ? 'en.wikipedia.org'
    : 'commons.wikimedia.org';

  let fileName = null;
  const thumbMatch = imgUrl.match(/\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\/\d+px-/);
  if (thumbMatch) {
    fileName = decodeURIComponent(thumbMatch[1]);
  } else {
    const origMatch = imgUrl.match(/\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)(?:[?#]|$)/);
    if (origMatch) fileName = decodeURIComponent(origMatch[1]);
  }
  return { host, fileName };
}

function extFromUrl(url) {
  const m = url.match(/\.(jpe?g|png|webp)(?:[?#]|$)/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

// Resolve a renderable image URL + attribution for a Wikipedia title.
//
// Two requests:
// 1. REST summary → confirms the page exists and yields a representative
// thumbnail, from which we extract the File: name and host.
// 2. imageinfo with iiurlwidth=<width> → returns a server-generated `thumburl`
// CLAMPED to the source size. (Manually rewriting a thumb URL to a width
// larger than the source makes upload.wikimedia.org return HTTP 400, which
// is why we ask the API to render it for us.) The same call returns
// extmetadata for attribution, so we get the URL + license in one hit.
async function resolveSubject(title, width) {
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summary = await fetchJson(summaryUrl); // 404 here = page absent (fatal)

  const repUrl = summary?.thumbnail?.source || summary?.originalimage?.source;
  if (!repUrl) throw new Error('no thumbnail/original on page');

  const { host, fileName } = parseFileRef(repUrl);
  if (!fileName) throw new Error('could not parse File name');

  const api =
    `https://${host}/w/api.php?action=query&format=json` +
    `&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=${width}` +
    `&titles=${encodeURIComponent('File:' + fileName)}`;
  const json = await fetchJson(api);
  const pages = json?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error('no imageinfo for file');

  // thumburl is the clamped, server-rendered render; fall back to full url.
  const downloadUrl = info.thumburl || info.url;
  if (!downloadUrl) throw new Error('no thumburl/url');

  const meta = info.extmetadata ?? {};
  const attribution = {
    artist: stripHtml(meta.Artist?.value || ''),
    license: stripHtml(meta.LicenseShortName?.value || ''),
    licenseUrl: meta.LicenseUrl?.value || '',
    credit: stripHtml(meta.Credit?.value || ''),
  };

  return { downloadUrl, attribution, ext: extFromUrl(info.url || downloadUrl) };
}

async function downloadBytes(url) {
  const res = await fetchWithRetry(url);
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error(`content-type ${ct}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_BYTES) throw new Error(`too small (${buf.length} bytes)`);
  return buf;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(IMAGES_DIR, { recursive: true });

  // `--only=id1,id2` re-fetches JUST those manifest ids and MERGES the result into the existing
  // image-map.json instead of rewriting it from scratch. Without this, changing one subject means
  // re-downloading all ~106 images, and every upstream page whose lead image has since changed
  // silently swaps its photo in the same commit — a one-image edit arrives as a repo-wide diff
  // nobody can review. A full run (no flag) still rebuilds everything from scratch, unchanged.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const work = only ? MANIFEST.filter((e) => only.has(e.id)) : MANIFEST;
  if (only) {
    const missing = [...only].filter((id) => !MANIFEST.some((e) => e.id === id));
    if (missing.length) throw new Error(`--only names unknown manifest id(s): ${missing.join(', ')}`);
    console.log(`--only: fetching ${work.length} of ${MANIFEST.length} entries (${[...only].join(', ')})`);
  }

  // title -> { buf, ext, sourceUrl, attribution } cache
  const cache = new Map();

  // Seed from the existing map on a filtered run so untouched entries survive the write below.
  const imageMap = {};
  if (only) {
    try {
      Object.assign(imageMap, JSON.parse(await readFile(path.join(__dirname, 'image-map.json'), 'utf8')));
    } catch {
      console.log('  (no existing image-map.json to merge into — writing a fresh one)');
    }
  }
  const perArea = {};
  const skipped = [];
  let totalBytes = 0;

  for (const entry of work) {
    const { id, area, title } = entry;
    const width = entry.width ?? CARD_WIDTH;
    perArea[area] ??= { resolved: 0, skipped: 0 };

    try {
      let cached = cache.get(title);
      if (!cached) {
        await sleep(POLITE_DELAY_MS);
        const { downloadUrl, attribution, ext } = await resolveSubject(title, width);
        const buf = await downloadBytes(downloadUrl);
        cached = { buf, ext, sourceUrl: downloadUrl, attribution };
        cache.set(title, cached);
      }

      const areaDir = path.join(IMAGES_DIR, area);
      await mkdir(areaDir, { recursive: true });
      const fileName = `${id}${cached.ext}`;
      const filePath = path.join(areaDir, fileName);
      await writeFile(filePath, cached.buf);
      totalBytes += cached.buf.length;

      const rootRelative = `/images/${area}/${fileName}`;
      const alt = entry.alt !== undefined ? entry.alt : title;
      imageMap[id] = {
        path: rootRelative,
        alt,
        title,
        artist: cached.attribution.artist || '',
        license: cached.attribution.license || '',
        licenseUrl: cached.attribution.licenseUrl || '',
        credit: cached.attribution.credit || '',
        sourceUrl: cached.sourceUrl,
        ext: cached.ext,
      };
      perArea[area].resolved += 1;
      console.log(`  OK   [${area}] ${id} <- "${title}" (${(cached.buf.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      perArea[area].skipped += 1;
      skipped.push({ id, area, title, reason: err.message });
      console.log(`  SKIP [${area}] ${id} <- "${title}" — ${err.message}`);
    }
  }

  // Emit image-map.json
  await writeFile(
    path.join(__dirname, 'image-map.json'),
    JSON.stringify(imageMap, null, 2),
    'utf8',
  );

  // Summary
  console.log('\n──────── SUMMARY ────────');
  let totResolved = 0;
  let totSkipped = 0;
  for (const [area, c] of Object.entries(perArea)) {
    console.log(`  ${area.padEnd(12)} resolved=${c.resolved}  skipped=${c.skipped}`);
    totResolved += c.resolved;
    totSkipped += c.skipped;
  }
  console.log(`  ${'TOTAL'.padEnd(12)} resolved=${totResolved}  skipped=${totSkipped}`);
  console.log(`  total bytes written: ${totalBytes} (${(totalBytes / (1024 * 1024)).toFixed(2)} MB)`);
  if (skipped.length) {
    console.log('\n  Skipped ids:');
    for (const s of skipped) console.log(`    - ${s.id} ("${s.title}") — ${s.reason}`);
  }
  console.log('\n  Wrote scripts/image-map.json');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
