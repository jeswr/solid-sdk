<!-- AUTHORED-BY Codex GPT-6 -->
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

The app origin must be `https://localhost` or `capacitor://localhost`. Public and Client ID URLs
must be https. Public bases reject userinfo, queries and fragments, and are canonicalized
without a trailing slash before navigation and Client ID paths are appended.
`appBaseUrl()` uses the live local scheme in the WebView so both platforms can
consume the same bundle. Shared links use the public URL. The CSP permits executable assets
only under `/_next/static/` at those two local origins and hashes each page's inline scripts.
Inline `<style>` elements are allowed (`style-src 'unsafe-inline'`, no style hashes): Radix's
scroll lock and Sonner insert them at runtime, and the scroll lock's body holds computed
pixel values, so no build-time hash could match. Zod runs jitless (`src/instrumentation-client.ts`)
so its `Function` probe never meets the eval-free script policy.

Staging excludes `src/app/dev/` and public fixtures. The web session uses the installed Solid
extension's granted pod, falling back to a seeded demo pod. Native staging replaces the web
session with a sign-in placeholder and omits the demo code. Native authentication is a later
integration. Native `/` opens `/drive/my/`,
and Drive preview interception falls back to `/drive/p/[ref]`. The manifest reports these
adaptations. The native PDF handoff belongs to MOB-P3b.

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
