<!-- AUTHORED-BY Claude Opus 5.5 -->
# Live sign-in checks

`providers.json` lists every Solid identity provider a suite sign-in screen advertises, plus the
app clients checked against each one. `test/sign-in-providers.test.mjs` (part of `pnpm run
test:root`) fails when an app advertises a provider that has no entry here, so a new provider
cannot ship untested.

| Check | What it proves | Where |
|---|---|---|
| Protocol | For every provider and app: discovery and its CORS, JWKS, the app's real authorization request reaching the login page, and token-endpoint CORS for DPoP. No account is needed. | `check.mjs`, job `protocol` in `.github/workflows/sign-in-live.yml` |
| Local CSS, full login | Drive signs in to an in-memory Community Solid Server through the real popup and lists a private container. | `apps/pod-drive/web/tests/e2e`, `.github/workflows/sign-in-local.yml` |

The live workflow runs daily, on demand, and on changes to these files. It creates no accounts:
public providers get the protocol check only, because a full login there needs an account the
maintainer provides. Full logins run against the local Community Solid Server instead.

Run the protocol check locally with `node scripts/sign-in-live/check.mjs`. Set
`SIGN_IN_PROVIDERS=solidcommunity,teamid` to run a subset.

## Removed providers

`providers.json` → `removed` records providers taken off the sign-in screens because the check
showed apps cannot sign in there. solidweb.org (Node Solid Server) was removed on 2026-11-11: its
`/authorize` rejects Client Identifier Document client IDs with 401. The suite's own test IdP
(idp.solid-test.jeswr.org) was removed on 2026-11-19 when its AWS host was retired.
