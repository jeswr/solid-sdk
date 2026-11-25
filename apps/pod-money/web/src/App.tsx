// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell: shared sign-in, extension-aware account controls and the
// local AccountsView. Pod-auth's bounded fetch is injected into both finance-ledger
// discovery and the view; global fetch stays public.
import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { MoneyStore } from "@jeswr/pod-money";
import { AccountsView } from "@jeswr/pod-money/ui";
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
import { useEffect, useState } from "react";

/**
 * The app-specific identity for the header <FeedbackButton/>, in ONE place so the
 * header wiring and the adoption test cannot drift: a filed issue must land on
 * THIS app's own repo. Exported so feedback-button.test.tsx asserts the SAME
 * values the header passes (and the generated issue URL targets jeswr/pod-money).
 */
export const FEEDBACK_REPO = "jeswr/pod-money";
export const FEEDBACK_APP_NAME = "Pod Money";

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
 * uses the explicitly supplied bounded auth.fetch.
 * Re-resolves whenever the pod root changes; an in-flight resolution is fenced so a
 * slow earlier discovery can never overwrite a newer pod root's result.
 */
function useLedgerUrl(podRoot: string, fetch: typeof globalThis.fetch): LedgerResolution {
  const [resolution, setResolution] = useState<LedgerResolution>({
    ledgerUrl: null,
    source: "discovering",
  });

  useEffect(() => {
    let cancelled = false;
    setResolution({ ledgerUrl: null, source: "discovering" });
    const store = new MoneyStore({ podRoot, fetch });
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
  }, [podRoot, fetch]);

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
  const { logout, fetch } = useSession();

  return (
    <SessionGate
      appName="Pod Money"
      login={
        <LoginScreen
          appName="Pod Money"
          knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
          homeIdp={import.meta.env.VITE_HOME_IDP}
          homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
          dev={import.meta.env.DEV}
        />
      }
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ webId, session }) => (
        <LoggedIn
          key={JSON.stringify([session.webId, session.podRoot])}
          fetch={fetch}
          podRoot={session.podRoot}
          podRootIsFallback={session.podRootIsFallback}
          webId={webId}
          displayName={session.displayName}
          avatarUrl={session.avatarUrl}
          onLogout={logout}
        />
      )}
    </SessionGate>
  );
}

/**
 * The logged-in view. Split into its own component so the `useLedgerUrl` hook (and
 * its discovery effect) only mount once a session exists — hooks cannot be called
 * conditionally in `App` above.
 */
export function LoggedIn({
  podRoot,
  podRootIsFallback,
  webId,
  displayName,
  avatarUrl,
  onLogout,
  fetch,
}: {
  podRoot: string;
  podRootIsFallback: boolean;
  webId: string;
  displayName?: string;
  avatarUrl?: string;
  onLogout: () => void;
  fetch: typeof globalThis.fetch;
}) {
  const { ledgerUrl, source } = useLedgerUrl(podRoot, fetch);

  return (
    <div className="app-shell">
      {/* The header now uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountControl/> (account menu or extension-aware sign-out). The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-money files against
          `jeswr/pod-money`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Money</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo={FEEDBACK_REPO}
            appName={FEEDBACK_APP_NAME}
            appVersion={__APP_VERSION__}
            webId={webId}
          />
          <ThemeToggle />
          <AccountControl
            webId={webId}
            displayName={displayName}
            avatarUrl={avatarUrl}
            onSignOut={onLogout}
          />
        </div>
      </header>
      {podRootIsFallback ? (
        <p className="app-note" role="note">
          Your profile doesn't list a storage address, so Money can only show public finance data at{" "}
          <code>{podRoot}</code>.
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
          // SOLID-ELEMENTS: the host-level "finding your finance ledger" wait, now
          // the themed <jeswr-loading> spinner (via @lit/react) instead of a bare
          // <p>. It owns role="status" + aria-live; .pod-money-loading keeps the
          // muted-colour wrapper for layout parity.
          <p className="pod-money-loading">
            <Loading label="Finding your finance ledger…" />
          </p>
        ) : (
          <AccountsView ledgerUrl={ledgerUrl} title="Your accounts" fetch={fetch} />
        )}
      </main>
    </div>
  );
}
