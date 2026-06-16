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
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Inbox } from "@jeswr/pod-mail/ui";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";
import { type DiscoveredMailbox, discoverMailbox } from "./mailbox-discovery";

export function App() {
  const { webId, session, logout } = useSession();
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
        // Discovery failed entirely (e.g. the profile became unreadable). Fall
        // back to the conventional inbox document so the user is not stranded.
        setDiscoveryError(e instanceof Error ? e.message : String(e));
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
        <span className="app-brand">Pod Mail</span>
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
      {mailbox?.isFallback ? (
        <p className="app-note" role="note">
          No <code>schema:EmailMessage</code> entry was found in your Type Index; reading the
          conventional inbox location (<code>{mailbox.mailboxUrl}</code>).
        </p>
      ) : null}
      {discoveryError ? (
        <p className="app-note app-note-error" role="alert">
          Could not locate your mailbox ({discoveryError}).
        </p>
      ) : null}
      <main className="app-main">
        {mailbox ? (
          // mailboxUrl only — no fetch prop: the global fetch is auth-patched, so
          // the Inbox's data layer reads carry the DPoP token automatically.
          <Inbox mailboxUrl={mailbox.mailboxUrl} title="Your inbox" />
        ) : discoveryError ? null : (
          <p className="app-loading" role="status">
            Locating your mailbox…
          </p>
        )}
      </main>
    </div>
  );
}
