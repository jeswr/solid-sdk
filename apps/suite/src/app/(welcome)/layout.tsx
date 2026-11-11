// AUTHORED-BY Codex GPT-6.1-Sol
import Link from "next/link";
import type { ReactNode } from "react";

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="welcome-layout">
      <header className="welcome-brand">
        <Link href="/welcome" className="shell-brand">
          <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
            <polygon points="20,3 35,12 35,28 20,37 5,28 5,12" fill="currentColor" />
          </svg>
          Solid Suite
        </Link>
      </header>
      <main id="main-content" className="welcome-main">
        {children}
      </main>
    </div>
  );
}
