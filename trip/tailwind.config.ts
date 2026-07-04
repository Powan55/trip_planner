import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        // refined aurora backdrop
        aurora: 'var(--gradient-aurora)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'var(--radius-lg)',
        // v2 additive larger radii for panels/heroes.
        '2xl': 'var(--radius-xl)',
        '3xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        // elevation tiers + scroll-accent glow (driven by CSS vars).
        glow: 'var(--shadow-glow)',
        xl: 'var(--shadow-xl)',
        // v2 deepest elevation for hero/panel surfaces (additive).
        '2xl': 'var(--shadow-2xl)',
      },
      fontSize: {
        // v2 editorial DISPLAY scale — additive keys only. Default text-base/lg/xl…
        // are intentionally NOT redefined (that would shift existing components and
        // risk overflow). Heroes pair these with font-display + .text-gradient-*;
        // section overlines use `text-eyebrow uppercase`.
        'display-2xl': ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '1.02', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-xl': ['clamp(2.25rem, 4.6vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '600' }],
        'display-lg': ['clamp(1.875rem, 3.4vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-md': ['clamp(1.5rem, 2.4vw, 2rem)', { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '600' }],
        'eyebrow': ['0.75rem', { lineHeight: '1', letterSpacing: '0.22em', fontWeight: '600' }],
      },
      spacing: {
        // v2 8pt rhythm — additive semantic keys only (Tailwind's 4pt base covers
        // the rest; do NOT redefine the default scale).
        section: 'clamp(4rem, 8vw, 7rem)',   /* vertical rhythm between major sections */
        gutter: 'clamp(1rem, 4vw, 2rem)',    /* responsive page inset */
        '18': '4.5rem',
        '22': '5.5rem',
      },
      colors: {
        navy: { 900: '#0a0e27', 800: '#111640', 700: '#1a2050' },
        gold: { 400: '#f0c760', 500: '#d4a843', 600: '#b8922e' },
        sakura: { 300: '#ffb7c5', 400: '#f7a0b3', 500: '#e88fa2' },
        himalaya: { 400: '#ff8c42', 500: '#e67635', 600: '#cc6228' },
        // single scroll-driven accent (default gold; the accent engine animates the var).
        'accent-scroll': 'hsl(var(--accent-scroll))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.4s ease-out',
        'fade-out': 'fade-out 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
