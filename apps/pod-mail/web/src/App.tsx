// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — shared sign-in and chrome around the local Inbox. Pod reads receive
// pod-auth's bounded fetch explicitly; global fetch stays public. Mailbox discovery
// uses the Type Index, falling back to mail/folders/inbox.ttl with a visible note.
import { EnvLoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AppFrame, AppMain } from "@jeswr/app-shell";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Inbox } from "@jeswr/pod-mail/ui";
// SOLID-ELEMENTS PILOT (#115): the framework-agnostic W3C Web Components consumed
// through the @lit/react adapter. <Loading> is a Lit custom element (spinner +
// polite-live label, prefers-reduced-motion aware) wrapped by @lit/react's
// createComponent. It themes itself from the SAME app-shell OKLCH tokens as the rest
// of the chrome: its shadow-DOM styles read `--jeswr-*`, which fall back through the
// shadow boundary to app-shell's `--primary` / `--border` / `--muted-foreground`
// (set by styles.css and flipped by the `.dark` class), so it follows light/dark for
// free with no extra wiring. (COMPLEMENTS app-shell — it does not replace the React
// chrome components above.) Plain Vite/CSR React has no SSR step, so the client-only
// custom elements need no mount-gating here.
import { Loading } from "@jeswr/solid-elements/react";
import { useEffect, useState } from "react";
import { conventionalMailbox, type DiscoveredMailbox, discoverMailbox } from "./mailbox-discovery";

export const FEEDBACK_REPO = "jeswr/pod-mail";
export const FEEDBACK_APP_NAME = "Pod Mail";

export function App() {
  const { session, logout, fetch } = useSession();
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
      // Read the profile and Type Index through the session credential boundary.
      const { dataset } = await fetchRdf(session.webId, { fetch });
      const discovered = await discoverMailbox(session.webId, session.podRoot, dataset, fetch);
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
  }, [session, fetch]);

  return (
    <SessionGate
      appName="Pod Mail"
      login={<EnvLoginScreen appName="Pod Mail" env={import.meta.env} />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ session }) => (
        <AppFrame
          appName="Pod Mail"
          feedback={{ repo: FEEDBACK_REPO, appVersion: __APP_VERSION__ }}
          session={session}
          onSignOut={logout}
          storageNote={{ product: "Mail", kind: "messages" }}
        >
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
              Could not look up your mailbox ({discoveryError}); reading the conventional inbox
              location
              {mailbox ? (
                <>
                  {" "}
                  (<code>{mailbox.mailboxUrl}</code>)
                </>
              ) : null}
              .
            </p>
          ) : null}
          <AppMain value={mailbox} loading={<Loading label="Locating your mailbox…" />}>
            {(mailbox) => (
              <Inbox
                key={session.webId}
                mailboxUrl={mailbox.mailboxUrl}
                title="Your inbox"
                fetch={fetch}
              />
            )}
          </AppMain>
        </AppFrame>
      )}
    </SessionGate>
  );
}
