<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# NOTES disposition (SKL-02 / sst-nxht)

Source: the dispatcher-supplied `solid-ai-coding-proposals-NOTES.md` snapshot of
`jeswr/solid-ai-coding-proposals/NOTES.md`, collected from product-2 through product-6
integrations. This ledger implements skills DESIGN §2 D3. Source numbering repeats §3;
the section labels below distinguish Keystone from CapNote. All 20 numbered items are
accounted for, including the sub-lessons in §1, §4.1, and §4.3.

Snapshot SHA-256: `4d6d951016da39c9a2d1a624e3c3464a0b27dc959985b855c974db647576cc33`.

Each adopted lesson is in a skill's **Pitfalls** section. Historical reference-code snapshots
remain reading material; the auth skill explicitly flags their unfixed defects. This lane
does not change package APIs, run live integration tests, or adopt proposed upstream APIs.

| Source item | Destination and disposition |
|---|---|
| §1 — Broker/RS split: broker issuer, IPv4/self-signed TLS, strict `ath` | [Server topology](solid-server-matrix/SKILL.md#split-broker-and-resource-server), [loopback addressing](solid-server-matrix/SKILL.md#loopback-address-versus-public-url), and [client issuer handling](solid-reactive-authentication/SKILL.md#broker-issuers-and-loopback-http). All three bullets adopted; existing resource-versus-token-endpoint `ath` guidance retained. The source's Inrupt client example is not applicable to the suite's allowed stack. |
| §2 — `allowInsecureLoopback` covers brokers too | [Broker issuers and loopback HTTP](solid-reactive-authentication/SKILL.md#broker-issuers-and-loopback-http). Adopted for any loopback HTTP issuer, with remote HTTPS unchanged. |
| Keystone §3.1 — Paginated API overwrites truncate pod data | [Paginated sources and snapshot overwrites](solid-app-shell/SKILL.md#paginated-sources-and-snapshot-overwrites). Adopted: exhaust pagination before replacing the dataset; abort incomplete syncs. |
| Keystone §3.2 — Write-based auth proof | [Proving a session](solid-reactive-authentication/SKILL.md#proving-a-session). Adopted with an anonymous-denial prerequisite, attempt-specific token evidence where available, and cleanup. A public-writable canary is not proof; persistent 401 is not uniquely cancellation. The hand-built Turtle sample is not applicable under the suite RDF discipline. |
| Keystone §3.3 — Manager lacks a session-query API | [Proving a session](solid-reactive-authentication/SKILL.md#proving-a-session). The observable-write fallback is documented. Adding `lastTokenAttached` / `isAuthenticated()` is not applicable to a skills-only lane: these are proposed upstream APIs, not existing manager exports. |
| Keystone §3.4 — `htu`, public hostname, TCP bind and SNI | [Loopback address versus public URL](solid-server-matrix/SKILL.md#loopback-address-versus-public-url) and [testing callout](solid-test-infrastructure/SKILL.md#minimal-live-round-trip-proof). Adopted for the described deployment; `htu` binds the target URI, not the token audience or socket alone. |
| Keystone §3.5 — Broker consent `decision=accept` | [Broker consent and COOP](solid-test-infrastructure/SKILL.md#broker-consent-and-coop). Adopted as the observed broker form contract; the claim that this field is standard OIDC is not applicable. Inspect forms and preserve hidden fields. |
| Keystone §4.1 — Expiry, single-flight eviction, revoked tokens, direct dependencies | [Expired and rejected cached tokens](solid-reactive-authentication/SKILL.md#expired-and-rejected-cached-tokens). All four lessons adopted: expiry/skew, identity-checked single-flight replacement, request-token evidence rather than method/URL heuristics, and direct dependency declarations. No dependencies added here. |
| Keystone §4.2 — Callback `targetOrigin` | [Callback origins and custom-element registration](solid-reactive-authentication/SKILL.md#callback-origins-and-custom-element-registration). Adopted; the inline callback example also now supplies `location.origin`. |
| Keystone §4.3 — RecentAccounts JSON validation and lazy storage | [Recent accounts and profile reuse](solid-reactive-authentication/SKILL.md#recent-accounts-and-profile-reuse). Both lessons adopted, including optional field normalization, display-name fallback and graceful storage failure. |
| Keystone §4.4 — Reuse `fetchLoginCandidate` dataset | [Recent accounts and profile reuse](solid-reactive-authentication/SKILL.md#recent-accounts-and-profile-reuse). Adopted as helper-maintenance guidance; explicitly identifies the historical helper's missing `dataset` field rather than presenting it as an existing API. |
| Keystone §4.5 — Retain an abortable controller | [Reachable cancellation and nonce retries](solid-reactive-authentication/SKILL.md#reachable-cancellation-and-nonce-retries). Adopted as provider-maintenance guidance, including controller replacement if reusable and fencing shared work. |
| CapNote §3.1 — Explicit custom-element registration | [Callback origins and custom-element registration](solid-reactive-authentication/SKILL.md#callback-origins-and-custom-element-registration). Adopted with duplicate-definition guard, browser-only import, and lazy method access after definition. |
| CapNote §3.2 — Headless broker COOP severs opener | [Broker consent and COOP](solid-test-infrastructure/SKILL.md#broker-consent-and-coop). Symptom and main-page diagnostic adopted. Disabling Chromium web security/COOP and weakening broker headers are not adopted as reusable fixes: they mask the callback compatibility failure. BroadcastChannel remains a candidate requiring origin/state validation, not an implemented transport. |
| CapNote §3.3 — Ignore generated `next-env.d.ts` | Not applicable to a Solid skill: framework-specific generated-file housekeeping belongs to a Next.js scaffold/guide, neither of which this lane changes. No Next.js setup skill exists in this catalog. This records the source's proposed `.next/` and `next-env.d.ts` ignore entries without imposing them on consumers or this workspace. |
| CapNote §3.4 — Strip-types module warning | [Strip-only Node scripts](solid-test-infrastructure/SKILL.md#strip-only-node-scripts). Non-blocking warning and per-file `.mts` alternative adopted. A CJS dependency does not by itself forbid an ESM app; no application module mode changed. |
| Furlong §5.1 — Direct-page OIDC proof | [Minimal live round-trip proof](solid-test-infrastructure/SKILL.md#minimal-live-round-trip-proof). Six-step pattern adopted as an alternative to full UI smoke coverage, limited to an authorized disposable environment; fixture-only work stays fixture-only. |
| Furlong §5.2 — Node fetch self-signed TLS | [Self-signed TLS in Node workers](solid-test-infrastructure/SKILL.md#self-signed-tls-in-node-workers). `https.Agent` incompatibility and scoped dispatcher approach adopted. Process-wide TLS disabling is not adopted as a default; prefer a trusted test CA. Node's internal Undici does not make the external package importable automatically. |
| Furlong §5.3 — Repeat hostname mismatch prominently | [Testing callout](solid-test-infrastructure/SKILL.md#minimal-live-round-trip-proof) and [server diagnosis](solid-server-matrix/SKILL.md#loopback-address-versus-public-url). Duplicate lesson deliberately retained at the start of the minimal proof. The source's universal byte-for-byte audience/URL claim is not adopted: omit query/fragment from `htu` and distinguish audience from target URI. |
| Furlong §5.4 — `isDPoPNonceError` retry | [Reachable cancellation and nonce retries](solid-reactive-authentication/SKILL.md#reachable-cancellation-and-nonce-retries). Bounded helper-based retry and handle nonce tracking adopted. The raw-Response snippet is not applicable to the workspace's oauth4webapi 3.8.6: its implementation accepts `WWWAuthenticateChallengeError` / `ResponseBodyError`, returning false for a raw Response. Apply it to a caught processing error instead. |

Out of scope: changes to the old repository's `AGENTS.md`, `docs/local-ops.md`, Next.js
templates, external broker configuration, historical reference implementations, and package
APIs. Those original destinations are represented above by the corresponding maintained
skill lesson or an explicit not-applicable reason. Scope interpretations are recorded in
[QUESTIONS.md](../QUESTIONS.md).
