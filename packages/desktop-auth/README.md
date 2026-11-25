<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# @jeswr/desktop-auth

> **Experimental — AI-agent-generated.** Security critical (`securityCritical: true`).

Solid-OIDC sign-in for desktop apps (Tauri, Electron): the provider's page opens in the user's own
browser and comes back to the app through a private-use URL scheme (RFC 8252). It plugs into
`@jeswr/pod-auth` as `ui.getCode`, and builds the `application_type: native` Client Identifier
Document the providers need.

| Export | What it does |
|---|---|
| `createDesktopCodeDriver({ host, redirectUri, timeoutMs?, onIgnored? })` | pod-auth's `ui.getCode`. Runs every request and callback check of suite-native's `createNativeCodeDriver` (callback mode) over a desktop session. A timeout or host failure rejects with `DesktopAuthError`. |
| `createDesktopAuthSession({ host, timeoutMs?, onIgnored? })` | suite-native's `AuthSessionPlugin` for desktops: listens for deep links, opens the browser (only an `https:` URL without credentials), resolves with the first callback on our redirect carrying our `state`, ignores every other URL, times out (default 10 minutes), and supports `cancel()`. `onIgnored(reason)` is told why a URL was ignored (`too-long`, `not-a-url`, `wrong-redirect`, `wrong-state`, `not-a-string`), never the URL. |
| `desktopClientIdDocument({ clientId, clientName, clientUri, redirectUri, logoUri? })` | The Client Identifier Document to serve at `clientId` as `application/ld+json`. Built through suite-native's `nativeClientIdDocument`. Refuses, rather than rewrites, any input that is not in normal form; refuses control and bidi characters in the name, and a `localhost` or IP-literal `clientId`. |
| `DesktopAuthError` | Extends suite-native's `SuiteNativeError`. `code` is `timed-out` (no callback in time) or `host-failed` (the shell could not listen or open the browser, or the request was unusable). The message is the code; nothing from the host is carried. Cancelling is still suite-native's `UserCancelledError`, and an abort the `AbortError`. |
| `TIMED_OUT`, `HOST_FAILED`, `MAX_CALLBACK_LENGTH` | Session error codes (seen only by callers of `createDesktopAuthSession`) and the 8 KiB callback cap. |

`host` is two functions the shell supplies: `openUrl(url)` and
`onOpenUrl(listener) → Promise<unlisten>`. In Tauri 2 these are `openUrl` from
`@tauri-apps/plugin-opener` and `onOpenUrl` from `@tauri-apps/plugin-deep-link`, passed unchanged,
so this package has no Tauri dependency.

```ts
import { openUrl } from "@tauri-apps/plugin-opener";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { createDesktopCodeDriver } from "@jeswr/desktop-auth";
import { createPodAuth } from "@jeswr/pod-auth";

const redirectUri = "ai.artcraft.app:/oauth/callback";
const auth = createPodAuth({
  clientId: "https://example.github.io/artcraft/solid-client-id.jsonld",
  redirectUri,
  nativeRedirect: true,
  ui: { getWebId, getCode: createDesktopCodeDriver({ host: { openUrl, onOpenUrl }, redirectUri }) },
});
```

## Shell setup (Tauri 2)

- Register the scheme with `tauri-plugin-deep-link` (`plugins.deep-link.desktop.schemes`).
- On Windows and Linux a deep link starts a second process. Add `tauri-plugin-single-instance`
  with its `deep-link` feature so the running app receives the URL through `onOpenUrl`.
- Allow `opener:allow-open-url` for `https://*` and the deep-link listen permission.
- A sign-in does not survive an app restart. A callback that launches a fresh process is ignored.
  At start-up the app may check `getCurrent()` only to show "that sign-in expired, start again".
  It must never parse the code.
- Without the single-instance plugin on Windows and Linux, the callback opens a second window and
  the first one waits until the timeout.
- The listener may be called with an old URL before `onOpenUrl` resolves. That is why URLs that
  do not match are ignored.
- Give the user a cancel control wired to `auth.login(hint, { signal })`. pod-auth rejects a
  login with a different hint while one is pending, and the default wait is ten minutes.
- Let the webview reach pods directly (`connect-src https:`). Do not send pod traffic through
  `@tauri-apps/plugin-http`: that moves tokens and DPoP proofs into Rust.

## Security

- Tokens, PKCE verifiers and DPoP keys never reach the shell. It sees only the authorization URL
  and the callback URL; pod-auth keeps refresh tokens and non-extractable keys in IndexedDB.
- Any app or web page can open a URL on the scheme. A URL that is not on our redirect path or
  lacks our exact `state` is ignored, so it cannot end a sign-in in progress; a matching URL still
  passes the driver's checks and pod-auth's RFC 9207 issuer check, and the code is useless
  without the PKCE verifier and DPoP key.
- Another app that registers the same scheme could receive the callback (RFC 8252 §8.1). PKCE and
  DPoP-bound tokens make an intercepted code worthless; this is the accepted native-app residual
  risk.
- The app cannot close the browser tab. `cancel()` and the timeout stop the app waiting; a late
  callback is then ignored.
- Anyone who knows `state` can end the sign-in. It is in the authorization URL, which the shell,
  the browser, its extensions and, on Linux, other processes of the same user can read. Such a
  party can fail the sign-in with an error callback, or send its own code, which PKCE rejects at
  the token endpoint. This is denial of service only.
