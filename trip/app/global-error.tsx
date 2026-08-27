'use client';

// — Next.js NATIVE root error boundary. This ONE file is special: it
// fires only when the ROOT layout itself throws, which means `app/layout.tsx`
// (and everything it renders — ThemeProvider, Tailwind's globals.css, fonts)
// never mounted. Per Next's App Router convention this file must render its
// OWN complete `<html><body>` and cannot rely on Tailwind utility classes or
// app chrome being available, so every value here is a LITERAL that names the
// token it copies. Kept minimal on purpose: a reload is the only reliable
// recovery once the layout has failed.
//
// The literals, and what each is a copy of. They cannot be `var()` — nothing
// declared them on this document — so the comment is the only tie there is:
//   #0A0818  --bg / --background   the page field
//   #140F20  --on-accent           the ONLY ink permitted on a saturated fill
//   #3ED8FF  --accent              volt; white on it measures 1.68:1, hence the ink above
//   #1C97CC  --lip-volt            the button's bottom edge
//   #9184C9  --border-ui           the panel rule
//   #FFFFFF  --text-hi
//   #CFC6E0  --text-mid
const FIELD = '#0A0818';
const ACCENT = '#3ED8FF';
const LIP = '#1C97CC';
const ON_ACCENT = '#140F20';
const TEXT_HI = '#FFFFFF';
const TEXT_MID = '#CFC6E0';

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
          background: FIELD,
          color: TEXT_HI,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: '28rem',
            width: '100%',
            border: '2px solid rgba(145,132,201,0.55)',
            borderRadius: '2px',
            padding: '1.75rem 1.5rem',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          <p
            style={{
              margin: '0 0 0.9rem',
              fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: TEXT_MID,
            }}
          >
            System · Shell did not start
          </p>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem', lineHeight: 1.15 }}>
            The app hit a problem
          </h1>
          <p style={{ fontSize: '0.9375rem', color: TEXT_MID, margin: '0 0 1.5rem', lineHeight: 1.5 }}>
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              minHeight: '44px',
              background: ACCENT,
              color: ON_ACCENT,
              border: 'none',
              borderBottom: `3px solid ${LIP}`,
              borderRadius: '2px',
              padding: '0.625rem 1.5rem',
              fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
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
