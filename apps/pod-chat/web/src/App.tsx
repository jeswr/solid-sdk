// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a @jeswr/app-shell header (FeedbackButton + ThemeToggle + AccountControl) over
// the LOCAL @jeswr/pod-chat <ChatRooms> pointed at the user's pod. The view
// receives pod-auth's bounded `auth.fetch` explicitly for all pod reads and writes.
import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { ChatRooms } from "@jeswr/pod-chat/ui";
// SOLID-ELEMENTS (#67/#68/#70 D-parity rollout): the framework-agnostic W3C Web
// Component <jeswr-loading> — a Lit custom element (spinner + polite-live label,
// prefers-reduced-motion aware). We import the package BARE entry for its
// registration side-effect (`customElements.define("jeswr-loading", …)`), then render
// the element DIRECTLY with `label` as a DOM ATTRIBUTE (typed in custom-elements.d.ts).
//
// WHY the raw element, not the @lit/react `Loading` wrapper: the wrapper forwards
// `label` as a PROPERTY, and @lit/react classifies props at createComponent-time —
// before Lit finalises the element class — so under React 19 the `label` property can
// silently fail to land, dropping the VISIBLE + ANNOUNCED status copy (verified: the
// wrapper renders no label text and the aria-label falls back to "Loading"). The Lit
// reactive `label` property auto-observes the lowercased `label` ATTRIBUTE, and the
// attribute path is environment-independent + verified — so it reliably shows AND
// announces the message. (Upstream follow-up: make the wrapper reflect `label`.)
//
// The element themes itself from the SAME app-shell OKLCH tokens as the rest of the
// chrome: its shadow-DOM styles read `--jeswr-*`, which fall back through the shadow
// boundary to app-shell's `--primary` / `--border` / `--muted-foreground` (set by
// styles.css, flipped by `.dark`), so it follows light/dark for free. (COMPLEMENTS
// app-shell — it does not replace the React chrome above.) Plain Vite/CSR React has
// no SSR step, so the client-only custom element needs no mount-gating here.
import "@jeswr/solid-elements";

export function App() {
  const { logout, fetch } = useSession();

  return (
    <SessionGate
      appName="Pod Chat"
      login={<AppLoginScreen />}
      renderLoading={(label) => <jeswr-loading label={label} />}
    >
      {({ webId, session }) => (
        <div className="app-shell">
          {/* The header uses the shared @jeswr/app-shell chrome: a header-level
              <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
              THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
              top-right <AccountControl/> (avatar + display name, dropdown showing the WebID
              + Sign out) — replacing the old raw-WebID span + bare logout button. The
              session's WebID / profile name / avatar / logout wire straight into the
              props (the components are fully decoupled — everything is a prop).
              `app-header-actions` right-aligns the trio.

              FEEDBACK: `repo` is the only app-specific value — pod-chat files against
              `jeswr/pod-chat`. `appVersion` is the build SHA injected by Vite
              (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
              attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
              is intentionally UNSET → the dialog uses the GitHub prefill page; the
              feedback-proxy hook is wired suite-wide later. */}
          <header className="app-header">
            <span className="app-brand">Pod Chat</span>
            <div className="app-header-actions">
              <FeedbackButton
                repo="jeswr/pod-chat"
                appName="Pod Chat"
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
              Your profile doesn't list a storage address, so Chat can only show public rooms at{" "}
              {session.podRoot}.
            </p>
          ) : null}
          <main className="app-main">
            {/* podRoot + webId only — ChatStore derives the pod-chat/rooms/ +
                pod-chat/messages/ containers from the pod root (and registers them in
                the user's Type Index for cross-app discovery). Pod reads and writes use
                the session's bounded fetch. */}
            <ChatRooms
              key={JSON.stringify([session.webId, session.podRoot])}
              podRoot={session.podRoot}
              webId={session.webId}
              fetch={fetch}
              title="Your chat"
            />
          </main>
        </div>
      )}
    </SessionGate>
  );
}

function AppLoginScreen() {
  return (
    <LoginScreen
      appName="Pod Chat"
      knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
      homeIdp={import.meta.env.VITE_HOME_IDP}
      homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
      dev={import.meta.env.DEV}
    />
  );
}
