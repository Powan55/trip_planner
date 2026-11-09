import { preload } from 'react-dom';
import HomePage from '@/components/home-page';
import { HERO_DEFAULT, HERO_SIZES } from '@/lib/hero-image';
import { buildSrcSet } from '@/lib/image-srcset';
import manifest from '@/lib/image-manifest.json';
import { withBasePath } from '@/lib/utils';

export default function Page() {
  const hero = manifest[HERO_DEFAULT];
  const href = withBasePath(hero.avif);
  preload(href, {
    as: 'image',
    type: 'image/avif',
    imageSrcSet: buildSrcSet(hero.variants, withBasePath) ?? href,
    imageSizes: HERO_SIZES,
    fetchPriority: 'high',
  });
  return <HomePage />;
}
