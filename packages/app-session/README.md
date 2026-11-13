<!-- AUTHORED-BY GPT-6.1 Sol -->
# @jeswr/app-session

Shared browser sign-in wiring extracted from Pod Docs and Pod Drive. Private and experimental;
security-critical because it configures client identity, development loopback policy and legacy
credential cleanup. No mirror repository is configured.

| Entry | Exports |
| --- | --- |
| `@jeswr/app-session` | `createAppPodAuth`, `publicFetch`, `isLoopbackHost`, `allowInsecureLoopback`, `appUrl`, `authFlowHolder`, `lazyElementGetCode`, `getCodeThroughHolder`, `AUTH_FLOW_ELEMENT`, `IssuerChoiceRequiredError`, `readProfile`, `deriveSession`, `signInError`, `consumeAutologinAccount`, `clearLegacyCredentials`; associated option, profile, session and legacy-key types |
| `@jeswr/app-session/react` | `SessionProvider`, `useSession`, `SessionGate`, `LoginScreen`, `signInProviders`, `issuerChoiceProviders`, `LOOKUP_TIMEOUT_MS`; associated props (including `SessionGateProps`) and `SessionContextValue` |
| `@jeswr/app-session/testing` | Vitest-only `fakePodAuth`, `deferred` and public identity fixtures (`identity`, `WEB_ID`, `ISSUER`, `POD_ROOT`) |

Create the getter once at the application boundary. The package reads no bundler environment
variables; pass the app's base URL, client ID, development flag and provider settings explicitly.
React is an optional peer used by `/react`; `/testing` requires the consumer's Vitest environment.

```tsx
import { createAppPodAuth } from '@jeswr/app-session';
import { SessionProvider, SessionGate, LoginScreen } from '@jeswr/app-session/react';

// Module scope: one getter for the page lifetime. Defaults to <base>clientid.jsonld and
// <base>callback.html on the current origin, resolved on first use.
const getPodAuth = createAppPodAuth({ base: import.meta.env.BASE_URL, dev: import.meta.env.DEV });

export function SignIn() {
  return (
    <SessionProvider getPodAuth={getPodAuth} appName="Example" dev={false}
      legacyCredentials={{ sessionStorage: ['example:old-flow'] }}>
      <SessionGate appName="Example" login={
        <LoginScreen appName="Example" homeIdp="https://provider.example/"
          homeIdpName="Home provider" knownProviders="https://provider.example/" />
      }>
        <main>Signed-in application</main>
      </SessionGate>
    </SessionProvider>
  );
}
```

`createAppPodAuth` returns a lazy, single-flight getter with retry after initialization failure.
It registers the authorization element lazily and reads the current holder at login time, including
under StrictMode. Dynamic registration and insecure HTTP require both `dev: true` and a loopback
page hostname. Production client IDs are validated by pod-auth as HTTPS Client Identifier Document
URLs; a missing client ID (and no `base` to derive one) outside development loopback rejects.
Explicit `clientId`/`redirectUri` override the `base` defaults. Optional `chooseIssuer`,
`boundary`, `storage` and `maxReplayBodyBytes` are forwarded to pod-auth.

Create the getter once at module scope and pass the same function on every render:
`SessionProvider` restarts its startup (restore) whenever `getPodAuth` changes identity, which
also aborts any pending login.

`SessionProvider` accepts an optional `auth` for tests, `lookupTimeoutMs` (default 15 seconds),
and a `readProfile` seam. Pass `dev` to enable development HTTP address/deep-link handling.
`useSession` preserves the apps' context contract, including fetch, restore, startup retry,
recent accounts/providers and explicit issuer choice. Login attempts receive abort signals;
unmount and logout abort pending work. Cancellation does not call logout.

Behaviour change against the Docs/Drive copies this package replaced: a login still in flight
when the provider unmounts or the user signs out is now aborted through `login(hint, { signal })`,
so pod-auth discards any grant it obtained; before, such a late login could still persist a
session. Both cases are pinned in tests.

`LoginScreen` accepts `appName`, `knownProviders` (comma-separated addresses), `homeIdp`,
`homeIdpName` and `dev`. Its default home is `https://idp.solid-test.jeswr.org`; remaining providers
come from pod-auth's directory. The sign-in card stylesheet is imported by the React entry.
The fieldset reset is inline, so hosts need no `.login-sign-in` rule. Host applications retain
their layout CSS and signed-in views and load suite-ui's tokens, theme, density and components
styles for the card.

`SessionGate` reads `useSession` inside `SessionProvider`. Its required props are `appName`
(loading heading), `login` (the app's configured sign-in node) and `children` (signed-in content).
It mounts children only when both `webId` and `session` exist. Otherwise it shows a loading card
while restoring, while startup is neither ready nor failed, or while an identity awaits its profile;
once signed out and settled it renders `login`. The labels are “Restoring your session…” and
“Loading your account…”. Optional `renderLoading(label)` replaces the default `role="status"`
text (for example, with a spinner); provide an accessible status in that renderer. Loading keeps
the host hooks `main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub`.

Public profile reads use the captured pristine fetch with cookies omitted. Only pod-auth establishes
identity and credential grants. Session derivation retains the existing behavior: first advertised
`pim:storage`, otherwise the WebID origin for public browsing, with a trailing slash. This fallback
never widens pod-auth's credential boundary. Autologin fragments become account suggestions only.
Legacy keys are removed independently from IndexedDB, localStorage and sessionStorage, even when
one store or key is unavailable.

Build dependencies first, then run `pnpm --filter @jeswr/app-session build`, `typecheck`, `lint`
and `test`. Tests run in jsdom with per-file 100% lines, branches, functions and statements for `src/`.
