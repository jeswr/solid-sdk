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
import type { ReactNode } from "react";
import { useSession } from "@/lib/session/context";

export function AppChrome({ children }: { children: ReactNode }) {
  const { webId, logout } = useSession();
  return (
    <div className="app">
      <header className="app__header">
        <Link href="/" className="app__brand">
          Coeliac Diary
        </Link>
        <nav className="app__nav" aria-label="Primary">
          <Link href="/">Home</Link>
          <Link href="/log">Log food</Link>
          <Link href="/symptoms">Symptoms</Link>
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
