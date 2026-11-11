import PageHeader from '@/components/page-header';
import LegalSection from '@/components/legal-section';

export const metadata = {
  title: 'Contact · Nepal × Japan Journey',
  description: 'How to report a problem or ask about your data.',
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Legal"
        title="Contact"
        description="How to report a problem or ask about your data."
        className="max-w-5xl"
      />
      <div className="mx-auto max-w-3xl px-gutter pb-16">
        <LegalSection title="GitHub issues">
          <p>
            Bugs, questions and data requests go to the project&apos;s{' '}
            <a href="https://github.com/Powan55/trip_planner/issues" rel="noopener noreferrer">
              issue tracker on GitHub
            </a>
            . A free GitHub account is needed, and issues are public, so leave out passwords, Trip Tokens and
            personal details. For a data removal request, name the username to remove and nothing more; you
            will be told how to confirm it is yours.
          </p>
        </LegalSection>
      </div>
    </main>
  );
}
