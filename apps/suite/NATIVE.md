<!-- // AUTHORED-BY Codex GPT-6 -->
# Native static export (MOB-P3a)

Run `pnpm --filter @jeswr/app-suite build:native` after building its workspace dependencies.
The build stages source in `.native-stage/` and writes `www/`. Neither directory is committed.
The web build continues to use `src/app`, with on-demand dynamic routes and no native CSP.

Native settings are baked into Next's client code and `www/build-info.json`:

| Setting | Default | Build-info field |
| --- | --- | --- |
| `NEXT_PUBLIC_SUITE_TARGET` | forced to `native` | `target` |
| `NEXT_PUBLIC_APP_BASE_URL` (or `APP_BASE_URL`) | `https://localhost` | `appBaseUrl` |
| `NEXT_PUBLIC_PUBLIC_SUITE_URL` (or `PUBLIC_SUITE_URL`) | `https://solid-suite.vercel.app` | `publicSuiteUrl` |
| `NEXT_PUBLIC_CLIENT_ID_URL` (or `CLIENT_ID_URL`) | public URL + `/.well-known/solid-client-id-mobile.jsonld` | `clientIdUrl` |
| `NEXT_PUBLIC_PUSH_RELAY_URL` (or `PUSH_RELAY_URL`) | absent (push disabled) | `pushRelayUrl` |

The app origin must be `https://localhost` or `capacitor://localhost`. Public and Client ID URLs
must be https. Public bases reject userinfo, queries and fragments, and are canonicalized
without a trailing slash before navigation and Client ID paths are appended.
The optional push relay must be an exact canonical HTTPS origin, with no trailing slash,
path, credentials, query or fragment. It is fixed in the signed native build. No production
relay or provider credentials have been provisioned (MOB-P2f); omit the setting to hide
push controls and avoid loading SuitePush. Web browsers never load the push binding.

With a configured relay, Settings › Notifications enables push separately for each signed-in
Solid account. The app discovers its inbox and joined chat containers (at most sixteen topics
per storage), creates seven-day webhook subscriptions using the account's authenticated fetch,
and retains each actual pod expiry. Labels and screen routes stay on the phone. Launch and
resume renew within two days of expiry; a local notification asks the owner to open the app
one day before the earliest expiry. Settings states: “Notifications pause if you don't open
Solid Suite for a week”. LWS-only authentication remains unavailable pending MOB-P2g.

Relay requests use `podAuth.fetchFor(account, { extraResourceOrigins: [RELAY_ORIGIN] })`;
the registrar never reads tokens. Pod subscription endpoints must share the verified storage
origin and stay in its credential boundary. Native policy explicitly admits the standard
`/.notifications/` service path on verified storage origins; metadata cannot add other paths
or origins. Turning push off
or signing out silences native registrations before bounded pod and relay cleanup. Failed
cleanup retains the local keys and metadata and retries on the next launch with connectivity.
Notification taps resolve their registration to a live account and switch before navigating;
the native `/chat/<ref>` alias maps to the suite's `/chat/r/<ref>`. Unknown or signed-out
registrations open `/notifications`.

Solid container notifications observe direct membership. For chats stored in daily message
files, a new day's file produces a container event; later edits to that existing file may
not produce one. LWS recursive subscriptions retain the server's semantics. Push text is
therefore a hint to reconcile the tray and chat when the app opens, with delivery constrained
by the pod's notification coverage.
`appBaseUrl()` uses the live local scheme in the WebView so both platforms can
consume the same bundle. Shared links use the public URL. The CSP permits executable assets
only under `/_next/static/` at those two local origins and hashes each page's inline scripts.
Inline `<style>` elements are allowed (`style-src 'unsafe-inline'`, no style hashes): Radix's
scroll lock and Sonner insert them at runtime, and the scroll lock's body holds computed
pixel values, so no build-time hash could match. Zod runs jitless (`src/instrumentation-client.ts`)
so its `Function` probe never meets the eval-free script policy.

Staging excludes `src/app/dev/`, the `src/app/.well-known/` route handlers (the deployed suite serves the Client ID Document, E7) and public fixtures. The web session uses the installed Solid
extension's granted pod, falling back to a seeded demo pod. Native staging replaces the web
session with a sign-in placeholder and omits the demo code. Native authentication uses the shell account backend and pod-auth through the native browser handoff. Native `/` opens `/drive/my/`,
and Drive preview interception falls back to `/drive/p/[ref]`. The manifest reports these
adaptations. 

