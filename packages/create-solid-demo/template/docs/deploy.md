# Deploying the __CSD_TITLE__ walkthrough

One shared domain, N zone apps behind the shell's rewrites (the browser-storage
partitioning constraint), one Vercel project per app from this single monorepo.
These are hard-won learnings — read them BEFORE creating any project.

## Per-app Vercel projects

- **`rootDirectory` = `apps/<slug>`** on EVERY project. A Git-integration
  auto-created project without it builds the repo root and fails; a single-app
  CLI deploy from inside the app directory fails too. Create each project
  explicitly with the root directory set.
- **CLEAR the project-level build/output overrides.** A project-level
  `buildCommand` silently WINS over the checked-in `vercel.json`; the committed
  `vercel.json` (turbo-filtered build + `turbo-ignore`) must be the only build
  configuration.
- `ignoreCommand: npx turbo-ignore --fallback=HEAD^1` means a push rebuilds only
  affected apps.

## Env matrix

Zone-URL vars are read at **build time** by the shell's rewrites — changing one
requires a shell redeploy, and the shell project's env allowlist must include
them. Regenerate this table from the document with `envMatrix(doc)` from
`@jeswr/solid-showcase/next` whenever the registry changes.

__CSD_ENV_MATRIX__

- **`__CSD_ENV_PREFIX___TRUST_FORWARDED_HEADERS=1` is REQUIRED on every app with
  an authenticated pod route** deployed behind a TLS-terminating proxy (Vercel):
  the DPoP proof binds the PUBLIC request URL, so without the forwarded host the
  guard reconstructs the internal URL and every authenticated call fails closed.
- The pod-guard allowlists (`*_TRUSTED_OIDC_ISSUERS`, `*_POD_ALLOWED_ORIGINS`)
  fail closed: unset ⇒ the rail answers 503, never an open door.

## Preview posture

Decide ONE gate per environment: either Vercel preview protection (SSO) guards
preview URLs, or the consent interstitial is the gate on public demos. Never
disable both. Production demo surfaces stay public *with* the interstitial and
`noindex` metadata (the showcase metadata helper sets it; keep it).

## Neutral slugs (honest branding)

Hostnames, Vercel project names, and app slugs derive from ROLES (`vault`,
`permits`, …), never from modelled-on organisation names — an org mark in a
hostname reads as endorsement. The registry's `modelledOn` text is the ONLY
place the organisation is named, always as "modelled on".

## Framework dependency status

The @jeswr framework packages (`solid-showcase`, `solid-showcase-kit`,
`solid-pod-guard`, `synthetic-rdf`, `solid-seed`) are pending their npm publish.
Until they are on the registry, `pnpm install` (locally, in CI, and on Vercel)
needs them pinned to packed tarballs or git mirrors via `pnpm.overrides` in the
root `package.json`, e.g.:

```json
{
  "pnpm": {
    "overrides": {
      "@jeswr/solid-showcase": "file:./vendor/jeswr-solid-showcase-0.1.0.tgz"
    }
  }
}
```

Remove the overrides once the packages are published.
