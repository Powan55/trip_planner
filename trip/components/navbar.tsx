'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Calendar, Camera, Compass, Mountain, Menu, X, Plane, Map } from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Itinerary', href: '#itinerary', icon: Calendar },
  { label: 'Flights', href: '#flights', icon: Plane },
  { label: 'Nepal', href: '#nepal', icon: Mountain },
  { label: 'Japan', href: '#japan', icon: Compass },
  { label: 'Photography', href: '#photography', icon: Camera },
  { label: 'Map', href: '#map', icon: Map },
  { label: 'Inspiration', href: '#inspiration', icon: Plane },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNav = (href: string) => {
    setMobileOpen(false);
    const el = document.querySelector(href);
    el?.scrollIntoView?.({ behavior: 'smooth' });
  };

  return (
    <>
      <motion.nav
        aria-label="Primary"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-navy-900/90 backdrop-blur-xl shadow-lg shadow-black/20' : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <button onClick={() => handleNav('#hero')} aria-label="Nepal × Japan — back to top" className="flex items-center gap-2 group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none">
              <MapPin className="w-5 h-5 text-gold-400 group-hover:scale-110 transition-transform" />
              <span className="font-display font-bold text-lg tracking-tight text-white">
                Nepal <span className="text-gold-400">×</span> Japan
              </span>
            </button>

            <div className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleNav(item.href)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/5 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-menu"
              className="md:hidden p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </motion.nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-nav-menu"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-x-0 top-16 z-40 bg-navy-900/95 backdrop-blur-xl border-b border-white/5 md:hidden"
          >
            <div className="p-4 space-y-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleNav(item.href)}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-white/80 hover:text-white hover:bg-white/5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                >
                  <item.icon className="w-5 h-5 text-gold-400" />
                  {item.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
