# AGENTS.md — building on this Solid app

You are extending a **Solid** web app: Next.js (App Router) + shadcn/ui + Tailwind +
TypeScript, with login, profile read, and a path to pod CRUD already wired. Solid lets a
user own their data in a personal **Pod** and grant your app access — so reads/writes go to
**the user's pod**, identified by their **WebID**, not to your own database.

This app is already correct. Your job is to keep it correct while adding features. The rules
below are non-negotiable; the lint config and tests enforce most of them.

## Verified stack (do not change versions without re-verifying against npm)

| Package | Version | Role |
|---|---|---|
| `next` | 16.x (App Router, React 19) | framework |
| `@jeswr/app-shell` | `git+https#5a7484d` | shared suite shell — `ThemeProvider`/`ThemeToggle`/`themeScript`, `AccountMenu`, `FeedbackButton`, primitives |
| `@jeswr/solid-elements` | `git+https#df0fbe4` | framework-agnostic W3C Web Components (Lit 3) — `<jeswr-loading>` wait-state spinner via the `./react` (@lit/react) adapter; themes from the same app-shell tokens |
| `@jeswr/solid-components` | `git+https#5e999c0` | declarative, data-bound Solid Web Components (Lit 3) — `<solid-view>` resolve-by-type composer + per-class read elements (`<jeswr-task-list>`/`<jeswr-contact-list>`/`<jeswr-profile-card>`/`<jeswr-bookmark-list>`/`<jeswr-collection>`); injectable `.fetch`/`.publicFetch` seam. **READ-ONLY (Phase 1); edit mode is Phase 2.** |
| `lit` / `@lit/react` | 3.x / 1.x | Lit runtime + React adapter for solid-elements (direct deps so npm hoists ONE copy; also deduped in `next.config.ts`) |
| `@solid/reactive-authentication` | 0.1.3 | login — patches global `fetch` with DPoP tokens |
| `@solid/object` | 0.6.0 | typed read wrappers (`WebIdDataset`, `Agent`, `ContainerDataset`, WAC/ACP) |
| `@rdfjs/wrapper` | 0.34.0 | wrapper base (`OptionalFrom`, `LiteralAs`, `NamedNodeAs`) |
| `@jeswr/fetch-rdf` | 0.1.0 | fetch + parse RDF in one call |
| `n3` | 2.x | `DataFactory` (required at runtime; NOT a transitive dep — keep it installed) |
| `oauth4webapi` / `dpop` | 3.x / 2.x | used by the vendored token provider |

These packages are **not in context7** and some READMEs lag the npm dist. Trust the `.d.ts`
in `node_modules` over any doc. Run `npm ci` before trusting lint locally — local
`node_modules` drifts from the lockfile.

## Hard rules (lint-enforced)

1. **Never `@inrupt/*`.** Auth is `@solid/reactive-authentication`; data is `@solid/object`.
   The lint config errors on the import.
2. **All RDF through the object mapper.** Read/parse via `@jeswr/fetch-rdf` + `@solid/object`
   + `@rdfjs/wrapper`. **Never** `rdf-parse`, never `new N3.Parser()` to scrape data, never
   regex over Turtle, never string-concatenate triples. Turtle + JSON-LD only.
3. **WAC/ACP via `@solid/object` wrappers** (`AclResource`, `AccessControlResource`,
   `wacToAcp`/`acpToWac`) — never hand-build `.acl`/`.acr` documents.
4. **shadcn/ui only for UI.** Add components with `npx shadcn@latest add <name>`; do not
   hand-roll buttons/inputs/dialogs.

## How auth actually works (read before touching `components/solid/`)

There is **no session object and no `authFetch` wrapper.** `ReactiveFetchManager.registerGlobally()`
patches `globalThis.fetch`; afterwards every plain `fetch()` (including the ones inside
`@jeswr/fetch-rdf`) transparently upgrades on a `401` — finds a matching token provider,
attaches a DPoP-bound token, and retries. So to make an authenticated request you just call
`fetch(url)`.

