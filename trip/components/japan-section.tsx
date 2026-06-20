'use client';

import RecommendationSection from './recommendation-section';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD, JAPAN_CATEGORIES } from '@/lib/japan-data';

export default function JapanSection() {
  const allItems = [...JAPAN_ATTRACTIONS, ...JAPAN_FOOD];

  return (
    <RecommendationSection
      id="japan"
      title="Japan Winter"
      titleGradient="text-gradient-sakura"
      subtitle="From Tokyo's neon glow to Kyoto's ancient temples — your ultimate winter Japan guide."
      items={allItems}
      categories={JAPAN_CATEGORIES}
      accentColor="text-sakura-400"
      glassClass="glass-japan"
    />
  );
}
