import Link from 'next/link';
import PageHeader from '@/components/page-header';
import LegalSection from '@/components/legal-section';

export const metadata = {
  title: 'Terms · Nepal × Japan Journey',
  description: 'The ground rules for using this trip planner.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Legal"
        title="Terms"
        description="The ground rules for using this trip planner. Last updated November 2026."
        className="max-w-5xl"
      />
      <div className="mx-auto max-w-3xl px-gutter pb-16">
        <LegalSection title="What this is">
          <p>
            A free, personal trip planner shared with friends and family. It is provided as is, with no
            warranty and no promise it will stay available or keep working.
          </p>
        </LegalSection>

        <LegalSection title="Check before you rely on it">
          <p>
            Itinerary details, opening hours, prices, transit times, visa, health and safety notes, exchange
            rates, weather and concierge replies can be wrong or out of date. Confirm anything that matters
            with the official source before you travel. The app is not travel, medical, legal or emergency
            advice.
          </p>
        </LegalSection>

        <LegalSection title="Your account and content">
          <p>
            Keep your password and Trip Tokens to yourself; whoever holds a token can join and edit that trip.
            What you write stays yours. By syncing it you let the app store and show it to the members of your
            trip. Do not use the app to store anything unlawful or anything you do not have the right to share.
          </p>
        </LegalSection>

        <LegalSection title="Fair use">
          <p>
            Do not try to break, overload or scrape the service or its AI concierge, or get around its limits.
            Access may be limited or removed for anyone who does.
          </p>
        </LegalSection>

        <LegalSection title="Liability">
          <p>
            To the extent the law allows, the person running this app is not liable for missed bookings, lost
            data or any other loss from using it. Keep backups of anything important; Settings can export your
            data.
          </p>
        </LegalSection>

        <LegalSection title="Changes and questions">
          <p>
            These terms may change; the date above shows the latest revision. Questions go through the{' '}
            <Link href="/contact/">contact page</Link>. How data is handled is described in the{' '}
            <Link href="/privacy/">privacy page</Link>.
          </p>
        </LegalSection>
      </div>
    </main>
  );
}
