import Link from "next/link";

/**
 * Shared shell for the legal pages (/privacy, /terms). The root layout locks
 * the body to the viewport (overflow: hidden), so this wrapper owns scrolling.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-bg">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <PuzzleMark />
          <span className="font-[family-name:var(--font-display)] text-xl text-text-primary">
            Fragment
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-text-secondary">
          <Link href="/privacy" className="transition-colors hover:text-text-primary">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-text-primary">
            Terms
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-12 pt-8">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-8 text-sm text-text-faint">
          <span>Fragment</span>
          <Link href="/" className="transition-colors hover:text-text-secondary">
            Back to Fragment
          </Link>
        </div>
      </footer>
    </div>
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
