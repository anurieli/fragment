import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Fragment",
  description: "The terms that govern your use of Fragment.",
};

const LAST_UPDATED = "August 3, 2026";

export default function TermsPage() {
  return (
    <article>
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-text-primary">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-text-faint">Last updated: {LAST_UPDATED}</p>

      <Section title="Acceptance of these terms">
        <P>
          By accessing or using Fragment, you agree to be bound by these Terms
          of Service. If you do not agree to these terms, do not use the
          service.
        </P>
      </Section>

      <Section title="The service">
        <P>
          Fragment is a writing application. The hosted edition optionally
          provides accounts, cloud sync, sharing, and AI-assisted features.
          The service is provided on an as-available basis and may change over
          time; features may be added, modified, or removed.
        </P>
      </Section>

      <Section title="Accounts">
        <P>
          You are responsible for the activity that occurs under your account
          and for keeping your sign-in credentials secure. You must provide
          accurate information when creating an account.
        </P>
      </Section>

      <Section title="Your content">
        <P>
          You retain all rights to the content you create in Fragment. By
          using features that store or transmit content through our servers
          (such as cloud sync or sharing), you grant us a limited license to
          host, store, and transmit that content solely as needed to operate
          the service. We claim no ownership of your writing.
        </P>
      </Section>

      <Section title="Acceptable use">
        <P>
          You agree not to misuse the service. This includes not attempting to
          breach or probe its security, not interfering with its operation,
          not using it to store or distribute unlawful content, and not using
          it in a way that infringes the rights of others.
        </P>
      </Section>

      <Section title="AI features and third-party services">
        <P>
          AI features operate through a third-party AI provider that you
          connect yourself. Your use of a connected provider is governed by
          that provider&apos;s own terms, and you are responsible for
          complying with them. We are not responsible for the output of
          third-party AI services.
        </P>
      </Section>

      <Section title="Open source">
        <P>
          Fragment&apos;s client is open-source software. Use of the source
          code is governed by the license in the code repository, which is
          separate from these terms for the hosted service.
        </P>
      </Section>

      <Section title="Disclaimer of warranties">
        <P>
          The service is provided &quot;as is&quot; and &quot;as
          available,&quot; without warranties of any kind, whether express or
          implied, including warranties of merchantability, fitness for a
          particular purpose, and non-infringement. We do not warrant that the
          service will be uninterrupted, error-free, or free of data loss. You
          are responsible for backing up your work.
        </P>
      </Section>

      <Section title="Limitation of liability">
        <P>
          To the maximum extent permitted by law, we will not be liable for
          any indirect, incidental, special, consequential, or exemplary
          damages, or for any loss of data, profits, or goodwill, arising from
          or related to your use of the service.
        </P>
      </Section>

      <Section title="Termination">
        <P>
          You may stop using the service at any time. We may suspend or
          terminate access to the service if these terms are violated or as
          needed to protect the service and its users.
        </P>
      </Section>

      <Section title="Changes to these terms">
        <P>
          We may update these terms from time to time. When we do, we will
          update the date at the top of this page. Continued use of the
          service after changes take effect constitutes acceptance of the
          updated terms.
        </P>
      </Section>

      <Section title="Contact">
        <P>
          Questions about these terms can be sent to{" "}
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
