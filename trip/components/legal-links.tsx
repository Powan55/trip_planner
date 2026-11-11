import Link from 'next/link';

const LINKS = [
  { href: '/privacy/', label: 'Privacy' },
  { href: '/terms/', label: 'Terms' },
  { href: '/contact/', label: 'Contact' },
];

/** Footer and sign-in links to the legal pages. No hooks, so it works inside the wall too. */
export default function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap items-center justify-center gap-x-1 ${className}`}>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-3 font-machine text-t-label uppercase tracking-[0.13em] text-[color:var(--text-mid)] underline underline-offset-4 hover:text-[color:var(--text-hi)]"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
