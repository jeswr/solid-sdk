// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-mail <Inbox> pointed
// at the user's inbox mailbox document. The component receives NO `fetch` prop —
// it uses the ambient global fetch, which the SessionProvider patched via
// reactive-auth's registerGlobally(), so every read carries the DPoP token.
//
// MAILBOX DERIVATION: <Inbox mailboxUrl /> needs a mailbox DOCUMENT URL, not a
// bare pod root. We discover it from the user's Type Index
// (schema:EmailMessage registration → mail container → inbox doc), falling back
// to the conventional `<podRoot>mail/folders/inbox.ttl` with a banner. The
// discovery reads the profile dataset (fetched here once via the auth-patched
// global fetch) and the data layer's typed Type-Index reader — see
// mailbox-discovery.ts.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Inbox } from "@jeswr/pod-mail/ui";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";
import { conventionalMailbox, type DiscoveredMailbox, discoverMailbox } from "./mailbox-discovery";

export function App() {
  const { webId, session, logout, autologinPending, restoring } = useSession();
  const [mailbox, setMailbox] = useState<DiscoveredMailbox | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // Discover the inbox mailbox document once a session exists. Re-runs if the
  // session changes (a re-login as a different WebID). A stale-guard prevents a
  // slow earlier discovery from overwriting a newer one.
  useEffect(() => {
    if (!session) {
      setMailbox(null);
      setDiscoveryError(null);
      return;
    }
    let cancelled = false;
    setMailbox(null);
    setDiscoveryError(null);
    (async () => {
      // Read the (now-authenticated) profile dataset via the auth-patched global
      // fetch — the same source the Type-Index pointer is read from.
      const { dataset } = await fetchRdf(session.webId);
      const discovered = await discoverMailbox(session.webId, session.podRoot, dataset);
      if (!cancelled) setMailbox(discovered);
    })().catch((e: unknown) => {
      if (!cancelled) {
        // Discovery failed entirely (e.g. the profile re-fetch threw before
        // discoverMailbox could apply its own fallback). Fall back to the
        // conventional inbox document AND surface the warning, so the user is
        // never stranded without an <Inbox> to render.
        setMailbox(conventionalMailbox(session.podRoot));
        setDiscoveryError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!webId || !session) {
    // Autologin (a Pod-Manager deep-link or a redirect return) is silently signing
    // the user in via a full-page redirect — show a brief restoring state rather than
    // the interactive login form, since there is no gesture to prompt for.
    //
    // SILENT SESSION RESTORE: a returning user who only closed the tab is being
    // restored from their persisted DPoP-bound refresh token (a refresh-grant fetch,
    // no popup/redirect). Same brief restoring state — never flash the login form
    // before the restore resolves; fall back to login only on genuine failure.
    if (autologinPending || restoring) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Mail</h1>
            <p className="login-sub" role="status">
              {autologinPending ? "Signing you in…" : "Restoring…"}
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      {/* The header now uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountMenu/> (avatar + display name, dropdown showing the WebID
          + Sign out) — replacing the old raw-WebID span + bare logout button. The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-mail files against
          `jeswr/pod-mail`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Mail</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo="jeswr/pod-mail"
            appName="Pod Mail"
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
      {/* A plain fallback note only when discovery SUCCEEDED but found no
          Type-Index entry. When discovery threw, the error alert below already
          explains the conventional-location fallback, so we don't double up. */}
      {mailbox?.isFallback && !discoveryError ? (
        <p className="app-note" role="note">
          No <code>schema:EmailMessage</code> entry was found in your Type Index; reading the
          conventional inbox location (<code>{mailbox.mailboxUrl}</code>).
        </p>
      ) : null}
      {discoveryError ? (
        <p className="app-note app-note-error" role="alert">
          Could not look up your mailbox ({discoveryError}); reading the conventional inbox location
          {mailbox ? (
            <>
              {" "}
              (<code>{mailbox.mailboxUrl}</code>)
            </>
          ) : null}
          .
        </p>
      ) : null}
      <main className="app-main">
        {mailbox ? (
          // mailboxUrl only — no fetch prop: the global fetch is auth-patched, so
          // the Inbox's data layer reads carry the DPoP token automatically. On a
          // discovery error we still set `mailbox` to the conventional fallback,
          // so an authenticated user always gets an <Inbox> (never stranded).
          <Inbox mailboxUrl={mailbox.mailboxUrl} title="Your inbox" />
        ) : (
          <p className="app-loading" role="status">
            Locating your mailbox…
          </p>
        )}
      </main>
    </div>
  );
}
