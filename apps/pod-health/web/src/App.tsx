// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL pod-health <HealthRecords>
// pointed at the user's health resource. The view receives NO `fetch` prop — it
// uses the ambient global fetch, which the SessionProvider patched via
// reactive-auth's registerGlobally(), so every read carries the DPoP token
// automatically.
//
// RESOURCE DISCOVERY: unlike Pod Docs (whose DocsStore discovers its container
// internally), pod-health's data layer reads a single record DOCUMENT URL handed
// to it (a plain GET, no container listing). So the host derives that document
// URL after login via Type-Index discovery (`discoverHealthResource` — locate
// health:HealthRecord), falling back to the conventional
// `${podRoot}health/record.ttl` DOCUMENT (NOT the `health/` container) and
// surfacing a banner when it does.

import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { HealthRecords } from "pod-health/ui";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { discoverHealthResource, type HealthResource } from "./health-resource";
import { LoginScreen } from "./LoginScreen";

export function App() {
  const { webId, session, logout, autologinPending, restorePending } = useSession();
  // The discovered health resource (Type Index → else conventional fallback).
  const [resource, setResource] = useState<HealthResource | null>(null);

  // Resolve the resource URL once a session exists; re-run if the identity
  // changes. Cancellation guards against a stale discovery committing after a
  // fast logout / re-login.
  useEffect(() => {
    if (!session) {
      setResource(null);
      return;
    }
    let cancelled = false;
    setResource(null);
    discoverHealthResource(session.webId, session.podRoot)
      .then((r) => {
        if (!cancelled) setResource(r);
      })
      .catch(() => {
        // discoverHealthResource never rejects, but guard defensively: degrade to
        // the conventional record DOCUMENT (`${podRoot}health/record.ttl`, NOT the
        // `health/` container — the data layer reads a single document) rather than
        // stranding the view with no resource.
        if (!cancelled) {
          setResource({ resourceUrl: `${session.podRoot}health/record.ttl`, isFallback: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!webId || !session) {
    // A restore / autologin is silently re-establishing the session — show a brief
    // restoring state rather than the interactive login form, since there is no gesture
    // to prompt for:
    //  - restorePending: SILENT SESSION RESTORE on load (a returning user's persisted
    //    DPoP refresh token is being redeemed — no popup/iframe). Cross-app invariant #1.
    //  - autologinPending: an explicit Pod-Manager deep-link / redirect-return full-page
    //    flow is signing the user in.
    if (restorePending || autologinPending) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Health</h1>
            <p className="login-sub" role="status">
              {autologinPending ? "Signing you in…" : "Restoring your session…"}
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      {/* The header uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountMenu/> (avatar + display name, dropdown showing the WebID
          + Sign out) — replacing the old raw-WebID span + bare logout button. The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-health files against
          `jeswr/pod-health`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Health</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo="jeswr/pod-health"
            appName="Pod Health"
            appVersion={__APP_VERSION__}
            webId={webId}
          />
          <ThemeToggle />
          <AccountMenu
            webId={webId}
            displayName={session.displayName}
            avatarUrl={session.avatarUrl}
            onSignOut={logout}
          />
        </div>
      </header>
      {session.podRootIsFallback ? (
        <p className="app-note" role="note">
          Your profile advertises no <code>pim:storage</code>; using your WebID origin (
          <code>{session.podRoot}</code>) as the pod root.
        </p>
      ) : null}
      {resource?.isFallback ? (
        <p className="app-note" role="note">
          No <code>health:HealthRecord</code> registration was found in your Type Index; reading the
          conventional <code>{resource.resourceUrl}</code> path instead.
        </p>
      ) : null}
      <main className="app-main">
        {resource ? (
          // resourceUrl only — the pod-health data layer reads this single
          // resource. No fetch prop: the global fetch is auth-patched.
          <HealthRecords resourceUrl={resource.resourceUrl} title="Your health records" />
        ) : (
          <p className="app-loading" role="status">
            Finding your health records…
          </p>
        )}
      </main>
    </div>
  );
}
