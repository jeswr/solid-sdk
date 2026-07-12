// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The signed-in app chrome (adopts `@jeswr/app-shell`): a header with the app
 * name, primary nav, theme toggle, feedback button, and the account menu (sign
 * out). Wraps the page content in `<main>`. Rendered only in the authed branch of
 * the SessionProvider, so the account menu always has a session.
 */
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session/context";

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/log", label: "Log food" },
  { href: "/symptoms", label: "Symptoms" },
  { href: "/insights", label: "Insights" },
  { href: "/plan", label: "Plan" },
  { href: "/protocols", label: "Challenges" },
  { href: "/genetics", label: "Genetics" },
  { href: "/knowledge/research", label: "Research" },
  { href: "/community", label: "Community" },
];

/** Is `href` the current page? Exact for "/", prefix for nested routes. */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppChrome({ children }: { children: ReactNode }) {
  const { webId, logout } = useSession();
  const pathname = usePathname();
  return (
    <div className="app">
      <header className="app__header">
        <Link href="/" className="app__brand">
          Coeliac Diary
        </Link>
        <nav className="app__nav" aria-label="Primary">
          {NAV_ITEMS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="app__actions">
          <ThemeToggle />
          <FeedbackButton repo="jeswr/coeliac-app" appName="Coeliac Diary" webId={webId} />
          <AccountMenu webId={webId} onSignOut={() => void logout()} />
        </div>
      </header>
      <main className="app__main">{children}</main>
      <footer className="app__footer">
        <p>
          Decision support, not diagnosis. This app never diagnoses a disease — see a doctor.
          Your diary lives in your own Solid pod.
        </p>
      </footer>
    </div>
  );
}
