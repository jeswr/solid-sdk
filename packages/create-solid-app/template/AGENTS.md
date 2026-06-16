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
| `@jeswr/app-shell` | `git+https#cc86f78` | shared suite shell — `ThemeProvider`/`ThemeToggle`/`themeScript`, `AccountMenu`, `FeedbackButton`, primitives |
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
  Keep any bare element selectors scoped (`@layer base`), never a global
  `button {}`, so the shadcn/app-shell button styling is not clobbered.

The whole stack is from `@jeswr/app-shell` (a `git+https`-pinned dep that ships its
own built `dist/`, so `npm install` is keyless). Don't fork these components into
the app; if you need a behaviour change, contribute it upstream.

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
