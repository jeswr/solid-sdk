// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="shell-public">
      <a href="/welcome" className="shell-brand">
        <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
          <polygon points="20,3 35,12 35,28 20,37 5,28 5,12" fill="currentColor" />
        </svg>
        Solid Suite
      </a>
      <div className="shell-public-card">{children}</div>
    </main>
  );
}