Two mistakes to never make:

- **Forgetting `registerGlobally()`.** The 0.1.3 `ReactiveFetchManager` **constructor does NOT
  patch fetch**. `SolidAuthProvider.tsx` calls `registerGlobally()` explicitly — keep it.
- **Importing the auth library on the server.** It uses browser-only custom elements and
  breaks `next build` under SSR. It is loaded via a **dynamic import inside an effect**
  (`SolidAuthProvider.tsx`) and the whole provider is mounted with `next/dynamic({ ssr: false })`
  (`app/providers.tsx`). Keep new auth code on the client side of that boundary.

### Why a custom token provider

The published `DPoPTokenProvider` resolves the OIDC issuer from a hard-coded host map and
**rejects HTTP/loopback issuers**, so it cannot log into a local Community Solid Server. This
app uses the vendored **`WebIdDPoPTokenProvider`** (`lib/solid/webid-token-provider.ts`), whose
issuer comes from the user's WebID profile, with `allowInsecureLoopback` (dev-only) so local
CSS login works. Do not swap it back to the published provider.

> **Known limitation.** Interactive login over **HTTP/loopback** only works because of
> `allowInsecureLoopback`, which is gated behind `NEXT_PUBLIC_ALLOW_INSECURE_LOOPBACK=true`
> (set in `.env.local` for dev). In production, log into **HTTPS** pods (e.g.
> `solidcommunity.net`); leave the flag unset.

## The shared suite shell (`@jeswr/app-shell`) — already wired

This app is born with the suite's shared UX shell. Keep it; don't re-roll your own
theme system or account menu.

- **Theme.** `<ThemeProvider>` (light / dark / system) wraps the app in
  `app/providers.tsx`, INSIDE which the auth provider mounts. A no-flash bootstrap
  runs before first paint from `app/layout.tsx` `<head>` (the string lives in
  `lib/theme-script.ts` — kept React-free so the SERVER layout never imports the
  app-shell barrel; importing client-only `React.createContext` into a server
  component breaks `next build` page-data collection). The bootstrap's
  `storageKey`/`attributeClass` MUST match the `<ThemeProvider>` defaults
  (`app-shell-theme` / `dark`) — change one, change both.
- **Header.** `components/AppHeader.tsx` (a client component, mounted in the
  layout) renders `<FeedbackButton/>` + `<ThemeToggle/>` + `<AccountMenu/>`. The
  AccountMenu is DECOUPLED — it takes `webId`/`displayName`/`avatarUrl` + an
  `onSignOut` callback as props, wired here to `useSolidAuth()`. It renders only
  once signed in.
- **Feedback.** `<FeedbackButton repo={FEEDBACK_REPO} appName={APP_NAME} … />`
  files a GitHub issue against `FEEDBACK_REPO` (in `lib/app-shell-config.ts` —
  scaffolded from `create-solid-app --repo owner/name`, editable). The signed-in
  WebID is attached only if the reporter ticks the consent box (default OFF).
- **Tokens.** `app/globals.css` defines the suite OKLCH palette (the SAME token
  set `@jeswr/app-shell` ships) and `@source`s the app-shell `dist` so Tailwind
  generates the utility classes its components emit. Do NOT also import
  app-shell's `tokens.css`/`theme.css` — that would duplicate the token home.
- **Wait states.** Use the suite spinner `<jeswr-loading>` (from
  `@jeswr/solid-elements`) for loading/restoring states — see `app/page.tsx`'s
  autologin state. Register it with a side-effect `import "@jeswr/solid-elements/react"`
  in the client component that uses it. Use the RAW-ATTRIBUTE form for a contextual
  label — `<jeswr-loading label="Signing you in…" />` — NOT the @lit/react
  `<Loading label>` wrapper: under @lit/react's `node` export mode (Vitest, Next
  SSR/RSC) the wrapper drops the `label` PROPERTY, so the raw attribute is the
  reliable label path (it reflects + renders; see `types/solid-elements.d.ts`).
