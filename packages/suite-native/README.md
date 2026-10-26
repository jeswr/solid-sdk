<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/suite-native

> **Experimental — AI-agent-generated.** Security critical (`securityCritical: true`).

The seams the Solid Suite web app uses when it runs inside the iOS and Android shells
(`apps/mobile`, Capacitor 8). Design of record: `solid-suite-planning/specs/mobile/DESIGN.md`.

| Export | What it does |
|---|---|
| `platform()`, `isNativeApp()` | `"ios" \| "android" \| "web"` from the injected `Capacitor` global; no Capacitor import. |
| `createNativeCodeDriver({ plugin, redirectUri, resolveIssuer })` | pod-auth's `ui.getCode` for the apps: opens the system browser (ASWebAuthenticationSession / Custom Tabs) and returns the authorization code after fail-closed checks on the request (https, PKCE S256, one `state`, our `redirect_uri`) and the callback (exact redirect, matching `state`, one `code`, exactly one RFC 9207 `iss` equal to the resolved issuer, error responses as `AuthorizationError`). |
| `share(content, { native, web })` | Native share sheet, else Web Share, else `ShareUnavailableError`. |
| `createShareInbox(plugin)`, `validateShareBatch()` | Validated `ShareBatch`es from other apps, chunked size-checked file reads, acknowledgement. |
| `mobileClientIdDocument({ origin })` | The `application_type: native` Client Identifier Document for `org.jeswr.suite:/oauth/callback`. |
| `@jeswr/suite-native/capacitor` | Native plugin bindings (`SuiteAuthSession`, `SuiteShareIntake`, `Share`). Import only inside the app shell. |

```ts
import { createNativeCodeDriver, isNativeApp, MOBILE_REDIRECT_URI } from "@jeswr/suite-native";
import { authSessionPlugin } from "@jeswr/suite-native/capacitor";

const getCode = createNativeCodeDriver({
  plugin: authSessionPlugin,
  redirectUri: MOBILE_REDIRECT_URI,
  // The issuer identifier pod-auth discovered for this authorization URL.
  resolveIssuer: (url) => issuer,
});
// createPodAuth({ clientId: `${origin}/.well-known/solid-client-id-mobile.jsonld`,
//                 redirectUri: MOBILE_REDIRECT_URI, ui: { getWebId, getCode } })
```

Private at 0.1.0. From the workspace root:

```sh
pnpm --filter @jeswr/suite-native run lint
pnpm --filter @jeswr/suite-native run build
pnpm --filter @jeswr/suite-native run typecheck
pnpm --filter @jeswr/suite-native run test   # 100% coverage thresholds
```
