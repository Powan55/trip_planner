'use client';

import RecommendationSection from './recommendation-section';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD, NEPAL_CATEGORIES } from '@/lib/nepal-data';

export default function NepalSection() {
  const allItems = [...NEPAL_ATTRACTIONS, ...NEPAL_FOOD];

  return (
    <RecommendationSection
      id="nepal"
      title="Nepal Destinations"
      titleGradient="text-gradient-himalaya"
      subtitle="Explore the mystical temples, vibrant markets, and breathtaking mountain views of Kathmandu Valley."
      items={allItems}
      categories={NEPAL_CATEGORIES}
      accentColor="text-himalaya-400"
      glassClass="glass-nepal"
    />
  );
}
