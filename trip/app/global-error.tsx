'use client';

// — Next.js NATIVE root error boundary. This ONE file is special: it
// fires only when the ROOT layout itself throws, which means `app/layout.tsx`
// (and everything it renders — ThemeProvider, Tailwind's globals.css, fonts)
// never mounted. Per Next's App Router convention this file must render its
// OWN complete `<html><body>` and cannot rely on Tailwind utility classes or
// app chrome being available, so styling here is deliberately plain inline
// CSS (brand navy/gold lifted from app/globals.css's --background/--primary
// tokens and the manifest themeColor in app/layout.tsx) rather than a shared
// component. Kept minimal on purpose: a reload is the only reliable recovery
// once the layout has failed.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#0a0e27',
          color: '#f7fafc',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '1rem',
            padding: '2rem',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            The app hit a problem
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'rgba(247,250,252,0.75)', margin: '0 0 1.5rem' }}>
            Reloading usually fixes this. Your trip plans and itinerary are safe — they&apos;re
            stored on this device, not lost.
          </p>
          <button
            onClick={() => {
              // Reset first (Next's own recovery); a full reload backs it up
              // in case the crash left module state broken.
              try {
                reset();
              } finally {
                window.location.reload();
              }
            }}
            style={{
              background: '#eec766',
              color: '#141212',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.625rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
