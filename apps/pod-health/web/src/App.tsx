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

import { EnvLoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AppFrame, AppMain, useSessionResource } from "@jeswr/app-shell";
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
import { APP_NAME } from "./auth/pod-auth";
import { discoverHealthResource, type HealthResource } from "./health-resource";

export function App() {
  const { session, fetch, logout } = useSession();

  // The discovered health resource (Type Index → else conventional fallback), resolved once a
  // session exists. discoverHealthResource never rejects, but the fallback degrades to the
  // conventional record DOCUMENT (`${podRoot}health/record.ttl`, NOT the `health/` container;
  // the data layer reads a single document) rather than stranding the view with no resource.
  const resource: HealthResource | null = useSessionResource(
    session,
    (s) => discoverHealthResource(s.webId, s.podRoot, fetch),
    (s) => ({ resourceUrl: `${s.podRoot}health/record.ttl`, isFallback: true }),
    [fetch],
  );

  return (
    <SessionGate
      appName={APP_NAME}
      login={<EnvLoginScreen appName={APP_NAME} env={import.meta.env} />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ session }) => (
        <AppFrame
          appName={APP_NAME}
          feedback={{ repo: "jeswr/pod-health", appVersion: __APP_VERSION__ }}
          session={session}
          onSignOut={logout}
          storageNote={{ product: "Health", kind: "records" }}
        >
          <AppMain
            value={resource}
            loading={<Loading label="Finding your health records…" />}
            notice={<FallbackNote resource={resource} />}
          >
            {(resource) => <HealthView webId={session.webId} resource={resource} fetch={fetch} />}
          </AppMain>
        </AppFrame>
      )}
    </SessionGate>
  );
}

function FallbackNote({ resource }: { resource: HealthResource | null }) {
  return resource?.isFallback ? (
    <p className="app-note" role="note">
      No <code>health:HealthRecord</code> registration was found in your Type Index; reading the
      conventional <code>{resource.resourceUrl}</code> path instead.
    </p>
  ) : null;
}

function HealthView({
  webId,
  resource,
  fetch,
}: {
  webId: string;
  resource: HealthResource;
  fetch: typeof globalThis.fetch;
}) {
  return (
    <HealthRecords
      key={JSON.stringify([webId, resource.resourceUrl])}
      resourceUrl={resource.resourceUrl}
      title="Your health records"
      fetch={fetch}
    />
  );
}
