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

import { HealthRecords } from "pod-health/ui";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { discoverHealthResource, type HealthResource } from "./health-resource";
import { LoginScreen } from "./LoginScreen";

export function App() {
  const { webId, session, logout } = useSession();
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
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">Pod Health</span>
        <span className="app-webid" title={webId}>
          {webId}
        </span>
        <button type="button" className="app-logout" onClick={logout}>
          Log out
        </button>
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