Before anything else renders, the root layout's startup check (MOB-P3 E6) requires a secure
context, `crypto.subtle`, `navigator.locks` and IndexedDB. Without one of them the app shows an
update screen and no provider renders, so no session restore or pod-auth runs. The modules below
the gate still load (their code is in the page payload), so they must not touch the platform at
import time. In Drive, PDFs open in the platform viewer through the `SuiteFiles` plugin
("Open PDF", E5); files over 25 MiB offer the download instead.

`route-manifest.json` has `version: 1`, `routes`, `assets`, and `adaptations`. Each route has a
source `pattern`, typed `segments` (`static` + `value`, `param` + `name`, or `catch-all` + `name`
and `optional`), its placeholder `directory`, and its exported transport `files`. Directories
and exact asset paths are relative to `www/`, without a leading slash. Every dynamic segment
exports `__`; a catch-all exports one `__` directory. Real route values equal to `index.html`,
`index.txt`, or `__next.*.txt` are reserved for transport. Unsupported server features, missing
placeholder HTML and ambiguous routes fail the build.

`route-resolver.mjs` is the JavaScript reference for the native implementations in MOB-P3b.
It consumes the raw percent-encoded path, decodes segments once after validation, chooses a
complete match with static/param/catch-all precedence, and returns `{ path, status }`.
Invalid or unmatched paths return `{ path: "404.html", status: 404 }`. Both native ports must
run `apps/mobile/test/vectors/routes.json`, including the Flight and backtracking cases.

`pnpm --filter @jeswr/app-suite check:native` scans every exported file for fixture markers,
checks every HTML page's inline-script hashes, and reports uncompressed bundle bytes. CI
runs the export and this independent check, failing above 40,000,000 bytes.

`pnpm --filter @jeswr/app-suite test:native-browser` checks startup of `www/`, then builds an
isolated export in `.native-stage/browser/www/` with a fixed in-memory pod session and page-local
navigation controls around the real Drive folder view. The E3 static server uses
`route-resolver.mjs` for HTML, Flight and prefetch files. Playwright proxies only the TCP
transport to that server: the browser sees `https://localhost` and the export's unchanged final
CSP. External requests, CSP violations, browser errors and document reloads fail the run.
Tests cover cold deep links, Link navigation, router.push, prefetch, parameter changes retaining
page state, and back/forward. CI installs Chromium; local runs use an existing installation.
The fixture export never replaces `www/`. The web build also checks its emitted chunks for
native calendar component exports.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Feedback

Native staging excludes all `src/app/api/` route handlers, including feedback POST routes.
The adaptation is recorded in `route-manifest.json`; `check-native.mjs` rejects API artifacts.
`/feedback` calls `NEXT_PUBLIC_PUBLIC_SUITE_URL` (the existing deployed suite base URL),
which must allow the native Origin through `FEEDBACK_ALLOWED_ORIGINS`. When that service
cannot be reached, the guide works locally and Download my feedback preserves JSON,
Markdown and audio together. See [README.md](README.md#pilot-feedback) for server setup.

## Cached pod reads (MOB-P3e)

The bundled app opens without a network. A first launch without a restored account still
needs a connection to sign in. With a usable restored account, previously read cacheable
pod resources survive page reloads and can be read offline from that account's IndexedDB
cache. This replaces the earlier narrower promise of in-memory pod data only. Resources
that have not been read, bodies over 25 MiB, explicit freshness reads and uncachable responses still need the
network; the cache does not restore or bypass authentication.

The native `ShellPodSessionProvider` wraps its existing authenticated fetch with
solid-offline's `createPageCache`, through the SDK offline facade. It shares the worker's
request/response policy, canonical keys, IndexedDB bodies and metadata, notification
invalidation and ETag resync. Reads try the network first online, write successful cacheable
responses through, and label provisional fallback bytes `X-Solid-Offline-Cache: stale`
and `X-Offline: stale`. The shell continues to show its connectivity indicator.
The adapter starts change subscriptions after commit, forwards updates to session
subscribers, and retries initial subscription setup on reconnect.

The live `usable()` account/version fence checks cached and network reads, including
switches React has not committed. Account switches and both sign-out paths immediately
fence the old adapter and purge its database through the existing accounts provider.
Sign-out attempts cleanup even when the identity provider's logout fails. Pending outbox
writes are retained. Reload/unmount closes handles while retaining reads for that account.
The web target keeps its service-worker registration; native never registers or messages it.

Unit tests exercise IndexedDB with fake-indexeddb (already installed), shared policy,
notifications and transition races, plus native/web provider selection. Real iOS/Android
persistence, cold offline launch and bridge authentication remain device/e2e checks.
