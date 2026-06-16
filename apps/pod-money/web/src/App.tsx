// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL pod-money <AccountsView> pointed
// at the user's finance ledger. AccountsView receives NO `fetch` prop — it uses
// the ambient global fetch, which the SessionProvider patched via reactive-auth's
// registerGlobally(), so every read carries the DPoP token automatically.
//
// LEDGER DISCOVERY: unlike pod-docs's <DocumentBrowser>, pod-money's <AccountsView>
// takes the ledger FILE URL directly (not a pod root). The host therefore discovers
// the ledger from the pod root via the user's public Type Index (pod-money's
// `MoneyStore.discover(MoneyStore.primaryClass)` → fin:Transaction registration),
// falling back to the conventional `${podRoot}finance/ledger.ttl` path when the
// index (or the registration) is absent. The discovery runs through the same
// auth-patched global fetch, so it carries the session token. See useLedgerUrl.
import { MoneyStore } from "@jeswr/pod-money";
import { AccountsView } from "@jeswr/pod-money/ui";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";

/** How the ledger URL was resolved — drives the fallback banner. */
type LedgerSource = "discovering" | "type-index" | "fallback";

interface LedgerResolution {
  /** The finance ledger FILE URL to hand to <AccountsView ledgerUrl>. */
  ledgerUrl: string | null;
  /** Where the URL came from (`discovering` until resolved). */
  source: LedgerSource;
}

/**
 * Resolve the finance ledger FILE URL for a pod root.
 *
 *   1. Type Index: `MoneyStore.discover(MoneyStore.primaryClass)` returns the
 *      registered location(s) for fin:Transaction. A registration may point at a
 *      single `instance` (the ledger file itself) or a `container` (the finance
 *      container, in which the ledger is the conventional `ledger.ttl`). The first
 *      registration that yields a usable URL wins.
 *   2. Fallback: the conventional `${podRoot}finance/ledger.ttl` (= the store's own
 *      `ledgerUrl`), surfaced to the user via the banner (source === "fallback").
 *
 * Discovery is a HINT, not a grant — <AccountsView> still GETs the resource (a 404
 * renders as an empty ledger; a 401/403 as an access error). The discovery read
 * uses the ambient auth-patched global fetch, so it carries the session token.
 * Re-resolves whenever the pod root changes; an in-flight resolution is fenced so a
 * slow earlier discovery can never overwrite a newer pod root's result.
 */
function useLedgerUrl(podRoot: string): LedgerResolution {
  const [resolution, setResolution] = useState<LedgerResolution>({
    ledgerUrl: null,
    source: "discovering",
  });

  useEffect(() => {
    let cancelled = false;
    setResolution({ ledgerUrl: null, source: "discovering" });
    // No `fetch` option: the global fetch is auth-patched, so discovery carries the
    // session token (the public type index is readable, but a private one needs it).
    const store = new MoneyStore({ podRoot });
    const conventional = store.ledgerUrl;

    (async () => {
      try {
        const locations = await store.discover(MoneyStore.primaryClass);
        if (cancelled) return;
        const discovered = pickLedgerUrl(locations);
        if (discovered) {
          setResolution({ ledgerUrl: discovered, source: "type-index" });
          return;
        }
      } catch {
        // A missing / unreadable type index is not an error — fall back below.
        if (cancelled) return;
      }
      if (!cancelled) setResolution({ ledgerUrl: conventional, source: "fallback" });
    })();

    return () => {
      cancelled = true;
    };
  }, [podRoot]);

  return resolution;
}

/**
 * Choose the ledger FILE URL from a class's Type-Index registrations. A
 * registration's `instance` is the ledger file directly; a `container` is the
 * finance container, in which the ledger is the conventional `ledger.ttl`. The
 * first registration that yields a usable URL wins; returns null when none do.
 */
function pickLedgerUrl(locations: { instance?: string; container?: string }[]): string | null {
  for (const loc of locations) {
    if (loc.instance) return loc.instance;
    if (loc.container) {
      // `new URL("ledger.ttl", container)` resolves the file within the container,
      // whether or not the container URL ends in a slash (it should).
      try {
        return new URL("ledger.ttl", loc.container).toString();
      } catch {
        // A malformed container URL is skipped; try the next registration.
      }
    }
  }
  return null;
}

export function App() {
  const { webId, session, logout, autologinPending } = useSession();

  if (!webId || !session) {
    // Autologin (a Pod-Manager deep-link or a redirect return) is silently signing
    // the user in via a full-page redirect — show a brief restoring state rather than
    // the interactive login form, since there is no gesture to prompt for.
    if (autologinPending) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Money</h1>
            <p className="login-sub" role="status">
              Signing you in…
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <LoggedIn
      podRoot={session.podRoot}
      podRootIsFallback={session.podRootIsFallback}
      webId={webId}
      onLogout={logout}
    />
  );
}

/**
 * The logged-in view. Split into its own component so the `useLedgerUrl` hook (and
 * its discovery effect) only mount once a session exists — hooks cannot be called
 * conditionally in `App` above.
 */
function LoggedIn({
  podRoot,
  podRootIsFallback,
  webId,
  onLogout,
}: {
  podRoot: string;
  podRootIsFallback: boolean;
  webId: string;
  onLogout: () => void;
}) {
  const { ledgerUrl, source } = useLedgerUrl(podRoot);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">Pod Money</span>
        <span className="app-webid" title={webId}>
          {webId}
        </span>
        <button type="button" className="app-logout" onClick={onLogout}>
          Log out
        </button>
      </header>
      {podRootIsFallback ? (
        <p className="app-note" role="note">
          Your profile advertises no <code>pim:storage</code>; using your WebID origin (
          <code>{podRoot}</code>) as the pod root.
        </p>
      ) : null}
      {source === "fallback" ? (
        <p className="app-note" role="note">
          No finance registration was found in your Type Index; using the conventional location{" "}
          <code>{ledgerUrl}</code>.
        </p>
      ) : null}
      <main className="app-main">
        {source === "discovering" || !ledgerUrl ? (
          <p className="pod-money-loading" role="status">
            Finding your finance ledger…
          </p>
        ) : (
          // ledgerUrl only — AccountsView reads it via the auth-patched global
          // fetch (no fetch prop). 404 → empty ledger; 401/403 → access error.
          <AccountsView ledgerUrl={ledgerUrl} title="Your accounts" />
        )}
      </main>
    </div>
  );
}
