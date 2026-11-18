<!-- AUTHORED-BY GPT-6.1 Sol -->

# Pod Health web host

A static Vite/React host for the local `pod-health/ui` records view. Use Node >=24.5.
Run `pnpm --filter @jeswr/pod-health-web dev` from the workspace root.

### Auth

Pod Health configures `@jeswr/app-session` in `src/auth/pod-auth.ts` and passes its
app name, development flag and exact legacy storage keys to `SessionProvider` in
`src/main.tsx`. The shared package owns the page-lifetime `@jeswr/pod-auth` core and
`@jeswr/suite-ui/sign-in` card, following Pod Docs and Pod Drive. Users can choose
a remembered account, enter a WebID or provider address, choose a listed provider,
or enter a custom provider. A WebID listing several issuers requires an explicit
choice. `VITE_HOME_IDP`, `VITE_HOME_IDP_NAME` and `VITE_KNOWN_PROVIDERS` configure
the provider list.

The core restores once on mount, including StrictMode replay, and owns credentials,
persistence and logout. The host passes bounded `auth.fetch` explicitly to Type
Index discovery and `HealthRecords`; global fetch stays public. Public profile
reads for display metadata use a captured pristine transport with cookies omitted.
Credentials attach only within the authenticated WebID's advertised storage roots.

The popup element is registered lazily from
`@jeswr/reactive-authentication/registerElements`. A StrictMode-safe holder adapts
its disposable result to the complete callback URL, preserving code, state and
issuer. Restore's silent `prompt=none` authorization is declined so it cannot open
a popup without a click. UI errors omit raw protocol details.

Development builds on localhost, 127.0.0.0/8 or ::1 enable loopback HTTP and dynamic
client registration. Other builds use the HTTPS `clientid.jsonld`; an HTTP
production preview cannot sign in. `#autologin/<encoded-webid>` adds a suggested
account row and is removed from the address bar, without starting login.
Only `callback.html` is registered as an OAuth redirect URI.

On first mount the host removes exactly the old `pod-health:pss.autologin.flow`
and `pod-health:autologin-attempted` sessionStorage keys, the credential-free
`pod-health:remembered-account` localStorage pointer, and the dedicated
`pod-health:sessions` IndexedDB database containing refresh tokens and DPoP keys.
Other applications' records and the theme setting are preserved. Old sessions are
not imported; returning users sign in again once.

### Health resource discovery

The first profile `pim:storage` supplies the pod root. Without it the existing WebID
origin fallback remains, with a note explaining that only public records are
accessible there. The host checks Type Index registrations for
`health:HealthRecord`, preferring `solid:instance` over
`solid:instanceContainer` plus `record.ttl`. Missing or unreadable registrations
fall back to `${podRoot}health/record.ttl`, with a note. Discovery never grants
credentials. The FeedbackButton, theme toggle, account menu, and extension-aware
minimal sign-out control remain in the header.

### Static auth artifacts and checks

`build` and `dev` run `scripts/gen-clientid.mjs` inline because dependency lifecycle
scripts are disabled. It writes `public/clientid.jsonld` and `public/callback.html`
from `APP_ORIGIN` (or `VITE_APP_ORIGIN`), optionally with `CLIENT_BASE_PATH` such as
`/solid-sdk/pod-health/`. The committed examples use `http://localhost:5173`.
The callback posts the full URL only to its own origin. Environment precedence
and the single registered callback are covered by the generator tests.

The host tests cover the adapter's deployment URLs, exact legacy cleanup keys,
shared sign-in integration, Type Index discovery and explicit authenticated fetch
wiring. Session lifecycle, sign-in choices and public profile reads are tested in
`@jeswr/app-session`. The Playwright
sign-in spec starts local CSS and Vite, seeds a private health record with twelve
observations, signs in through a real popup, checks the records are listed, and
checks ambient fetch still gets 401/403. Run it with `pnpm --filter
@jeswr/pod-health-web test:e2e` when the local server and browser are available.
