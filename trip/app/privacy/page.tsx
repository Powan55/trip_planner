import Link from 'next/link';
import PageHeader from '@/components/page-header';
import LegalSection from '@/components/legal-section';

export const metadata = {
  title: 'Privacy · Nepal × Japan Journey',
  description: 'What this trip planner stores, where it goes, and which outside services it talks to.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Legal"
        title="Privacy"
        description="What this app stores, where it goes, and which outside services it talks to. Last updated November 2026."
        className="max-w-5xl"
      />
      <div className="mx-auto max-w-3xl px-gutter pb-16">
        <LegalSection title="Who runs this">
          <p>
            This is a small personal trip planner run by an individual, not a company. It has no ads, no
            analytics and no tracking cookies.
          </p>
        </LegalSection>

        <LegalSection title="Stored on your device">
          <p>
            Your itinerary, budget and expenses, favorites, journal, packing and checklist state, display
            preferences and a random device id are kept in your browser&apos;s local storage (the device id is also the name of your presence record in Firestore). Photos you attach
            stay on your device in browser storage and are never uploaded. The service worker caches the app
            and its pages so it works offline. You can export or clear this data from Settings.
          </p>
        </LegalSection>

        <LegalSection title="Account and sync (Google Firebase)">
          <p>
            Signing in uses Firebase Authentication. Your username, display name and a password hash are held
            by Google. When sync is on, trip data (days, places, budget, expenses, journal entries, checklists,
            your trip list and preferences) is stored in Firebase Firestore, and a presence record shows other
            members of the same trip who is active. Anyone who joins your trip with its token can see and edit
            that shared data. Google processes this under its own terms and privacy policy.
          </p>
        </LegalSection>

        <LegalSection title="AI concierge">
          <p>
            When you send a message to the concierge, it goes to a Cloudflare Worker run for this app, together
            with a summary of your trip (dates, cities and itinerary), recent chat history, and the sign-in
            token that proves your account. The Worker may keep request logs briefly. Map or place links you paste to import a place are also sent to the Worker, which opens them to find the place. It forwards the message to an AI provider: Groq by default, or NVIDIA-hosted Kimi if you pick that model, with
            Groq as fallback. Do not put anything in a message you would not want a third-party AI provider to
            see. The concierge can be wrong; check anything that matters.
          </p>
        </LegalSection>

        <LegalSection title="Other services the app calls">
          <ul>
            <li>Open-Meteo: weather and air quality for trip cities (the city&apos;s coordinates, not yours).</li>
            <li>Frankfurter: currency exchange rates.</li>
            <li>OpenFreeMap: map tiles for the part of the map you are viewing.</li>
            <li>Nominatim (OpenStreetMap): the place search text you type.</li>
            <li>Google (Firebase) scripts and APIs for sign-in and sync, as above.</li>
          </ul>
          <p>
            These services see your IP address and the request itself, as with any web request. Nothing here
            is sold or used for advertising by this app.
          </p>
        </LegalSection>

        <LegalSection title="Location">
          <p>
            During the trip, the app may ask for your browser location once a day to confirm you are in a
            planned city, and the map&apos;s &ldquo;where am I&rdquo; control uses it when you tap it. Both
            run on your device; your coordinates are not sent anywhere. Saying no changes nothing else.
          </p>
        </LegalSection>

        <LegalSection title="Your choices">
          <p>
            Clear or export on-device data in Settings, or clear your browser&apos;s site data. To have synced
            data removed, use the <Link href="/contact/">contact page</Link>.
          </p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>This page is updated when the app&apos;s data use changes; the date above shows the latest revision.</p>
        </LegalSection>
      </div>
    </main>
  );
}
