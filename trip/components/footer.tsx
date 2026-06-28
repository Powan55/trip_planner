'use client';

import { MapPin, Heart } from 'lucide-react';
import { TRIP_DATE_LABEL } from '@/lib/trip-data';

export default function Footer() {
  return (
    <footer className="py-10 px-4 sm:px-6 border-t border-white/5">
      <div className="max-w-[1200px] mx-auto text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <MapPin className="w-4 h-4 text-gold-400" />
          <span className="font-display font-bold text-white">Nepal <span className="text-gold-400">×</span> Japan Journey</span>
        </div>
        <p className="text-sm text-white/30 mb-4">
          {TRIP_DATE_LABEL}
        </p>
        <div className="flex items-center justify-center gap-1 text-xs text-white/20">
          <span>Made with</span>
          <Heart className="w-3 h-3 text-red-400 fill-red-400" />
          <span>for the journey ahead</span>
        </div>
        <p className="mt-4 text-xs text-white/25">
          &copy; {new Date().getFullYear()} Lax
        </p>
      </div>
    </footer>
  );
}
