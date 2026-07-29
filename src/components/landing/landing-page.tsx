"use client";

import { Scissors, Sparkles, Wand2, Newspaper, Cloud } from "lucide-react";

const GITHUB_URL = "https://github.com/anurieli/fragment";

/**
 * The public front door of the hosted edition.
 *
 * Rendered only when all three are true: hosted build, no session cookie, no
 * "entered" cookie (see src/app/page.tsx). Everyone else lands straight in
 * the app, because Fragment is local-first and the writing surface, not a
 * marketing page, is the product.
 */
export function LandingPage() {
  function enterApp() {
    // The server routes on this cookie: once someone has chosen the app,
    // never show them the brochure again.
    document.cookie = "fragment_entered=1; path=/; max-age=31536000; SameSite=Lax";
    window.location.reload();
  }

  return (
    <div className="h-full overflow-y-auto bg-bg">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <PuzzleMark />
          <span className="font-[family-name:var(--font-display)] text-xl text-text-primary">
            Fragment
          </span>
        </div>
        <nav className="flex items-center gap-4">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <Github size={16} />
            GitHub
          </a>
          <button
            onClick={enterApp}
            className="rounded-[10px] border border-gold/30 bg-gold/10 px-4 py-1.5 text-sm text-gold transition-colors hover:bg-gold/20"
          >
            Open Fragment
          </button>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-5xl leading-tight text-text-primary sm:text-6xl">
          Writing is a puzzle.
          <br />
          <span className="text-gold">Hold all the pieces.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-text-secondary">
          Fragment is a writing app for essays, posts, and everything long-form.
          Snip ideas into cards, rearrange them until the argument clicks, and
          weave them back into the draft. AI labels and tightens; the thinking
          stays yours.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <button
            onClick={enterApp}
            className="rounded-[10px] bg-gold px-6 py-3 text-base font-medium text-bg transition-colors hover:bg-gold-hover"
          >
            Start writing
          </button>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[10px] border border-border-strong px-6 py-3 text-base text-text-secondary transition-colors hover:border-border-active hover:text-text-primary"
          >
            <Github size={18} />
            View on GitHub
          </a>
        </div>
        <p className="mt-4 text-sm text-text-faint">
          Free to use. No account needed. Your writing lives in your browser
          until you choose to sync it.
        </p>
      </section>

      {/* Feature cards */}
      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-2 lg:grid-cols-4">
        <FeatureCard
          icon={<Scissors size={18} />}
          title="Snip"
          body="Pull a sentence or paragraph out of the draft into a card. Set it aside, try it somewhere else, drag it back when it fits."
        />
        <FeatureCard
          icon={<Sparkles size={18} />}
          title="Flow"
          body="Type a slash mid-document to generate a line right where you are stuck, without leaving the draft."
        />
        <FeatureCard
          icon={<Wand2 size={18} />}
          title="Refine"
          body="Highlight anything for a floating toolbar: make it concise, elaborate, or describe the edit you want."
        />
        <FeatureCard
          icon={<Newspaper size={18} />}
          title="Press"
          body="Turn one idea into many pieces: LinkedIn posts, threads, essays. Review, edit, and publish from one inbox."
        />
      </section>

      {/* Sync */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="rounded-[14px] border border-border bg-surface p-8 text-center">
          <Cloud size={22} className="mx-auto text-gold" />
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl text-text-primary">
            Your library, on every device
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-text-secondary">
            Fragment is local-first: it works with no account and no network.
            Sign in and your notes, ideas, and pieces sync across devices,
            with your words stored in your account and nowhere else.
          </p>
        </div>
      </section>

      {/* Open source */}
      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-text-primary">
          Open source, MIT licensed
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-text-secondary">
          The Fragment editor is open source. Read the code, run it yourself,
          or fork it. The hosted edition adds accounts, sync, and managed AI on
          top of the same client.
        </p>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 text-gold transition-colors hover:text-gold-hover"
        >
          <Github size={18} />
          anurieli/fragment
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8 text-sm text-text-faint">
          <span>Fragment</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-text-secondary"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-6 transition-colors hover:border-border-strong">
      <div className="text-gold">{icon}</div>
      <h3 className="mt-3 font-[family-name:var(--font-display)] text-lg text-text-primary">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</p>
    </div>
  );
}

/** lucide-react no longer ships brand icons, so the GitHub mark is inlined. */
function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.04 11.04 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .3.21.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/** Four offset squares: the puzzle-pieces mark, in brand gold. */
function PuzzleMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="1" width="9" height="9" rx="2" fill="var(--color-gold)" opacity="0.9" />
      <rect x="12" y="3" width="8" height="8" rx="2" fill="var(--color-gold)" opacity="0.5" />
      <rect x="3" y="12" width="8" height="8" rx="2" fill="var(--color-gold)" opacity="0.5" />
      <rect x="13" y="13" width="7" height="7" rx="2" fill="var(--color-gold)" opacity="0.3" />
    </svg>
  );
}
