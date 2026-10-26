---
name: solid-conformance
description: Use when running, configuring, or debugging the Solid Conformance Test Harness, patching DPoP ath support, wiring Keycloak service accounts, interpreting EARL scores, or fixing harness audience/issuer/TLS failures against a Solid server.
---

## Quick reference

Run the patched harness with DPoP `ath`; never weaken server verification to pass it.
Provision resolvable WebIDs and exact issuer/audience/WebID mappings before testing.
Claim only implemented features, inspect the EARL report, and prefer native TLS under concurrent load.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Implementation paths, ADR numbers, server-specific defaults, and commands below refer to
the original `prod-solid-server` implementation, outside this SDK checkout. They document
that server's patterns, rather than files or dependencies to install in this workspace.

# Solid conformance (CTH / EARL / Karate)

Orchestrating the [solid-contrib **conformance-test-harness**](https://github.com/solid-contrib/conformance-test-harness)
(Java/Maven, Karate-based, EARL+HTML output) against a Solid server. Grounded in ADR-0007/0008,
`.github/workflows/conformance.yml`, `conformance/` (SCORE, patch script, config), and the
`conformance-specialist` agent. The hard parts are **DPoP `ath` patching** and **Keycloak auth wiring**.

## When to use

Running/configuring the CTH; patching the harness; provisioning test users; wiring Keycloak for
DPoP-bound tokens; reading EARL reports; debugging harness 401s; setting up the CI conformance gate.

## 🔒 The DPoP `ath` patch (the #1 blocker)

The **published CTH omits the RFC 9449 `ath` claim** (base64url SHA-256 of the access token) on
protected-resource DPoP proofs. A correctly-enforcing server (oauth4webapi binds proof↔token via `ath`,
RFC 9449 §4.3/§7.1) therefore rejects the harness — and **you must not weaken the server to pass**.
`conformance/patch-harness-ath.sh` patches a fresh upstream clone: it threads the access token into
`Client.generateDpopToken`, computes `ath`, and adds it to the proof at both call sites. The patch is
**idempotent** (checks for its own marker first). Upstream fix is PR'd; the patch is the local bridge.

```bash
# the injected ath, in the harness's Java DPoP generator:
ath = base64url( SHA-256( accessToken ) )  without padding   # claims.setStringClaim("ath", ath)
```

## 🔒 Keycloak service-account wiring (DPoP-bound RFC 9068 tokens)

Test users (alice/bob) are Keycloak **service-account clients** (`conformance-<user>` in
`docker/keycloak/realm.json`) with `serviceAccountsEnabled: true` + `dpop.bound.access.tokens: true`. The
harness does client-credentials → token, then adds the DPoP proof itself. For the server to accept it the
realm MUST emit:
- **RFC 9068 `at+jwt`** access tokens (`access.token.header.type.rfc9068=true`, Keycloak ≥26.2),
- an **`oidc-audience-mapper`** setting `aud` to the server's base URL (matches `PSS_TOKEN_AUDIENCE`),
- a **hardcoded `webid` claim mapper** per client (the user's profile URL).

Server side: realm in `PSS_TRUSTED_ISSUERS`, audience in `PSS_TOKEN_AUDIENCE`. **Missing any one mapper →
silent 401.** WebIDs are provisioned **separately** (`prod-solid-server-provision --username alice`); the
harness dereferences the WebID for `pim:storage`, so it must resolve and its `solid:oidcIssuer` must match
the harness IdP. See [solid-auth](../solid-auth/SKILL.md) for what the server checks.

## test-subjects.ttl: claim only what you implement

`conformance/config/test-subjects.ttl` declares implemented features (EARL `TestSubject`). A feature is
tested unless marked `solid-test:skip "<feature>"` with a rationale (skips still count toward the total,
marked out-of-scope). Claiming-but-not-implementing → failures; not-claiming → hidden. This server claims
**41 cases (25 Protocol + 16 WAC)** and skips `acp` (WAC-only, ADR-0004), `wac-agent-group` (v1
follow-up, fail-closed), `http-redirect` (non-default-port unimplementable on one listener).

## Reading the result (EARL)

The harness emits `earl:Assertion` → `earl:TestResult` with `earl:outcome` (`passed`/`failed`/
`notApplicable`) plus timing/title; `report.html` renders from the Turtle, `report.txt` is the headline.
Track the score in `conformance/SCORE.md` (per-category + MustScenarios count — skip tags reduce scenario
rows but keep the feature total).

## Native HTTPS under concurrent load

The harness needs `https://` (WebID deref). A reverse-proxy hop (`Caddy tls internal`) threw
`SSLException` under the harness's concurrent TLS connections and stalled the suite — CI moved to **native
Node/Fastify TLS** (`PSS_TLS_CERT_FILE`/`PSS_TLS_KEY_FILE`, self-signed `localhost` cert trusted in CI).
Locally a proxy is fine under light load; CI is production-shaped.

## CI gate (and what it excuses)

`.github/workflows/conformance.yml` (40-min cap): brings up MinIO+QLever+Keycloak, generates+trusts the
TLS cert, builds+starts the server (native HTTPS), provisions users, clones `specification-tests`,
**builds/caches the patched harness** (cache key includes `patch-harness-ath.sh` + the workflow file),
runs it (10-min fail-fast), and gates. The gate **only excuses the published harness's `ath` blocker** —
a patched harness has no excuse and must produce a real pass/fail report.

## Local run

```bash
docker compose up -d                                   # MinIO, QLever, Keycloak
npm run build && npm start                             # native HTTPS, or behind a TLS proxy
ISSUER=http://localhost:8080/realms/solid/             # ⚠ trailing slash required (URI.resolve)
node dist/provisioning/cli.js --username alice --issuer "$ISSUER" --container test/
# clone + patch the harness, fill conformance/prod-solid-server.env, then run it →
# reports land in conformance/reports/ (report.html, report.ttl EARL, report.txt)
```

## Harness-stability hardening (landed in this phase)

The harness's concurrent reads surfaced a QLever result-cache race (500). Mitigations: run QLever with
`--cache-max-num-entries 0` (safe for a live-mutated index), bounded retry (3×) on transient 5xx, and a
per-request `AbortSignal` timeout (~45s). Also: `DELETE` on a non-existent resource routes through the
**authorization** path (401/403), not 404 — avoids a resource-existence side channel.

## Gotchas

- [ ] Published CTH can't pass an `ath`-enforcing server — run the **patched** harness for a real score.
- [ ] Keycloak: `rfc9068=true` + audience-mapper + per-client `webid` mapper + `dpop.bound.access.tokens`
      — miss one → silent 401.
- [ ] Provision WebIDs **before** the run; WebID must resolve and its `solid:oidcIssuer` must match the IdP.
- [ ] **Issuer URL needs a trailing slash** (`…/realms/solid/`) or `URI.resolve('.well-known/…')` drops a
      segment — both for provisioning and the harness `SOLID_IDENTITY_PROVIDER`.
- [ ] Prefer native TLS under the harness's concurrent load (a proxy hop can `SSLException`-stall).
- [ ] `test-subjects.ttl` must claim exactly what's implemented; document every `solid-test:skip`.
- [ ] Harness cache key tracks the patch script + workflow — bump a version suffix to force a rebuild.
- [ ] Don't weaken the server to make the harness pass; the bug is upstream and out of scope.

## See also

- Code/config: `conformance/{SCORE.md,patch-harness-ath.sh,config/test-subjects.ttl}`,
  `.github/workflows/conformance.yml`, `docker/keycloak/realm.json`, ADR-0007/0008.
  Related: [solid-auth](../solid-auth/SKILL.md) (DPoP/RFC 9068 the harness must satisfy), [solid-wac](../solid-wac/SKILL.md) (the 16 WAC cases),
  [solid-rdf](../solid-rdf/SKILL.md) (EARL Turtle).
- Specs / libs: solid-contrib/conformance-test-harness + specification-tests, `oauth4webapi`, RFC 9449 /
  9068 / 6750, W3C EARL, Karate, Solid Protocol + WAC.
