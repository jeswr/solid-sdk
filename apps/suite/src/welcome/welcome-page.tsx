// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { AppIcon, Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { safeNext } from "@/shell/lib/next";
import { DemoButton } from "@/shell/public/demo-button";
import { useRegistration } from "@/shell/registration/use-registration";
import { companionApps, welcomeApps } from "./apps";
import { WelcomeVideos } from "./videos";

function Welcome() {
  const registration = useRegistration();
  const next = useSearchParams().get("next");
  const suffix = next ? `?next=${encodeURIComponent(safeNext(next))}` : "";
  return (
    <>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <p className="welcome-eyebrow">Solid Suite · Early preview</p>
        <h1 id="welcome-title">Try the Solid Suite</h1>
        <p className="welcome-blurb">
          Everyday apps for files, documents, tasks, calendars and contacts, with your data in a pod
          you control. Try it for about twenty minutes and tell us honestly what works and what
          doesn't.
        </p>
        <div className="welcome-actions">
          <Button asChild>
            <Link href="/welcome/walkthrough">Start the guided walkthrough</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/feedback">Give feedback</Link>
          </Button>
        </div>
        <div className="welcome-actions welcome-signin">
          <Button variant="outline" asChild>
            <Link href={`/signin${suffix}`}>Sign in</Link>
          </Button>
          {registration.available && (
            <Button variant="outline" asChild>
              <Link href={`/signup${suffix}`}>Create account</Link>
            </Button>
          )}
          <DemoButton next={next} />
        </div>
        <p className="welcome-note">
          The demo pod lives in this browser only. Nothing is shared. You can also{" "}
          <Link href={`/signin${suffix}`}>use your own pod</Link>.
        </p>
      </section>
      <section className="welcome-section" aria-labelledby="apps-title">
        <h2 id="apps-title">The apps</h2>
        <p>Pick an app to explore. Early apps are still taking shape.</p>
        <nav className="welcome-app-grid" aria-label="Suite apps">
          {welcomeApps.map((app) => (
            <Link
              key={app.slug}
              href={app.basePath}
              className="welcome-card welcome-app-card"
              data-app={app.slug}
            >
              <div className="welcome-app-heading">
                <AppIcon app={app.slug} decorative />
                <h3>{app.name}</h3>
                <span className="welcome-status">{app.statusLabel}</span>
              </div>
              <p>{app.description}</p>
            </Link>
          ))}
        </nav>
        <h3 className="welcome-companion-title">Companion apps</h3>
        <p>Standalone apps and tools that work with the suite.</p>
        <nav className="welcome-app-grid" aria-label="Companion apps">
          {companionApps.map((app) => (
            <a
              key={app.id}
              href={app.href}
              rel="noopener noreferrer"
              className="welcome-card welcome-app-card"
            >
              <div className="welcome-app-heading">
                <h4>{app.name}</h4>
                <span className="welcome-status">{app.statusLabel}</span>
              </div>
              <p>{app.description}</p>
            </a>
          ))}
        </nav>
      </section>
      <WelcomeVideos />
      <section className="welcome-section welcome-feedback" aria-labelledby="feedback-title">
        <h2 id="feedback-title">How to give feedback</h2>
        <ol>
          <li>Try a few things in the apps. Notice what works and what gets in the way.</li>
          <li>Open Give feedback at any time. You will find it in the top bar of every app.</li>
          <li>
            Take a guided interview of about ten minutes, or just tell us something. You can type or
            talk. Check the read-back before you submit.
          </li>
        </ol>
        <Button asChild>
          <Link href="/feedback">Give feedback</Link>
        </Button>
      </section>
    </>
  );
}

export function WelcomePage() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}
