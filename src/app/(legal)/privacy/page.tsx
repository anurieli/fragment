import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Fragment",
  description: "How Fragment handles your data.",
};

const LAST_UPDATED = "August 3, 2026";

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-text-primary">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-text-faint">Last updated: {LAST_UPDATED}</p>

      <Section title="Overview">
        <P>
          Fragment is a writing application. It is local-first by design: by
          default, your writing is stored in your own browser and does not
          leave your device. This policy describes what information we collect
          when you use the hosted edition of Fragment, and how we handle it.
        </P>
      </Section>

      <Section title="Information stored on your device">
        <P>
          Your documents, notes, snips, and settings are stored locally in your
          browser&apos;s storage. We do not have access to this data unless you
          use a feature that explicitly sends it to us or to a third party, as
          described below.
        </P>
      </Section>

      <Section title="Information we collect">
        <P>
          <Strong>Account information.</Strong> If you create an account or
          sign in, we collect the information needed to operate your account,
          such as your email address and name.
        </P>
        <P>
          <Strong>Synced content.</Strong> If you enable cloud sync, the
          content you choose to sync is stored on our servers so it can be
          available across your devices.
        </P>
        <P>
          <Strong>Shared content.</Strong> If you create a share or review
          link, the shared content is stored on our servers and is accessible
          to anyone who has the link, until you remove it.
        </P>
        <P>
          <Strong>Technical and diagnostic data.</Strong> We collect limited
          technical information needed to operate and secure the service, such
          as basic request logs and error reports. Error reports may include
          diagnostic details about your browser and the state of the
          application when an error occurred.
        </P>
      </Section>

      <Section title="AI features">
        <P>
          Fragment&apos;s AI features work through an AI provider that you
          connect yourself. When you use an AI feature, the relevant text is
          sent to your connected provider to generate a response, and their
          terms and privacy policy apply to that processing. We do not use
          your content to train AI models.
        </P>
      </Section>

      <Section title="Cookies">
        <P>
          We use cookies for essential purposes only, such as keeping you
          signed in and remembering basic preferences. We do not use
          advertising or cross-site tracking cookies.
        </P>
      </Section>

      <Section title="How we use information">
        <P>
          We use the information described above to provide, maintain, secure,
          and improve the service. We do not sell your personal information.
        </P>
      </Section>

      <Section title="Sharing of information">
        <P>
          We share information only with service providers that help us run
          the service (such as hosting, database, and error-reporting
          providers), with your connected AI provider when you use an AI
          feature, when required by law, or with your consent.
        </P>
      </Section>

      <Section title="Data retention and deletion">
        <P>
          We keep account data and synced content for as long as your account
          is active. You can delete synced or shared content from within the
          app, and you can request deletion of your account and associated
          data by contacting us.
        </P>
      </Section>

      <Section title="Security">
        <P>
          We take reasonable measures to protect the information we hold. No
          method of transmission or storage is completely secure, so we cannot
          guarantee absolute security.
        </P>
      </Section>

      <Section title="Children">
        <P>
          Fragment is not directed at children under 13, and we do not
          knowingly collect personal information from them.
        </P>
      </Section>

      <Section title="Changes to this policy">
        <P>
          We may update this policy from time to time. When we do, we will
          update the date at the top of this page. Continued use of the
          service after changes take effect constitutes acceptance of the
          updated policy.
        </P>
      </Section>

      <Section title="Contact">
        <P>
          Questions about this policy can be sent to{" "}
          <a
            href="mailto:anurieli365@gmail.com"
            className="text-gold transition-colors hover:text-gold-hover"
          >
            anurieli365@gmail.com
          </a>
          .
        </P>
      </Section>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-[family-name:var(--font-display)] text-2xl text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 leading-relaxed text-text-secondary">{children}</p>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-text-primary">{children}</strong>;
}