- **Safe-form button base (#121/#80) — DON'T break it.** `globals.css` ships the
  PROVEN host-button base `button:where(:not([data-app-shell-control]))`. If you add
  a global `button { … }` rule, KEEP this `:where(:not(...))` scope: `:where()` is
  zero-specificity so the base stays at `(0,0,1)` (identical to a bare `button {}`)
  and the `:not([data-app-shell-control])` excludes every app-shell control so a host
  filled look never leaks onto / clobbers the box model of the ThemeToggle /
  AccountMenu / FeedbackButton (incl. its portaled dialog). NEVER use a bare
  `button {` (leaks onto the shell) or a bare `button:not([data-app-shell-control])`
  (the attribute selector escapes `:not()` → `(0,1,1)`, out-ranking your class-only
  overrides). `tests/css-isolation.test.ts` enforces this; `tests/solid-elements.test.ts`
  pins the spinner's registration + theming + label contract.
- **Lockfile transport (#78).** `npm run lint` runs `check:lockfile-transport`, which
  fails if a stray `npm install` rewrites the `@jeswr` `git+https` deps to
  `git+ssh://` in `package-lock.json` (that breaks keyless `npm ci` on CI/Vercel).
  If it fires, rewrite each `resolved` back to `git+https://github.com/…`.

The chrome is from `@jeswr/app-shell` + `@jeswr/solid-elements` (`git+https`-pinned
deps that ship their own built `dist/`, so `npm install` / `npm ci` is keyless). Don't
fork these components into the app; if you need a behaviour change, contribute it upstream.

## The data-layer contract (copy this pattern for every new feature)

`lib/solid/*.ts` holds pure data functions. Each takes an **optional injected `fetch`**:

```ts
export async function readThing(url: string, fetchImpl?: typeof fetch): Promise<Thing> {
  const { dataset } = await fetchRdf(url, fetchImpl ? { fetch: fetchImpl } : undefined);
  // ...read fields via @solid/object / @rdfjs/wrapper accessors...
}
```

- In the **browser** you omit `fetchImpl` → it uses the patched global fetch (auth attached
  automatically).
- In **tests** you inject a mock fetch → the function runs with no network and no browser.
  See `tests/lib/profile.test.ts` for the shape.

Never let RDF terms leak out of `lib/solid/` — return plain data the UI renders.
`readProfile` (`lib/solid/profile.ts`) is the worked example: it reads through `WebIdDataset`
+ the vendored `ProfileAgent` and returns a flat `Profile`.

### Reading a profile field

```ts
import { fetchRdf } from "@jeswr/fetch-rdf";
import { WebIdDataset } from "@solid/object";
import { DataFactory } from "n3";

const { dataset } = await fetchRdf(webId);
const me = new WebIdDataset(dataset, DataFactory).mainSubject; // undefined if no solid:oidcIssuer
console.log(me?.name, [...(me?.storageUrls ?? [])]);
```

`storageUrls` is a `Set` — a WebID may advertise several `pim:storage`. When the app needs one,
**present the list and let the user choose; never silently take the first.** Same for issuers.

### Writing data (pod CRUD)

`@solid/object` read classes are **read-only getters** — there is no `save()`. To write:
1. Build a `TermWrapper` subclass with `…As` setters over the dataset (or assemble a new
   dataset via `DataFactory`), 2. serialise to Turtle with the n3 `Writer` **inside
   `lib/solid/`**, 3. conditional `PUT`/`PATCH` with the `etag` from `fetchRdf` as `If-Match`.
   Keep the ETag from the read for safe writes. Containers list via `ContainerDataset` /
   `Container` / `Resource`; access via `AclResource`.

## Declarative data-bound components (`@jeswr/solid-components`) — already wired

This app is born with the suite's **declarative data layer**. Alongside the
hand-written `lib/solid/*.ts` data functions above, you can render a pod resource
with a **data-bound Web Component** — no hand-rolled LDP listing or RDF parsing in
app code. `components/solid/PodDataView.tsx` is the worked example (shown on the home
page once signed in).

- **`<solid-view src>`** — the composer. Point it at a resource; it reads the
  `rdf:type`, resolves the matching element, and mounts it (an untyped LDP container
  falls back to `<jeswr-collection>`). This is the "render whatever is at this URL"
  element.
- **Per-class read elements** bind one RDF class each: `<jeswr-task-list>` (`wf:Task`),
  `<jeswr-contact-list>` (`vcard:Individual`), `<jeswr-profile-card>` (a WebID profile),
  `<jeswr-bookmark-list>` (`book:Bookmark`), `<jeswr-collection>` (`ldp:Container`).

**How to use one (the load-bearing rules):**

1. **Register them with a side-effect import in a CLIENT component:**
   `import "@jeswr/solid-components"`. They are browser-only Lit elements
   (`customElements.define`) — never import in a server component (breaks `next build`).
2. **The fetch seam is an object PROPERTY, set via a ref** — not an attribute. Pass the
   app's authenticated fetch: `registerGlobally()` has patched `globalThis.fetch`, so
   handing the element `(...a) => fetch(...a)` gives it the user's DPoP-authed reads.
   `PodDataView.tsx` shows the `useSeamRef` pattern. The `src` is a plain attribute.
3. **JSX typing** for the tags lives in `types/solid-components.d.ts` (so no
   `@ts-expect-error`). Add a new tag there in the same change you first use it.
4. **Credential boundary (fail-closed).** Pass `.fetch` (authed, same-origin) for the
   user's own pod. A foreign/public read needs `.publicFetch` — a PRISTINE fetch
   captured BEFORE `registerGlobally()` patched the global — or the read throws rather
   than leak the DPoP token cross-origin. Don't wire `.publicFetch` to the patched global.

**READ-ONLY (Phase 1).** These elements only READ today. The edit/write path (an
editable SHACL form + edit-mode elements) is `@jeswr/solid-components` **Phase 2** —
until it ships, use the `lib/solid/` write pattern below for mutations. The resolver
map already carries a `mode` field (`view`-only for now).

**Scaffold-time model choice.** `create-solid-app --data-model <task|contact|bookmark|profile|collection|solid-view>`
emits the matching bound element in `PodDataView.tsx` at generation time (default
`solid-view`). After scaffold it's plain source you edit freely.

Don't fork these components into the app; a behaviour change is contributed upstream
to `@jeswr/solid-components`.

## Add a feature — the loop

1. **Write a failing Vitest** in `tests/lib/<feature>.test.ts` driving a new
   `lib/solid/<feature>.ts` function with an injected mock fetch.
2. **Implement** the data function via `@solid/object` + `@rdfjs/wrapper` (+ `@jeswr/fetch-rdf`).
3. **Add UI** with shadcn components in `components/solid/`, reading state from `useSolidAuth()`.
4. **Verify the gate:** `npm run typecheck && npm run lint && npm test && npm run build` — all
   must pass before you're done.

## Local dev

```sh
cp .env.example .env.local        # enables loopback login for the dev pod
npm run dev                       # boots a seeded in-memory CSS on :3000 + app on :3200
```

`npm run dev` (`scripts/dev.mjs`) starts a local Community Solid Server, seeds `alice`/`bob`
pods with a profile (`foaf:name` + `pim:storage` — a bare CSS profile has neither and the app
looks broken), **prints the test logins**, then starts `next dev`. CSS boot is slow (~15s); the
script reuses one already on :3000, so restart the app freely. **Never PATCH a profile after
start to add triples** — seed at creation (the script does) or use a pod template.

## Reference skills

If you have access to the Solid agent skills, prefer them over re-deriving APIs:
`solid-reactive-authentication`, `solid-object`, `solid-fetch-rdf`, `solid-test-infrastructure`.
They document the *published* APIs and the gotchas above.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version (16.x) has breaking changes — APIs, conventions, and file structure may differ
from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before
writing Next-specific code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
