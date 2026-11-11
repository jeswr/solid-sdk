<!-- AUTHORED-BY GPT-6.1 Sol -->
# @jeswr/app-session

Shared browser sign-in wiring extracted from Pod Docs and Pod Drive. Private and experimental;
security-critical because it configures client identity, development loopback policy and legacy
credential cleanup. No mirror repository is configured.

| Entry | Exports |
| --- | --- |
| `@jeswr/app-session` | `createAppPodAuth`, `publicFetch`, `isLoopbackHost`, `allowInsecureLoopback`, `appUrl`, `authFlowHolder`, `lazyElementGetCode`, `getCodeThroughHolder`, `AUTH_FLOW_ELEMENT`, `IssuerChoiceRequiredError`, `readProfile`, `deriveSession`, `signInError`, `consumeAutologinAccount`, `clearLegacyCredentials`; associated option, profile, session and legacy-key types |
| `@jeswr/app-session/react` | `SessionProvider`, `useSession`, `LoginScreen`, `signInProviders`, `issuerChoiceProviders`, `LOOKUP_TIMEOUT_MS`; associated props and `SessionContextValue` |
| `@jeswr/app-session/testing` | Vitest-only `fakePodAuth`, `deferred` and public identity fixtures (`identity`, `WEB_ID`, `ISSUER`, `POD_ROOT`) |

Create the getter once at the application boundary. The package reads no bundler environment
variables; pass the app's base URL, client ID, development flag and provider settings explicitly.
React is an optional peer used by `/react`; `/testing` requires the consumer's Vitest environment.

```tsx
import { appUrl, createAppPodAuth } from '@jeswr/app-session';
import { SessionProvider, LoginScreen } from '@jeswr/app-session/react';

const getPodAuth = createAppPodAuth({
  clientId: 'https://app.example/clientid.jsonld',
  redirectUri: appUrl('callback.html', '/', 'https://app.example'),
  dev: false,
});

export function SignIn() {
  return (
    <SessionProvider getPodAuth={getPodAuth} appName="Example" dev={false}
      legacyCredentials={{ sessionStorage: ['example:old-flow'] }}>
      <LoginScreen appName="Example" homeIdp="https://provider.example/"
        homeIdpName="Home provider" knownProviders="https://provider.example/" />
    </SessionProvider>
  );
}
```

`createAppPodAuth` returns a lazy, single-flight getter with retry after initialization failure.
It registers the authorization element lazily and reads the current holder at login time, including
under StrictMode. Dynamic registration and insecure HTTP require both `dev: true` and a loopback
page hostname. Production client IDs are validated by pod-auth as HTTPS Client Identifier Document
URLs; an undefined client ID outside development loopback rejects. Optional `chooseIssuer`,
`boundary`, `storage` and `maxReplayBodyBytes` are forwarded to pod-auth.

`SessionProvider` accepts an optional `auth` for tests, `lookupTimeoutMs` (default 15 seconds),
and a `readProfile` seam. Pass `dev` to enable development HTTP address/deep-link handling.
`useSession` preserves the apps' context contract, including fetch, restore, startup retry,
recent accounts/providers and explicit issuer choice. Login attempts receive abort signals;
unmount and logout abort pending work. Cancellation does not call logout.

`LoginScreen` accepts `appName`, `knownProviders` (comma-separated addresses), `homeIdp`,
`homeIdpName` and `dev`. Its default home is `https://idp.solid-test.jeswr.org`; remaining providers
come from pod-auth's directory. The sign-in card stylesheet is imported by the React entry.
Host applications retain their layout CSS and signed-in views.

Public profile reads use the captured pristine fetch with cookies omitted. Only pod-auth establishes
identity and credential grants. Session derivation retains the existing behavior: first advertised
`pim:storage`, otherwise the WebID origin for public browsing, with a trailing slash. This fallback
never widens pod-auth's credential boundary. Autologin fragments become account suggestions only.
Legacy keys are removed independently from IndexedDB, localStorage and sessionStorage, even when
one store or key is unavailable.

Build dependencies first, then run `pnpm --filter @jeswr/app-session build`, `typecheck`, `lint`
and `test`. Tests run in jsdom with per-file 100% lines, branches, functions and statements for `src/`.
