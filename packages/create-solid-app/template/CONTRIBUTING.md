# Contributing to __CSA_APP_NAME__

Thanks for helping improve this app! This is a Solid web app (Next.js App Router +
shadcn/ui + Tailwind + TypeScript). Please read the house rules in
[`AGENTS.md`](./AGENTS.md) before making changes — they explain how auth, RDF, and
the shared UI shell work here.

## Before you open a PR — the gate must be green

Run all four checks locally; a change only lands when every one passes:

```sh
npm run lint        # ESLint over the app + the lockfile-transport guard
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # next build
```

If you add a feature, add a test for it (see the loop in `AGENTS.md`): a failing
Vitest first, driving a `lib/solid/*.ts` data function with an injected mock
fetch, then the implementation and the UI. Do not weaken a check to make it pass.

## Supply-chain hygiene

This app ships an [`.npmrc`](./.npmrc) with `ignore-scripts=true`. That disables
npm package lifecycle scripts (`preinstall` / `install` / `postinstall`), which
removes a common arbitrary-code-execution surface: a malicious or compromised
dependency can no longer run code on your machine or in CI just by being
installed. Keep it enabled.

Before adding a new dependency, vet it: prefer well-maintained, widely-used
packages, check that the name is the one you actually mean (typosquatting is
real), and avoid a brand-new package with no history. Keep the dependency
footprint small.

## Reporting bugs and getting help

- **Bugs / feature requests:** open an issue at
  <https://github.com/__CSA_REPO__/issues>. Include what you did, what you
  expected, and what happened (with the browser console output when it is a
  runtime error). The app also has an in-app feedback button that files an issue
  for you.
- **Security vulnerabilities:** do **not** open a public issue — follow
  [`SECURITY.md`](./SECURITY.md) instead (private GitHub Security Advisories).

## Conventions

- Frontend is shadcn/ui + Tailwind — no hand-rolled buttons/inputs/dialogs.
- All RDF goes through `@jeswr/fetch-rdf` + `@solid/object` + `@rdfjs/wrapper` —
  never a bespoke parser or string-concatenated triples.
- Never import `@inrupt/*`; auth is `@solid/reactive-authentication`.

See `AGENTS.md` for the full, lint-enforced rule set.
