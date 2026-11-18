// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL pod-health <HealthRecords>
// pointed at the user's health resource. Discovery and the view receive
// pod-auth's bounded fetch explicitly; global fetch stays public.
//
// RESOURCE DISCOVERY: unlike Pod Docs (whose DocsStore discovers its container
// internally), pod-health's data layer reads a single record DOCUMENT URL handed
// to it (a plain GET, no container listing). So the host derives that document
// URL after login via Type-Index discovery (`discoverHealthResource` — locate
// health:HealthRecord), falling back to the conventional
// `${podRoot}health/record.ttl` DOCUMENT (NOT the `health/` container) and
// surfacing a banner when it does.

import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
// SOLID-ELEMENTS (#115 / D-parity rollout #67/#68/#70): the framework-agnostic W3C
// Web Components consumed through the @lit/react adapter. <Loading> is a Lit custom
// element (spinner + polite-live label, prefers-reduced-motion aware) wrapped by
// @lit/react's createComponent. It themes itself from the SAME app-shell OKLCH
// tokens as the rest of the chrome: its shadow-DOM styles read `--jeswr-*`, which
// fall back through the shadow boundary to app-shell's `--primary` / `--border` /
// `--muted-foreground` (set by styles.css and flipped by the `.dark` class), so it
// follows light/dark for free with no extra wiring. (COMPLEMENTS app-shell — it does
// not replace the React chrome components above.) Plain Vite/CSR React has no SSR
// step, so the client-only custom elements need no mount-gating here.
import { Loading } from "@jeswr/solid-elements/react";
import { HealthRecords } from "pod-health/ui";
import { useEffect, useState } from "react";
import { APP_NAME } from "./auth/pod-auth";
import { discoverHealthResource, type HealthResource } from "./health-resource";

export function App() {
  const { session, fetch, logout } = useSession();
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
    discoverHealthResource(session.webId, session.podRoot, fetch)
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
  }, [session, fetch]);

  return (
    <SessionGate
      appName={APP_NAME}
      login={<AppLoginScreen />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ webId, session }) => (
        <div className="app-shell">
          {/* The header uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountControl/> (account menu or extension-aware sign-out). The
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
            <span className="app-brand">{APP_NAME}</span>
            <div className="app-header-actions">
              <FeedbackButton
                repo="jeswr/pod-health"
                appName={APP_NAME}
                appVersion={__APP_VERSION__}
                webId={webId}
              />
              <ThemeToggle />
              <AccountControl
                webId={webId}
                displayName={session.displayName}
                avatarUrl={session.avatarUrl}
                onSignOut={logout}
              />
            </div>
          </header>
          {session.podRootIsFallback ? (
            <p className="app-note" role="note">
              Your profile doesn't list a storage address, so Health can only show public records at{" "}
              {session.podRoot}.
            </p>
          ) : null}
          {resource?.isFallback ? (
            <p className="app-note" role="note">
              No <code>health:HealthRecord</code> registration was found in your Type Index; reading
              the conventional <code>{resource.resourceUrl}</code> path instead.
            </p>
          ) : null}
          <main className="app-main">
            {resource ? (
              <HealthRecords
                key={JSON.stringify([session.webId, resource.resourceUrl])}
                resourceUrl={resource.resourceUrl}
                title="Your health records"
                fetch={fetch}
              />
            ) : (
              // SOLID-ELEMENTS: the host-level "finding your health records" wait, now
              // the themed <jeswr-loading> spinner (via @lit/react) instead of a bare
              // <p>. It owns role="status" + aria-live; .app-loading keeps the
              // muted-colour wrapper for layout parity (its redundant role="status" is
              // dropped so the page has a single live region).
              <p className="app-loading">
                <Loading label="Finding your health records…" />
              </p>
            )}
          </main>
        </div>
      )}
    </SessionGate>
  );
}

function AppLoginScreen() {
  return (
    <LoginScreen
      appName={APP_NAME}
      knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
      homeIdp={import.meta.env.VITE_HOME_IDP}
      homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
      dev={import.meta.env.DEV}
    />
  );
}
