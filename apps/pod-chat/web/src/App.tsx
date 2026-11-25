// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a @jeswr/app-shell header (FeedbackButton + ThemeToggle + AccountControl) over
// the LOCAL @jeswr/pod-chat <ChatRooms> pointed at the user's pod. The view
// receives pod-auth's bounded `auth.fetch` explicitly for all pod reads and writes.
import { EnvLoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AppFrame } from "@jeswr/app-shell";
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
      login={<EnvLoginScreen appName="Pod Chat" env={import.meta.env} />}
      renderLoading={(label) => <jeswr-loading label={label} />}
    >
      {({ session }) => (
        <AppFrame
          appName="Pod Chat"
          feedback={{ repo: "jeswr/pod-chat", appVersion: __APP_VERSION__ }}
          session={session}
          onSignOut={logout}
          storageNote={{ product: "Chat", kind: "rooms" }}
        >
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
        </AppFrame>
      )}
    </SessionGate>
  );
}
