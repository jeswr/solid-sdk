# create-solid-app

> **Status: EXPERIMENTAL — AI-generated — not yet published to npm.**
> This package was authored by an AI coding agent (Claude Opus 4.8) as part of
> [@jeswr](https://github.com/jeswr)'s Solid app suite. It is a **public,
> `jeswr`-namespace** initiative. Treat it as a prototype: the scaffold (S0–S1)
> works end-to-end, but the interactive auth-code login path (S2) is **gated on an
> upstream fix** (see [§S2 — auth-code login is `#18`-gated](#s2--auth-code-login-is-18-gated)),
> and the package is **not published** until that lands.

`npx create-solid-app my-app` scaffolds a house-rules-conformant Solid web app —
Next.js 16 (App Router, React 19) + shadcn/ui + Tailwind 4, wired to a local
Community Solid Server with a seeded test account — from a proven, bundled
template. It does **not** re-derive the spec's full feature surface; it *composes*
the published house-rule stack so the marginal cost of a correct Solid app
approaches zero, for humans and agents alike.

Every scaffolded app is **born with the shared suite UX stack** baked in:

- **`@jeswr/app-shell`** — the suite's framework-agnostic shell. The template
  wires `<ThemeProvider>` (light / dark / system, with a no-flash `<head>`
  bootstrap), a header `<ThemeToggle/>` + `<AccountMenu/>` (avatar + WebID +
  Sign out, driven by the app's `useSolidAuth()`), and a `<FeedbackButton/>`
  (report-bug / feedback / help → a GitHub issue on **this app's own repo**;
  WebID attached only on explicit consent). Installed keyless via a pinned
  `git+https` ref so a scaffolded app's `npm install` / `npm ci` works on
  Vercel/CI with no token.
- **Deep-link AUTOLOGIN** (media-kraken#54) — an `#autologin/<webid>` hash
  triggers a silent full-page Solid-OIDC redirect login. Coexists with the
  theme system; the home page shows a "Signing you in…" state mid-redirect.
- The **suite OKLCH theme tokens** (the same teal palette as Pod Manager and the
  pod-* apps), so a new app shares ONE privacy-first identity out of the box.

`create-solid-app my-app --repo owner/name` bakes the feedback button's target
repo and the app's display name into `lib/app-shell-config.ts` (both editable
afterwards). Without `--repo` it leaves a `your-org/your-repo` placeholder.

## Self-contained

This package bundles the app-builder template under [`template/`](./template) and
ships it in the npm tarball (`package.json` `files`). The CLI runs `bin.ts`
directly via **Node 24's native TypeScript type-stripping** — there is no build
step and no `dist/`.

## Usage

Requires **Node 24** (`nvm use 24`).

```sh
# Once published (post-#18):
npx create-solid-app my-app

# Locally, from this repo:
node bin.ts my-app

# Via npm link (acts like npx):
npm link
create-solid-app my-app
```

Flags:

| Flag | Effect |
|---|---|
| `--no-install` | Skip `npm install` in the scaffolded dir. |
| `--seed-pod` | After scaffold, boot a local in-memory CSS v8 on `:3088`, seed an account, and print the issuer + WebID + client credentials. Verifies the credentials by minting a client-credentials DPoP token. CSS stays up until Ctrl-C. **First run installs the dev-pod deps on demand** (`@solid/community-server` + `jose`) into a per-user cache — they are intentionally **not** part of the default install, so a plain scaffold stays fast. |
| `--repo <owner/repo>` | GitHub repo the baked-in `<FeedbackButton/>` files issues against (also accepts a full GitHub URL / `.git` suffix — normalised to `owner/repo`). Substituted into `lib/app-shell-config.ts`. Omitted → a `your-org/your-repo` placeholder you edit. |
| `-h`, `--help` | Help. |

What it does: copies the bundled template (minus `node_modules`/`.next`/`tsconfig.tsbuildinfo`
— the committed `package-lock.json` IS copied, for a resolution-free first install),
substitutes `package.json` `name`, the app-shell `APP_NAME` + (with `--repo`) the
feedback `FEEDBACK_REPO` in `lib/app-shell-config.ts`, generates a `README.md`
titled with the app name, optionally installs deps, optionally boots a seeded dev pod.

## What works standalone (S0–S1)

- **S0 scaffold:** `create-solid-app my-app` copies the bundled template, applies
  the name + README substitutions, and (by default) installs deps. Verified by
  `test/scaffold.test.ts` (file tree, artefact exclusion, substitutions,
  non-empty-dir guard, shipped lockfile) and `test/bin-args.test.ts`.
- **S1 the scaffolded app typechecks AND builds:** `RUN_SLOW=1 npm test` runs
  `test/scaffold-tsc.test.ts`, which scaffolds → `npm install` → `npx tsc
  --noEmit` → `npx next build` and asserts the generated app is `tsc`-clean and
  that the full app — including the baked-in `@jeswr/app-shell` stack
  (ThemeProvider, the no-flash head script, the AppHeader with
  ThemeToggle/AccountMenu/FeedbackButton) and the autologin — SSR/RSC-compiles
  and prerenders.
- **`--seed-pod`:** boots an in-memory CSS, seeds `alice`, and proves the printed
  client-credentials mint a DPoP token (`test/seed-pod.test.ts`, `RUN_SLOW=1`).

## S2 — auth-code login is `#18`-gated

The generated app's **interactive browser login** (the WebID → authorization-code
+ PKCE + DPoP flow, wired in `template/components/solid/SolidAuthProvider.tsx` via
the vendored `template/lib/solid/webid-token-provider.ts`) is **kept but gated**:

- The **blocker** is upstream
  [`@solid/reactive-authentication` #18](https://github.com/solid-contrib/reactive-authentication/issues/18):
  the published `DPoPTokenProvider` resolves issuers through a hard-coded host map
  and **rejects HTTP / loopback issuers**, so it cannot log in against a *local*
  dev CSS (whose issuer is `http://localhost:…`).
- The template **works around it locally** with a vendored `WebIdDPoPTokenProvider`
  that flips `oauth4webapi`'s `allowInsecureRequests` for `localhost`/`127.0.0.1`
  issuers only (gated by `NEXT_PUBLIC_ALLOW_INSECURE_LOOPBACK`, see
  `template/.env.example`). This is a **vendored stop-gap**, not the upstream fix.
- **Until #18 lands** (a first-class loopback-issuer option in the published
  provider), this package is **not published to npm** — the maintainer holds the
  publish on the upstream fix so downstream apps depend on the published provider,
  not a vendored copy.

Tracked in the suite tracker (this repo does not use markdown TODOs). Do not
remove the vendored provider until #18 ships an equivalent.

## What it does NOT do

- No Vercel deploy (the template ships `vercel.json`; deployment is the user's).
- No template registry / `--template` variants (only the single bundled
  app-builder template).
- No `git init`, no `--pm` selection, no interactive prompts, no `doctor`
  subcommand, no auto-run of `npm run dev`.
- Does **not** publish to npm (publish is post-#18 — see above).

## Tests

```sh
npm test                 # fast: arg parsing + scaffold tree + substitutions
RUN_SLOW=1 npm test      # + --seed-pod CSS boot + scaffold→tsc green
```

## Gate

```sh
npm run lint        # Biome over bin.ts src test
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsc --noEmit + verify the package is shippable (template bundled, files complete)
```

## Node / house rules

Node 24 (CLI, type-stripping). The generated app pins Node 22 (CSS's
`oidc-provider`). Never `@inrupt/*`. All RDF goes through `@jeswr/fetch-rdf` +
`@solid/object` + `@rdfjs/wrapper` + `n3` — never a bespoke RDF parser. The
generated app inherits the template's lint/house-rule stack and bundled
`AGENTS.md`.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code) (Claude Opus 4.8).
