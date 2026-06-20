'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { MapPin, Calendar, Compass, ChevronDown, Plane } from 'lucide-react';
import { TRIP_START, TRIP_DATE_LABEL } from '@/lib/trip-data';
import { computeCountdown, type Countdown } from '@/lib/countdown';
import { withBasePath } from '@/lib/utils';

const COUNTDOWN_UNITS = [
  { key: 'months', label: 'Months' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'days', label: 'Days' },
  { key: 'hours', label: 'Hours' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'seconds', label: 'Seconds' },
] as const;

export default function HeroSection() {
  const [mounted, setMounted] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);
  const [timeLeft, setTimeLeft] = useState<Countdown>({ months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalDays: 0, isPast: false });

  useEffect(() => {
    setMounted(true);
    setTimeLeft(computeCountdown(TRIP_START, new Date()));
    const timer = setInterval(() => setTimeLeft(computeCountdown(TRIP_START, new Date())), 1000);
    return () => clearInterval(timer);
  }, []);

  const scrollTo = (id: string) => {
    document.querySelector(id)?.scrollIntoView?.({ behavior: 'smooth' });
  };

  return (
    <section id="hero" aria-labelledby="hero-heading" className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Decorative CSS + SVG backdrop — Himalayan warmth blending into Japan
          winter-neon. Purely decorative and aria-hidden; no external imagery. */}
      <div className="absolute inset-0" aria-hidden="true">
        {/* Base multi-stop gradient: warm gold/himalaya dawn at the horizon → deep navy night sky */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, #0b1020 0%, #15203c 32%, #2a3252 52%, #6e5a78 70%, #b9786b 82%, #e8a86a 92%, #f4cf8e 100%)',
          }}
        />
        {/* Bundled Himalayan photo layer — sits between the base gradient and the
            glows so the gradient tints it and the SVG + dark overlays render on
            top. Tuned to ~45% so the title and countdown stay legible. On error
            (or if the asset is absent) the original CSS/SVG art shows through. */}
        {!heroImgError && (
          <div className="absolute inset-0">
            <Image
              src={withBasePath('/images/hero/hero.jpg')}
              alt=""
              fill
              priority
              unoptimized
              className="object-cover opacity-[0.45]"
              onError={() => setHeroImgError(true)}
            />
          </div>
        )}
        {/* Soft radial glows — a Himalayan "sun" on the left, a sakura/neon bloom on the right */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 22% 86%, rgba(244,196,107,0.45) 0%, rgba(244,196,107,0) 60%), radial-gradient(45% 40% at 82% 30%, rgba(244,143,177,0.30) 0%, rgba(244,143,177,0) 65%), radial-gradient(40% 35% at 95% 70%, rgba(99,179,237,0.22) 0%, rgba(99,179,237,0) 70%)',
          }}
        />

        {/* Layered mountain-range / skyline silhouette */}
        <svg
          className="absolute inset-x-0 bottom-0 w-full h-[62%]"
          viewBox="0 0 1440 600"
          preserveAspectRatio="xMidYMax slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="rangeFar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3a4368" />
              <stop offset="100%" stopColor="#222a48" />
            </linearGradient>
            <linearGradient id="rangeMid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1c2440" />
              <stop offset="100%" stopColor="#121830" />
            </linearGradient>
            <linearGradient id="rangeNear" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0c1124" />
              <stop offset="100%" stopColor="#070b18" />
            </linearGradient>
          </defs>

          {/* Far Himalayan ridge with snow-lit peaks */}
          <path
            fill="url(#rangeFar)"
            d="M0 330 L120 250 L240 300 L360 200 L470 280 L600 170 L720 250 L850 190 L980 270 L1110 210 L1240 280 L1360 230 L1440 290 L1440 600 L0 600 Z"
          />
          <path
            fill="#f4cf8e"
            opacity="0.85"
            d="M360 200 L392 232 L376 230 L408 252 L344 252 L340 232 Z M600 170 L636 206 L618 204 L652 232 L568 232 L566 206 Z M850 190 L884 222 L868 220 L900 246 L820 246 L816 222 Z M1110 210 L1140 240 L1126 238 L1154 262 L1082 262 L1080 240 Z"
          />

          {/* Mid ridge */}
          <path
            fill="url(#rangeMid)"
            d="M0 420 L160 360 L320 410 L460 340 L620 400 L780 350 L940 410 L1100 360 L1260 405 L1440 360 L1440 600 L0 600 Z"
          />

          {/* Near skyline silhouette — a few modern towers nodding to Tokyo, fading into the foreground */}
          <path
            fill="url(#rangeNear)"
            d="M0 600 L0 470 L80 470 L80 430 L120 430 L120 470 L210 470 L210 410 L240 410 L240 470 L340 470
               L340 360 L360 360 L360 340 L380 340 L380 360 L400 360 L400 470 L520 470 L520 445 L600 445 L600 470
               L700 470 L700 420 L740 420 L740 470 L860 470 L860 455 L960 455 L960 470 L1060 470 L1060 400
               L1085 400 L1085 380 L1100 380 L1100 400 L1120 400 L1120 470 L1240 470 L1240 440 L1340 440 L1340 470
               L1440 470 L1440 600 Z"
          />

          {/* Sparse "neon" window lights on the near skyline */}
          <g fill="#f4cf8e" opacity="0.6">
            <rect x="92" y="442" width="4" height="6" />
            <rect x="102" y="452" width="4" height="6" />
            <rect x="222" y="424" width="4" height="6" />
            <rect x="222" y="440" width="4" height="6" />
            <rect x="366" y="372" width="3" height="6" />
            <rect x="710" y="432" width="4" height="6" />
            <rect x="722" y="448" width="4" height="6" />
            <rect x="1068" y="414" width="4" height="6" />
            <rect x="1068" y="432" width="4" height="6" />
          </g>
          <g fill="#63b3ed" opacity="0.5">
            <rect x="102" y="442" width="4" height="6" />
            <rect x="232" y="424" width="4" height="6" />
            <rect x="710" y="448" width="4" height="6" />
            <rect x="1078" y="424" width="4" height="6" />
          </g>
        </svg>

        {/* Existing dark overlays — keep the title/countdown legible over the art */}
        <div className="absolute inset-0 hero-gradient" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-900 via-transparent to-navy-900/50" />
      </div>

      {/* Floating Decorative Elements */}
      <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-gold-400/5 blur-3xl animate-float" />
      <div className="absolute bottom-40 right-10 w-48 h-48 rounded-full bg-sakura-400/5 blur-3xl animate-float" style={{ animationDelay: '3s' }} />

      <div className="relative z-10 max-w-[1200px] mx-auto px-4 sm:px-6 text-center pt-24 pb-16">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-6"
        >
          <Plane className="w-4 h-4 text-gold-400" />
          <span className="text-sm text-gold-400 font-medium">{TRIP_DATE_LABEL}</span>
        </motion.div>

        {/* Title */}
        <motion.h1
          id="hero-heading"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-4"
        >
          <span className="text-white">Nepal</span>
          <span className="text-gradient-gold mx-3">×</span>
          <span className="text-white">Japan</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto mb-3"
        >
          From the mystical temples of Kathmandu to the neon-lit streets of Tokyo.
          A journey across ancient peaks and futuristic cities.
        </motion.p>

        {/* Quote */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-sm italic text-white/40 mb-10"
        >
          "The world is a book and those who do not travel read only one page." — St. Augustine
        </motion.p>

        {/* Countdown */}
        {mounted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0 }}
            className="mb-10"
          >
            <p className="text-sm text-white/50 mb-4 uppercase tracking-widest">Countdown to Departure</p>
            <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mb-4">
              {COUNTDOWN_UNITS.map(({ key, label }) => (
                <div key={key} className="glass-card rounded-xl px-3 sm:px-5 py-3 sm:py-4 min-w-[70px] sm:min-w-[90px] animate-pulse-glow">
                  <div className="font-mono text-2xl sm:text-3xl md:text-4xl font-bold text-gold-400">
                    {String(timeLeft[key] ?? 0).padStart(2, '0')}
                  </div>
                  <div className="text-[10px] sm:text-xs text-white/50 uppercase tracking-wider mt-1">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-sm text-white/40">
              <span className="font-mono text-gold-400 font-semibold">{timeLeft.totalDays}</span> total days until adventure begins
            </p>
          </motion.div>
        )}

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
          className="flex flex-wrap justify-center gap-3"
        >
          <button
            onClick={() => scrollTo('#itinerary')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 transition-all duration-200 hover:scale-105 shadow-lg shadow-gold-500/20 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none"
          >
            <Calendar className="w-4 h-4" />
            View Itinerary
          </button>
          <button
            onClick={() => scrollTo('#nepal')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl glass-card text-white font-semibold hover:bg-white/10 transition-all duration-200 hover:scale-105 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <Compass className="w-4 h-4 text-himalaya-400" />
            Explore Destinations
          </button>
          <button
            onClick={() => scrollTo('#dashboard')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl glass-card text-white font-semibold hover:bg-white/10 transition-all duration-200 hover:scale-105 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <MapPin className="w-4 h-4 text-sakura-400" />
            Open Dashboard
          </button>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <ChevronDown className="w-6 h-6 text-white/30" />
        </motion.div>
      </motion.div>
    </section>
  );
}
